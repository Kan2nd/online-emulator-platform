"use strict";

const Docker = require("dockerode");
const { randomBytes } = require("crypto");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const EMULATOR_IMAGE = process.env.EMULATOR_IMAGE || "container-emulator/emulator:latest";

// IMPORTANT: this service talks to the HOST's docker daemon over the
// mounted docker.sock (docker-outside-of-docker). When it asks the daemon
// to bind-mount a volume into a sibling container, the source path must be
// a path on the HOST filesystem, not a path inside *this* container — even
// though this container also has roms/saves mounted at /data/... for its
// own read access (see storage.js). Hence two separate env vars.
const ROMS_HOST_DIR = process.env.ROMS_HOST_DIR;
const SAVES_HOST_DIR = process.env.SAVES_HOST_DIR;

if (!ROMS_HOST_DIR || !SAVES_HOST_DIR) {
  throw new Error(
    "ROMS_HOST_DIR and SAVES_HOST_DIR must be set to absolute HOST paths " +
      "(see .env.example) so sibling containers can be bind-mounted correctly."
  );
}

// Optional: point emulator container logs straight at Loki via the Loki
// Docker logging driver, instead of relying on promtail reading host log
// files (which only works on native Linux Docker hosts — see README). Needs
// `docker plugin install grafana/loki-docker-driver:latest --alias loki`
// installed on the host once; unset LOKI_URL to skip this entirely.
const LOKI_URL = process.env.LOKI_URL;

const SESSION_LABEL = "container-emulator.game";

async function startSession({ userId, game, signalToken }) {
  const hostConfig = {
    Binds: [`${ROMS_HOST_DIR}:/data/roms:ro`, `${SAVES_HOST_DIR}:/data/saves`],
    AutoRemove: true,
    // Host networking so WebRTC ICE candidates are the host's real
    // (Tailscale/LAN) addresses, reachable by the browser without NAT
    // mapping. The tradeoff: no network-namespace isolation for these
    // containers, and no Docker-managed port publishing — the container
    // binds a free host port itself and reports it (see waitForPort).
    NetworkMode: "host",
  };

  if (LOKI_URL) {
    hostConfig.LogConfig = {
      Type: "loki",
      Config: { "loki-url": LOKI_URL, "loki-retries": "3", "loki-batch-size": "400" },
    };
  }

  const container = await docker.createContainer({
    // Readable in `docker ps`, cAdvisor and Loki instead of a random name.
    name: `emu-${userId}-${randomBytes(3).toString("hex")}`,
    Image: EMULATOR_IMAGE,
    // SIGNAL_TOKEN: with host networking the signaling port is open on every
    // host interface, so the emulator only accepts connections on this
    // secret path, which only session-manager's /stream proxy knows.
    Env: [`GAME=${game}`, `USER_ID=${userId}`, `SIGNAL_TOKEN=${signalToken}`],
    HostConfig: hostConfig,
    Labels: { "container-emulator.userId": userId, [SESSION_LABEL]: game },
  });

  await container.start();
  try {
    const port = await waitForPort(container);
    return { container, port };
  } catch (err) {
    await container.stop({ t: 1 }).catch(() => {});
    throw err;
  }
}

// The signaling server binds port 0 (OS-chosen, so guaranteed free on the
// host) and prints it; session-manager can't probe host ports itself since
// it runs in its own network namespace.
async function waitForPort(container, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const buffer = await container.logs({ stdout: true, stderr: true });
    const match = /\[signal\] listening on port (\d+)/.exec(buffer.toString("utf8"));
    if (match) return Number(match[1]);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("emulator container never reported its signaling port");
}

async function stopSession(containerId, { timeoutSeconds = 10 } = {}) {
  // SIGTERM first (grace period = timeoutSeconds) so RetroArch flushes SRAM
  // before Docker escalates to SIGKILL.
  const container = docker.getContainer(containerId);
  try {
    await container.stop({ t: timeoutSeconds });
  } catch (err) {
    // 304: already stopped, 404: already gone (AutoRemove after it exited).
    // Either way the session is over, which is what the caller wants.
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }
}

// True while the container exists and is running. A container that exited
// on its own (game crashed, idle timeout) is auto-removed, so 404 = ended.
async function isRunning(containerId) {
  try {
    const info = await docker.getContainer(containerId).inspect();
    return Boolean(info.State && info.State.Running);
  } catch (err) {
    if (err.statusCode === 404) return false;
    throw err;
  }
}

// Sessions live only in session-manager's memory, so after it restarts any
// emulator containers still running are unreachable. Stop them.
async function stopOrphans() {
  const running = await docker.listContainers({ filters: { label: [SESSION_LABEL] } });
  await Promise.all(running.map((c) => stopSession(c.Id).catch(() => {})));
  return running.length;
}

async function getLogs(containerId) {
  const container = docker.getContainer(containerId);
  const buffer = await container.logs({ stdout: true, stderr: true, tail: 200 });
  return buffer.toString("utf8");
}

async function inspect(containerId) {
  const container = docker.getContainer(containerId);
  return container.inspect();
}

module.exports = { startSession, stopSession, isRunning, stopOrphans, getLogs, inspect };
