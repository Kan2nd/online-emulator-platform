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
function listStates(userId, game) {
  const base = game.replace(/\.[^.]+$/, "");
  const slots = [];
  for (let slot = 0; slot < STATE_SLOTS; slot++) {
    const file = path.join(SAVES_DIR, userId, `${base}.state${slot === 0 ? "" : slot}`);
    try {
      slots.push({ slot, savedAt: fs.statSync(file).mtime.toISOString() });
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

module.exports = { listRoms, listStates };
