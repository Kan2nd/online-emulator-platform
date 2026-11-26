"use strict";

// Save-state files need a live session to reach over HTTP, so the storage
// functions are tested directly against a temp saves folder.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const saves = fs.mkdtempSync(path.join(os.tmpdir(), "ce-saves-"));
process.env.SAVES_DIR = saves;
const { listStates, deleteState } = require("../src/storage");

after(() => fs.rmSync(saves, { recursive: true, force: true }));

test("deleting a slot removes only that snapshot", () => {
  const dir = path.join(saves, "tester");
  fs.mkdirSync(dir);
  for (const f of ["game.srm", "game.state", "game.state2"]) fs.writeFileSync(path.join(dir, f), "x");

  deleteState("tester", "game.gba", 0);
  assert.deepEqual(listStates("tester", "game.gba").map((s) => Boolean(s.savedAt)), [false, false, true, false]);
  assert.ok(fs.existsSync(path.join(dir, "game.srm")), "in-game save must survive");

  assert.throws(() => deleteState("tester", "game.gba", 0), { status: 404 });
  assert.throws(() => deleteState("tester", "game.gba", 4), { status: 400 });
  assert.throws(() => deleteState("tester", "game.gba", -1), { status: 400 });
});
