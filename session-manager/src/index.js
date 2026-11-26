"use strict";

const express = require("express");
const path = require("path");
const { WebSocket, WebSocketServer } = require("ws");
const { createHash, randomBytes, randomUUID, timingSafeEqual } = require("crypto");
const { startSession, stopSession, isRunning, stopOrphans, getLogs, inspect } = require("./dockerManager");
const {
  listRoms,
  listStates,
  deleteState,
  listPending,
  savePending,
  approvePending,
  rejectPending,
  deleteRom,
  UploadError,
} = require("./storage");
const metrics = require("./metrics");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.PORT || 4000;

// sessionId -> { containerId, userId, game, startedAt }
// In-memory only: fine for a dev PoC, but a real deployment needs this in
// Redis/a DB so any session-manager replica can look up any session.
const sessions = new Map();

// Each session is a full emulator + video encoder, roughly one CPU core, so
// cap how many can run at once on the one host.
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS) || 4;
// Session slots reserved by requests whose container is still booting.
let starting = 0;
const startingKeys = new Set();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", metrics.register.contentType);
  res.end(await metrics.register.metrics());
});

const PLAYER_NAME = /^[A-Za-z0-9_-]{1,32}$/;

app.get("/roms", (_req, res) => {
  // Pending uploads are listed by name for everyone so an uploader can see
  // theirs is queued; only approved files are playable.
  res.json({
    roms: listRoms(),
    pending: listPending().map(({ name, uploader, uploadedAt }) => ({ name, uploader, uploadedAt })),
  });
});

app.post(
  "/roms/upload",
  express.raw({ type: "application/octet-stream", limit: "48mb" }),
  (req, res) => {
    const uploader = String(req.query.player || "");
    if (!PLAYER_NAME.test(uploader)) {
      return res.status(400).json({ error: "Enter a player name before uploading." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The upload was empty." });
    }
    try {
      const name = savePending(req.query.name, req.body, uploader);
      res.status(201).json({ name, status: "pending" });
    } catch (err) {
      res.status(err instanceof UploadError ? err.status : 500).json({ error: err.message });
    }
  }
);

// Single shared admin token from the server's environment (.env, never the
// repo). Both sides are hashed first so the comparison is constant-time
// regardless of the guess's length.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const digest = (value) => createHash("sha256").update(value).digest();

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: "Admin access isn't configured on this server." });
  }
  const given = String(req.get("x-admin-token") || "");
  if (!given || !timingSafeEqual(digest(given), digest(ADMIN_TOKEN))) {
    return res.status(401).json({ error: "Wrong admin key." });
  }
  next();
}

function adminAction(fn) {
  return (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      res.status(err instanceof UploadError ? err.status : 500).json({ error: err.message });
    }
  };
}

app.get("/admin/check", requireAdmin, (_req, res) => res.status(204).end());

app.get("/admin/pending", requireAdmin, (_req, res) => res.json({ pending: listPending() }));

app.post(
  "/admin/pending/:name/approve",
  requireAdmin,
  adminAction((req, res) => {
    approvePending(req.params.name);
    res.status(204).end();
  })
);

app.delete(
  "/admin/pending/:name",
  requireAdmin,
  adminAction((req, res) => {
    rejectPending(req.params.name);
    res.status(204).end();
  })
);

app.delete(
  "/admin/roms/:name",
  requireAdmin,
  adminAction((req, res) => {
    const inUse = [...sessions.values()].some((s) => s.game === req.params.name);
    if (inUse) {
      return res.status(409).json({ error: "Someone is playing that game right now." });
    }
    deleteRom(req.params.name);
    res.status(204).end();
  })
);

app.post("/sessions", async (req, res) => {
  const { userId, game } = req.body || {};
  if (!userId || !game) {
    return res.status(400).json({ error: "userId and game are required" });
  }
  // userId becomes a directory name and game a file name inside the saves
  // and roms mounts, so neither may carry path separators or ".." tricks.
  if (!PLAYER_NAME.test(userId)) {
    return res.status(400).json({ error: "player name: 1-32 letters, digits, - or _" });
  }
  if (!listRoms().includes(game)) {
    return res.status(400).json({ error: "unknown game" });
  }
  // Two emulators on the same player's save file would overwrite each
  // other's progress, so one session per player per game.
  const key = `${userId}\n${game}`;
  const duplicate = startingKeys.has(key) || [...sessions.values()].some((s) => s.userId === userId && s.game === game);
  if (duplicate) {
    return res.status(409).json({ error: `${userId} is already playing this game. Stop that session first.` });
  }
  if (sessions.size + starting >= MAX_SESSIONS) {
    return res.status(503).json({ error: "The server is full right now. Try again when someone stops playing." });
  }

  starting++;
  startingKeys.add(key);
  const stopTimer = metrics.sessionStartDuration.startTimer();
  try {
    const signalToken = randomBytes(24).toString("hex");
    const { container, port } = await startSession({ userId, game, signalToken });
    stopTimer();
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      containerId: container.id,
      userId,
      game,
      port,
      signalToken,
      startedAt: new Date().toISOString(),
    });
    metrics.activeSessions.set(sessions.size);
    res.status(201).json({ sessionId, containerId: container.id, port });
  } catch (err) {
    stopTimer();
    res.status(500).json({ error: err.message });
  } finally {
    starting--;
    startingKeys.delete(key);
  }
});

// The signaling token is a credential for the emulator's port; keep it out
// of every API response.
const publicSession = ({ signalToken, ...rest }) => rest;

app.get("/sessions", (_req, res) => {
  const result = Array.from(sessions.entries()).map(([sessionId, data]) => ({
    sessionId,
    ...publicSession(data),
  }));
  res.json({ sessions: result });
});

app.get("/sessions/:id", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  try {
    const info = await inspect(session.containerId);
    res.json({ sessionId: req.params.id, ...publicSession(session), state: info.State });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/sessions/:id/states", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  res.json({ slots: listStates(session.userId, session.game) });
});

app.delete("/sessions/:id/states/:slot", (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "unknown session" });
  try {
    const slot = /^\d$/.test(req.params.slot) ? Number(req.params.slot) : -1;
    deleteState(session.userId, session.game, slot);
    res.status(204).end();
  } catch (err) {
    res.status(err instanceof UploadError ? err.status : 500).json({ error: err.message });
  }
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
    res.status(204).send();
  } catch (err) {
    metrics.saveFlushErrors.inc();
    res.status(500).json({ error: err.message });
  } finally {
    // Dropped either way: a failed stop is counted above, but keeping the
    // entry would block this player's next session and ROM deletes forever.
    sessions.delete(req.params.id);
    metrics.activeSessions.set(sessions.size);
  }
});

// Containers also end on their own (the emulator exits when no browser has
// been connected for a while, or the game crashes). Forget those sessions.
async function reapEndedSessions() {
  for (const [id, session] of sessions) {
    try {
      if (!(await isRunning(session.containerId))) {
        sessions.delete(id);
        console.log(`session ${id} ended on its own (${session.userId}, ${session.game})`);
      }
    } catch {
      // Docker unreachable for a moment; check again next round.
    }
  }
  metrics.activeSessions.set(sessions.size);
}
setInterval(reapEndedSessions, 15000).unref();

stopOrphans()
  .then((count) => count && console.log(`stopped ${count} emulator container(s) left from a previous run`))
  .catch((err) => console.log(`could not check for leftover emulator containers: ${err.message}`));

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
    const upstream = new WebSocket(`ws://${STREAM_HOST}:${session.port}/${session.signalToken}`);
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
