"use strict";

// Boots the real server against temp folders, with Docker stubbed out, and
// exercises the HTTP API: accounts, the forced password change, who may touch
// whose session, uploads and the admin gate.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { WebSocket } = require("ws");

const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "test-admin-key";
let server;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ce-test-"));
  fs.mkdirSync(path.join(tmp, "roms"));
  fs.mkdirSync(path.join(tmp, "saves"));
  server = spawn(
    process.execPath,
    ["-r", path.join(__dirname, "..", "test-support", "stub-docker.js"), path.join(__dirname, "..", "src", "index.js")],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        ROMS_DIR: path.join(tmp, "roms"),
        SAVES_DIR: path.join(tmp, "saves"),
        DATA_DIR: path.join(tmp, "data"),
        ADMIN_TOKEN: ADMIN,
        STREAM_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "ignore", "pipe"],
    }
  );
  let errors = "";
  server.stderr.on("data", (chunk) => (errors += chunk));
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${errors}`);
});

after(() => {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A browser: remembers the login cookie it was handed.
function client() {
  const self = { cookie: "" };
  self.send = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(BASE + url, {
      method,
      headers: {
        ...(body ? { "content-type": raw ? "application/octet-stream" : "application/json" } : {}),
        ...(self.cookie ? { cookie: self.cookie } : {}),
        ...headers,
      },
      body: body && !raw ? JSON.stringify(body) : body,
    });
    const set = res.headers.get("set-cookie");
    if (set) self.cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null), setCookie: set };
  };
  return self;
}
const asAdmin = (method, url, body) => client().send(method, url, body, { "x-admin-token": ADMIN });

// A new account that has already replaced its temporary password.
async function player(name) {
  const { data } = await asAdmin("POST", "/admin/users", { name });
  const c = client();
  await c.send("POST", "/auth/login", { name, password: data.password });
  await c.send("POST", "/auth/password", { current: data.password, next: `${name}-password-1` });
  return c;
}

// Resolves true if the stream proxy accepts the connection.
const streamOpens = (id, cookie, origin) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/stream/${id}`, {
      headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    });
    ws.on("open", () => {
      resolve(true);
      ws.terminate();
    });
    ws.on("error", () => resolve(false));
  });

// Smallest buffer that passes the GBA header check (fixed 0x96 at 0xB2).
function fakeGba() {
  const buf = Buffer.alloc(0xc0);
  buf[0xb2] = 0x96;
  return buf;
}

let alice;
let bob;

test("nothing works without signing in", async () => {
  const anon = client();
  assert.equal((await anon.send("GET", "/health")).status, 200);
  for (const [method, url] of [
    ["GET", "/auth/me"],
    ["GET", "/roms"],
    ["GET", "/sessions"],
    ["GET", "/sessions/x/states"],
    ["GET", "/sessions/x/logs"],
    ["DELETE", "/sessions/x"],
  ]) {
    assert.equal((await anon.send(method, url)).status, 401, `${method} ${url}`);
  }
  assert.equal((await anon.send("POST", "/sessions", { userId: "alice", game: "x.gba" })).status, 401);
  assert.equal((await anon.send("POST", "/roms/upload?name=x.gba", fakeGba())).status, 401);
});

test("only the admin key creates accounts", async () => {
  assert.equal((await client().send("POST", "/admin/users", { name: "alice" })).status, 401);
  assert.equal((await client().send("GET", "/admin/users", null, { "x-admin-token": "nope" })).status, 401);
  assert.equal((await asAdmin("POST", "/admin/users", { name: "../root" })).status, 400);
  assert.equal((await asAdmin("POST", "/admin/users", {})).status, 400);
});

test("first sign-in forces a password change", async () => {
  const made = await asAdmin("POST", "/admin/users", { name: "alice" });
  assert.equal(made.status, 201);
  const temporary = made.data.password;
  assert.equal((await asAdmin("POST", "/admin/users", { name: "Alice" })).status, 409, "names differ by more than case");

  alice = client();
  assert.equal((await alice.send("POST", "/auth/login", { name: "alice", password: "wrong-password" })).status, 401);
  const login = await alice.send("POST", "/auth/login", { name: "alice", password: temporary });
  assert.deepEqual(login.data, { name: "alice", mustChange: true });
  assert.match(login.setCookie, /HttpOnly; SameSite=Strict/);

  const blocked = await alice.send("GET", "/roms");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.code, "password_change");
  assert.equal((await alice.send("POST", "/sessions", { game: "x.gba" })).status, 403);

  const change = (current, next) => alice.send("POST", "/auth/password", { current, next });
  assert.equal((await change("not-it-at-all", "alice-password-1")).status, 400);
  assert.equal((await change(temporary, "short")).status, 400);
  assert.equal((await change(temporary, temporary)).status, 400);
  assert.equal((await change(temporary, "alice-password-1")).status, 204);

  assert.equal((await alice.send("GET", "/roms")).status, 200);
  assert.equal((await client().send("POST", "/auth/login", { name: "alice", password: temporary })).status, 401);

  const stored = fs.readFileSync(path.join(tmp, "data", "users.json"), "utf8");
  assert.ok(!stored.includes("alice-password-1") && !stored.includes(temporary), "no plain-text passwords");
});

test("uploads are validated and credited to the signed-in player", async () => {
  const upload = (name, body) => alice.send("POST", `/roms/upload?name=${encodeURIComponent(name)}&player=mallory`, body);
  assert.equal((await upload("notes.txt", fakeGba())).status, 400);
  assert.equal((await upload("renamed.gba", Buffer.alloc(0xc0))).status, 400, "wrong header must be rejected");
  assert.equal((await upload("../../evil.gba", fakeGba())).status, 201, "path is stripped, not rejected");
  assert.equal((await upload("evil.gba", fakeGba())).status, 409);
  assert.equal((await alice.send("GET", "/roms")).data.pending[0].uploader, "alice");
  assert.equal((await alice.send("POST", "/admin/pending/evil.gba/approve")).status, 401, "players cannot approve");
  assert.equal((await asAdmin("POST", "/admin/pending/..%2F..%2Fetc/approve")).status, 404);
  assert.equal((await asAdmin("POST", "/admin/pending/evil.gba/approve")).status, 204);
  assert.deepEqual((await asAdmin("GET", "/admin/library")).data.roms, ["evil.gba"]);
});

test("a player can only reach their own session", async () => {
  bob = await player("bob");
  assert.equal((await alice.send("POST", "/sessions", { game: "missing.gba" })).status, 400);
  const started = await alice.send("POST", "/sessions", { userId: "bob", game: "evil.gba" });
  assert.equal(started.status, 201);
  const id = started.data.sessionId;

  const mine = (await alice.send("GET", "/sessions")).data.sessions;
  assert.equal(mine[0].userId, "alice", "the name in the request body is ignored");
  assert.ok(!("signalToken" in mine[0]));
  assert.deepEqual((await bob.send("GET", "/sessions")).data.sessions, []);

  for (const [method, url] of [
    ["GET", `/sessions/${id}`],
    ["GET", `/sessions/${id}/states`],
    ["GET", `/sessions/${id}/logs`],
    ["DELETE", `/sessions/${id}/states/0`],
    ["DELETE", `/sessions/${id}`],
  ]) {
    assert.equal((await bob.send(method, url)).status, 404, `bob: ${method} ${url}`);
  }
  assert.equal(await streamOpens(id), false, "no cookie");
  assert.equal(await streamOpens(id, bob.cookie), false, "someone else");
  assert.equal(await streamOpens(id, alice.cookie, "http://elsewhere.example"), false, "another site");
  assert.equal(await streamOpens(id, alice.cookie, `http://127.0.0.1:${PORT}`), true);

  assert.equal((await alice.send("GET", `/sessions/${id}/states`)).status, 200);
  assert.equal((await asAdmin("DELETE", "/admin/roms/evil.gba")).status, 409, "in use");
});

test("resetting or deleting an account signs it out and stops its game", async () => {
  const reset = await asAdmin("POST", "/admin/users/alice/reset");
  assert.equal(reset.status, 200);
  assert.equal((await alice.send("GET", "/roms")).status, 401);
  assert.equal((await asAdmin("DELETE", "/admin/roms/evil.gba")).status, 204, "her session is gone");
  const again = await client().send("POST", "/auth/login", { name: "alice", password: reset.data.password });
  assert.equal(again.data.mustChange, true);

  assert.equal((await asAdmin("DELETE", "/admin/users/bob")).status, 204);
  assert.equal((await bob.send("GET", "/auth/me")).status, 401);
  assert.deepEqual((await asAdmin("GET", "/admin/users")).data.users.map((u) => u.name), ["alice"]);
});

test("signing out ends the login, and guessing is slowed down", async () => {
  const carol = await player("carol");
  const old = carol.cookie;
  assert.equal((await carol.send("POST", "/auth/logout")).status, 204);
  assert.equal((await client().send("GET", "/auth/me", null, { cookie: old })).status, 401);

  const guess = () => client().send("POST", "/auth/login", { name: "carol", password: "not-her-password" });
  for (let i = 0; i < 5; i++) assert.equal((await guess()).status, 401);
  assert.equal((await guess()).status, 429);
  const right = await client().send("POST", "/auth/login", { name: "carol", password: "carol-password-1" });
  assert.equal(right.status, 429, "locked even with the right password");
});
