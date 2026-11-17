"use strict";

const fs = require("fs");

// This is the container-internal path (see docker-compose.yml), distinct
// from ROMS_HOST_DIR/SAVES_HOST_DIR used in dockerManager.js for sibling
// container binds. Swap this module for an S3/GCS-backed one later without
// touching index.js.
const ROMS_DIR = process.env.ROMS_DIR || "/data/roms";

// Keep in sync with the extension map in emulator-image/entrypoint.sh —
// anything else in roms/ (READMEs, .gitkeep, stray files) isn't a ROM we
// can actually launch.
const ROM_EXTENSIONS = [".nes", ".gba"];

function listRoms() {
  try {
    return fs
      .readdirSync(ROMS_DIR)
      .filter((f) => ROM_EXTENSIONS.some((ext) => f.toLowerCase().endsWith(ext)));
  } catch {
    return [];
  }
}

module.exports = { listRoms };
