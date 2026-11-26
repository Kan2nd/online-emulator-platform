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
const users = require("./users");
const { currentUser, signIn, signOut, revoke, requireLogin, requireUser, throttle } = require("./auth");

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

// Turns the errors the stores throw on purpose into their status codes.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const expected = err instanceof UploadError || err instanceof users.AccountError;
    res.status(expected ? err.status : 500).json({ error: err.message });
  }
};

// ---------- accounts ----------
const TOO_MANY = { error: "Too many wrong passwords. Wait a minute and try again." };

app.post(
  "/auth/login",
  handle(async (req, res) => {
    const name = String(req.body?.name || "").slice(0, 32);
    const key = `${name.toLowerCase()} ${req.ip}`;
    if (throttle.locked(key)) return res.status(429).json(TOO_MANY);
    if (!(await users.verify(name, req.body?.password))) {
      throttle.fail(key);
      return res.status(401).json({ error: "Wrong name or password." });
    }
    throttle.clear(key);
    signIn(res, name);
    res.json({ name, mustChange: users.mustChange(name) });
  })
);

app.get("/auth/me", requireLogin, (req, res) => {
  res.json({ name: req.user, mustChange: users.mustChange(req.user) });
});

app.post("/auth/logout", (req, res) => {
  signOut(req, res);
  res.status(204).end();
});

app.post(
  "/auth/password",
  requireLogin,
  handle(async (req, res) => {
    const key = `${req.user.toLowerCase()} ${req.ip}`;
    if (throttle.locked(key)) return res.status(429).json(TOO_MANY);
    try {
      await users.changePassword(req.user, req.body?.current, req.body?.next);
    } catch (err) {
      if (err.status === 400) throttle.fail(key);
      throw err;
    }
    throttle.clear(key);
    revoke(req.user, req); // other browsers signed in with the old password
    res.status(204).end();
  })
);

// ---------- library ----------
const library = () => ({
  roms: listRoms(),
  pending: listPending().map(({ name, uploader, uploadedAt }) => ({ name, uploader, uploadedAt })),
});

// Pending uploads are listed by name for every player so an uploader can see
// theirs is queued; only approved files are playable.
app.get("/roms", requireUser, (_req, res) => res.json(library()));

// requireUser comes first so a stranger cannot make the server buffer 48 MB.
app.post(
  "/roms/upload",
  requireUser,
  express.raw({ type: "application/octet-stream", limit: "48mb" }),
  handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "The upload was empty." });
    }
    const name = savePending(req.query.name, req.body, req.user);
    res.status(201).json({ name, status: "pending" });
  })
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

app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "admin.html")));
app.get("/admin/check", requireAdmin, (_req, res) => res.status(204).end());
app.get("/admin/library", requireAdmin, (_req, res) => res.json(library()));

app.get("/admin/users", requireAdmin, (_req, res) => {
  const playing = new Set([...sessions.values()].map((s) => s.userId));
  res.json({ users: users.list().map((u) => ({ ...u, playing: playing.has(u.name) })) });
});

app.post(
  "/admin/users",
  requireAdmin,
  handle(async (req, res) => {
    const name = req.body?.name;
    const password = await users.create(name);
    res.status(201).json({ name, password });
  })
);

app.post(
  "/admin/users/:name/reset",
  requireAdmin,
  handle(async (req, res) => {
    const password = await users.resetPassword(req.params.name);
    revoke(req.params.name);
    await endSessionsOf(req.params.name);
    res.json({ name: req.params.name, password });
  })
);

app.delete(
  "/admin/users/:name",
  requireAdmin,
  handle(async (req, res) => {
    users.remove(req.params.name);
    revoke(req.params.name);
    await endSessionsOf(req.params.name);
    res.status(204).end();
  })
);

app.post(
  "/admin/pending/:name/approve",
  requireAdmin,
  handle(async (req, res) => {
    approvePending(req.params.name);
    res.status(204).end();
  })
);

app.delete(
  "/admin/pending/:name",
  requireAdmin,
  handle(async (req, res) => {
    rejectPending(req.params.name);
    res.status(204).end();
  })
);

app.delete(
  "/admin/roms/:name",
  requireAdmin,
  handle(async (req, res) => {
    const inUse = [...sessions.values()].some((s) => s.game === req.params.name);
    if (inUse) {
      return res.status(409).json({ error: "Someone is playing that game right now." });
    }
    deleteRom(req.params.name);
    res.status(204).end();
  })
);

// ---------- play sessions (a player only ever sees their own) ----------
app.post("/sessions", requireUser, async (req, res) => {
  // The player is whoever is signed in, never a name from the request. Account
  // names are restricted to safe characters, as they become a save folder.
  const userId = req.user;
  const { game } = req.body || {};
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
    if (!users.exists(userId)) {
      // The admin deleted the account while the container was booting.
      await stopSession(container.id);
      return res.status(401).json({ error: "Sign in first.", code: "signed_out" });
    }
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

// Someone else's session answers exactly like one that doesn't exist.
function ownSession(req, res, next) {
  req.session = sessions.get(req.params.id);
  if (!req.session || req.session.userId !== req.user) {
    return res.status(404).json({ error: "unknown session" });
  }
  next();
}
const owned = [requireUser, ownSession];

app.get("/sessions", requireUser, (req, res) => {
  const result = Array.from(sessions.entries())
    .filter(([, data]) => data.userId === req.user)
    .map(([sessionId, data]) => ({ sessionId, ...publicSession(data) }));
  res.json({ sessions: result });
});

app.get(
  "/sessions/:id",
  owned,
  handle(async (req, res) => {
    const info = await inspect(req.session.containerId);
    res.json({ sessionId: req.params.id, ...publicSession(req.session), state: info.State });
  })
);

app.get("/sessions/:id/states", owned, (req, res) => {
  res.json({ slots: listStates(req.session.userId, req.session.game) });
});

app.delete(
  "/sessions/:id/states/:slot",
  owned,
  handle(async (req, res) => {
    const slot = /^\d$/.test(req.params.slot) ? Number(req.params.slot) : -1;
    deleteState(req.session.userId, req.session.game, slot);
    res.status(204).end();
  })
);

app.get(
  "/sessions/:id/logs",
  owned,
  handle(async (req, res) => {
    res.type("text/plain").send(await getLogs(req.session.containerId));
  })
);

async function endSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  try {
    await stopSession(session.containerId);
  } catch (err) {
    metrics.saveFlushErrors.inc();
    throw err;
  } finally {
    // Dropped either way: a failed stop is counted above, but keeping the
    // entry would block this player's next session and ROM deletes forever.
    sessions.delete(id);
    metrics.activeSessions.set(sessions.size);
  }
}

async function endSessionsOf(name) {
  const ids = [...sessions].filter(([, s]) => s.userId === name).map(([id]) => id);
  await Promise.all(ids.map((id) => endSession(id).catch(() => {})));
}

app.delete(
  "/sessions/:id",
  owned,
  handle(async (req, res) => {
    await endSession(req.params.id);
    res.status(204).send();
  })
);

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
  // The video and input stream needs the same proof as the API: the signed-in
  // owner, from this site's own page.
  const user = currentUser(req);
  const sameOrigin = !req.headers.origin || req.headers.origin.replace(/^https?:\/\//, "") === req.headers.host;
  if (!session || !user || session.userId !== user || users.mustChange(user) || !sameOrigin) {
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
