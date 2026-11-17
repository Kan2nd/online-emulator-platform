"use strict";

const promClient = require("prom-client");

promClient.collectDefaultMetrics();

const activeSessions = new promClient.Gauge({
  name: "container_emulator_active_sessions",
  help: "Number of emulator sessions currently running",
});

const sessionStartDuration = new promClient.Histogram({
  name: "container_emulator_session_start_duration_seconds",
  help: "Time to start an emulator container for a new session",
  buckets: [0.5, 1, 2, 5, 10, 20],
});

const saveFlushErrors = new promClient.Counter({
  name: "container_emulator_save_flush_errors_total",
  help: "Number of times stopping a session failed to flush cleanly",
});

module.exports = {
  register: promClient.register,
  activeSessions,
  sessionStartDuration,
  saveFlushErrors,
};
