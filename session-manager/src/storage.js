"use strict";

const fs = require("fs");
const path = require("path");

// This is the container-internal path (see docker-compose.yml), distinct
// from ROMS_HOST_DIR/SAVES_HOST_DIR used in dockerManager.js for sibling
// container binds. Swap this module for an S3/GCS-backed one later without
// touching index.js.
const ROMS_DIR = process.env.ROMS_DIR || "/data/roms";

// Keep in sync with the extension map in emulator-image/entrypoint.sh —
// anything else in roms/ (READMEs, .gitkeep, stray files) isn't a ROM we
// can actually launch.
const ROM_EXTENSIONS = [".nes", ".gba"];

const SAVES_DIR = process.env.SAVES_DIR || "/data/saves";
const STATE_SLOTS = 4;

// RetroArch names states <content basename>.state for slot 0 and
// .state1, .state2, ... for the others.
function stateFile(userId, game, slot) {
  const base = game.replace(/\.[^.]+$/, "");
  return path.join(SAVES_DIR, userId, `${base}.state${slot === 0 ? "" : slot}`);
}

function listStates(userId, game) {
  const slots = [];
  for (let slot = 0; slot < STATE_SLOTS; slot++) {
    try {
      slots.push({ slot, savedAt: fs.statSync(stateFile(userId, game, slot)).mtime.toISOString() });
    } catch {
      slots.push({ slot, savedAt: null });
    }
  }
  return slots;
}

function listRoms() {
  try {
    return fs
      .readdirSync(ROMS_DIR)
      .filter((f) => ROM_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)));
  } catch {
    return [];
  }
}

// Uploads land here until the admin approves them. It sits inside the roms
// volume so approving is a same-filesystem rename, and listRoms() never sees
// it because it only lists top-level files with a ROM extension.
const PENDING_DIR = path.join(ROMS_DIR, ".pending");
const MAX_PENDING = 20;

class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Strip any path, keep a conservative character set, and require one of the
// supported extensions. Returns null when nothing usable is left.
function cleanRomName(raw) {
  const base = path.basename(String(raw || "")).trim();
  const ext = path.extname(base).toLowerCase();
  if (!ROM_EXTENSIONS.includes(ext)) return null;
  const stem = base
    .slice(0, -ext.length)
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/^[.\s-]+/, "")
    .slice(0, 80)
    .trim();
  return stem ? stem + ext : null;
}

// Check the file is really the console's ROM format, not just renamed: GBA
// headers carry a fixed 0x96 byte at 0xB2, iNES files start with "NES\x1a".
function looksLikeRom(name, buffer) {
  if (name.endsWith(".gba")) return buffer.length >= 0xc0 && buffer[0xb2] === 0x96;
  if (name.endsWith(".nes")) {
    return buffer.length >= 16 && buffer.subarray(0, 4).equals(Buffer.from([0x4e, 0x45, 0x53, 0x1a]));
  }
  return false;
}

function pendingNames() {
  try {
    return fs.readdirSync(PENDING_DIR).filter((f) => ROM_EXTENSIONS.some((ext) => f.endsWith(ext)));
  } catch {
    return [];
  }
}

function listPending() {
  return pendingNames().map((name) => {
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, `${name}.json`), "utf8"));
    } catch {
      // A missing sidecar only loses the uploader label.
    }
    return { name, uploader: meta.uploader || null, uploadedAt: meta.uploadedAt || null, size: meta.size || null };
  });
}

function savePending(rawName, buffer, uploader) {
  const name = cleanRomName(rawName);
  if (!name) throw new UploadError(400, "Only .gba and .nes files can be uploaded.");
  if (!looksLikeRom(name, buffer)) {
    throw new UploadError(400, `That file isn't a valid ${path.extname(name).slice(1).toUpperCase()} ROM.`);
  }
  if (listRoms().includes(name)) throw new UploadError(409, `${name} is already in the library.`);
  const pending = pendingNames();
  if (pending.includes(name)) throw new UploadError(409, `${name} is already waiting for approval.`);
  if (pending.length >= MAX_PENDING) {
    throw new UploadError(429, "The approval queue is full. Try again after the admin reviews it.");
  }
  fs.mkdirSync(PENDING_DIR, { recursive: true });
  fs.writeFileSync(path.join(PENDING_DIR, name), buffer, { flag: "wx" });
  fs.writeFileSync(
    path.join(PENDING_DIR, `${name}.json`),
    JSON.stringify({ uploader, uploadedAt: new Date().toISOString(), size: buffer.length })
  );
  return name;
}

// Names arriving from admin routes must match an existing entry exactly, so
// a crafted name can never reach outside the two directories.
function approvePending(name) {
  if (!pendingNames().includes(name)) throw new UploadError(404, "No such pending upload.");
  if (listRoms().includes(name)) throw new UploadError(409, `${name} is already in the library.`);
  fs.renameSync(path.join(PENDING_DIR, name), path.join(ROMS_DIR, name));
  fs.rmSync(path.join(PENDING_DIR, `${name}.json`), { force: true });
}

function rejectPending(name) {
  if (!pendingNames().includes(name)) throw new UploadError(404, "No such pending upload.");
  fs.rmSync(path.join(PENDING_DIR, name), { force: true });
  fs.rmSync(path.join(PENDING_DIR, `${name}.json`), { force: true });
}

// Removes one snapshot only; the in-game save (.srm) is a different file.
function deleteState(userId, game, slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= STATE_SLOTS) {
    throw new UploadError(400, "No such save slot.");
  }
  try {
    fs.unlinkSync(stateFile(userId, game, slot));
  } catch (err) {
    if (err.code === "ENOENT") throw new UploadError(404, "That slot is already empty.");
    throw err;
  }
}

function deleteRom(name) {
  if (!listRoms().includes(name)) throw new UploadError(404, "No such game.");
  fs.rmSync(path.join(ROMS_DIR, name));
}

module.exports = {
  listRoms,
  listStates,
  deleteState,
  listPending,
  savePending,
  approvePending,
  rejectPending,
  deleteRom,
  UploadError,
};
