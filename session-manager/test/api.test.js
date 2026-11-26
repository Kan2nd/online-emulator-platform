"use strict";

// Boots the real server against temp ROM/save folders and exercises the
// HTTP API: uploads, ROM validation, the admin gate and session input
// checks. Needs no Docker; starting an actual game is tested on the server.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = "test-admin-key";
let server;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ce-test-"));
  fs.mkdirSync(path.join(tmp, "roms"));
  fs.mkdirSync(path.join(tmp, "saves"));
  server = spawn(process.execPath, [path.join(__dirname, "..", "src", "index.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ROMS_DIR: path.join(tmp, "roms"),
      SAVES_DIR: path.join(tmp, "saves"),
      ROMS_HOST_DIR: path.join(tmp, "roms"),
      SAVES_HOST_DIR: path.join(tmp, "saves"),
      ADMIN_TOKEN: ADMIN,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
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

// Smallest buffer that passes the GBA header check (fixed 0x96 at 0xB2).
function fakeGba() {
  const buf = Buffer.alloc(0xc0);
  buf[0xb2] = 0x96;
  return buf;
}

const upload = (name, body, player = "tester") =>
  fetch(`${BASE}/roms/upload?name=${encodeURIComponent(name)}&player=${player}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });
const admin = (method, url) => fetch(BASE + url, { method, headers: { "x-admin-token": ADMIN } });

test("health and empty catalog", async () => {
  assert.deepEqual(await (await fetch(`${BASE}/health`)).json(), { ok: true });
  assert.deepEqual(await (await fetch(`${BASE}/roms`)).json(), { roms: [], pending: [] });
});

test("uploads are validated", async () => {
  assert.equal((await upload("x.gba", fakeGba(), "bad name!")).status, 400);
  assert.equal((await upload("notes.txt", fakeGba())).status, 400);
  assert.equal((await upload("renamed.gba", Buffer.alloc(0xc0))).status, 400, "wrong header must be rejected");
  assert.equal((await upload("../../evil.gba", fakeGba())).status, 201, "path is stripped, not rejected");
  assert.ok(fs.existsSync(path.join(tmp, "roms", ".pending", "evil.gba")));
  assert.equal((await upload("evil.gba", fakeGba())).status, 409, "duplicate pending upload");
});

test("admin routes need the key", async () => {
  assert.equal((await fetch(`${BASE}/admin/check`)).status, 401);
  assert.equal((await fetch(`${BASE}/admin/check`, { headers: { "x-admin-token": "nope" } })).status, 401);
  assert.equal((await admin("GET", "/admin/check")).status, 204);
  assert.equal((await fetch(`${BASE}/admin/roms/evil.gba`, { method: "DELETE" })).status, 401);
  assert.equal((await admin("POST", "/admin/pending/..%2F..%2Fetc/approve")).status, 404);
});

test("approve, then the game is playable, then delete", async () => {
  assert.equal((await admin("POST", "/admin/pending/evil.gba/approve")).status, 204);
  const { roms, pending } = await (await fetch(`${BASE}/roms`)).json();
  assert.deepEqual(roms, ["evil.gba"]);
  assert.deepEqual(pending, []);
  assert.equal((await admin("DELETE", "/admin/roms/evil.gba")).status, 204);
  assert.deepEqual((await (await fetch(`${BASE}/roms`)).json()).roms, []);
});

test("session requests are validated before touching Docker", async () => {
  const start = (body) =>
    fetch(`${BASE}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await start({})).status, 400);
  assert.equal((await start({ userId: "../root", game: "x.gba" })).status, 400);
  assert.equal((await start({ userId: "tester", game: "missing.gba" })).status, 400);
  assert.equal((await fetch(`${BASE}/sessions/nope`, { method: "DELETE" })).status, 404);
});
