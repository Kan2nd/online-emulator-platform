"use strict";

// Preloaded with `node -r` to run the real server without Docker: every
// "container" starts instantly and nothing listens on its signaling port.
const path = require("path");

const file = require.resolve(path.join(__dirname, "..", "src", "dockerManager.js"));
let count = 0;
require.cache[file] = {
  id: file,
  filename: file,
  loaded: true,
  exports: {
    startSession: async () => ({ container: { id: `stub${String(++count).padStart(12, "0")}` }, port: 1 }),
    stopSession: async () => {},
    isRunning: async () => true,
    stopOrphans: async () => 0,
    getLogs: async () => "stub log",
    inspect: async () => ({ State: { Running: true } }),
  },
};
