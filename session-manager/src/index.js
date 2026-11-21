"use strict";

const express = require("express");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");
const { startSession, stopSession, getLogs, inspect } = require("./dockerManager");
const { listRoms, listStates } = require("./storage");
const metrics = require("./metrics");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 4000;

// sessionId -> { containerId, userId, game, startedAt }
// In-memory only: fine for a dev PoC, but a real deployment needs this in
// Redis/a DB so any session-manager replica can look up any session.
const sessions = new Map();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

app.get("/roms", (_req, res) => {
  res.json({ roms: listRoms() });
});

app.post("/sessions", async (req, res) => {
  const { userId, game } = req.body || {};
  if (!userId || !game) {
    return res.status(400).json({ error: "userId and game are required" });
  }
  // userId becomes a directory name and game a file name inside the saves
  // and roms mounts, so neither may carry path separators or ".." tricks.
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(userId)) {
    return res.status(400).json({ error: "player name: 1-32 letters, digits, - or _" });
  }
  if (!listRoms().includes(game)) {
    return res.status(400).json({ error: "unknown game" });
  }

  const stopTimer = metrics.sessionStartDuration.startTimer();
  try {
    const { container, port } = await startSession({ userId, game });
    stopTimer();
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      containerId: container.id,
      userId,
      game,
      port,
      startedAt: new Date().toISOString(),
    });
    metrics.activeSessions.set(sessions.size);
    res.status(201).json({ sessionId, containerId: container.id, port });
  } catch (err) {
    stopTimer();
    res.status(500).json({ error: err.message });
  }
});

app.get("/sessions", (_req, res) => {
  const result = Array.from(sessions.entries()).map(([sessionId, data]) => ({
    sessionId,
    ...data,
  }));
  res.json({ sessions: result });
});

app.get("/sessions/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  try {
    const info = await inspect(session.containerId);
    res.json({ sessionId: req.params.id, ...session, state: info.State });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/sessions/:id/states", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  res.json({ slots: listStates(session.userId, session.game) });
});

app.get("/sessions/:id/logs", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  try {
    const logs = await getLogs(session.containerId);
    res.type("text/plain").send(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/sessions/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  try {
    await stopSession(session.containerId);
    sessions.delete(req.params.id);
    metrics.activeSessions.set(sessions.size);
    res.status(204).send();
  } catch (err) {
    metrics.saveFlushErrors.inc();
    res.status(500).json({ error: err.message });
  }
});

// Signaling proxy: the browser opens ws://<this host>/stream/<sessionId> and
// we relay it to that session's emulator container (host-networked, so
// reached via the Docker host gateway). Keeps the browser on a single origin
// and means session ports never need to be exposed to clients.
const STREAM_HOST = process.env.STREAM_HOST || "host.docker.internal";
const wss = new WebSocketServer({ noServer: true });

const server = app.listen(PORT, () => {
  console.log(`session-manager listening on :${PORT}`);
});

server.on("upgrade", (req, socket, head) => {
  const match = /^\/stream\/([\w-]+)$/.exec(req.url);
  const session = match && sessions.get(match[1]);
  if (!session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(`ws://${STREAM_HOST}:${session.port}/`);
    const queued = [];
    const teardown = () => {
      client.terminate();
      upstream.terminate();
    };

    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else queued.push([data, isBinary]);
    });
    upstream.on("open", () => {
      for (const [data, isBinary] of queued.splice(0)) upstream.send(data, { binary: isBinary });
    });
    upstream.on("message", (data, isBinary) => client.send(data, { binary: isBinary }));

    client.on("close", teardown);
    client.on("error", teardown);
    upstream.on("close", teardown);
    upstream.on("error", teardown);
  });
});
