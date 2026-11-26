# Container Emulator

A retro-game streaming platform for a class demo. There is one prebuilt
emulator image, a disposable container per play session, video streamed to
the browser over WebRTC, and save data kept outside the container.

```
Browser ──HTTP/WS──> session-manager (Express + dockerode, port 4000)
   ▲                      │ docker.sock: starts one sibling container per session
   │                      ▼
   └──WebRTC video──  emulator container (host network)
      + input             Xvfb → RetroArch + libretro core (mGBA / Nestopia)
                          GStreamer ximagesrc → VP8 → webrtcbin
                          +-- reads  /data/roms/<game>          (bind mount, read-only)
                          +-- writes /data/saves/<player>/...   (bind mount, read-write)
```

## How it works

- **`emulator-image/`** is the prebuilt image: RetroArch with the mGBA (GBA)
  and Nestopia (NES) cores, Xvfb, GStreamer and a small Python signaling
  server. Nothing game-specific is baked in.
  - `entrypoint.sh` is the only per-session logic. It picks the core from
    the ROM's extension and starts a private X display. It then points
    RetroArch's save and save-state directories at `/data/saves/<player>/`,
    so saves land straight on the mounted volume. `autosave_interval` limits
    what a killed container can lose.
  - `webrtc_server.py` captures the display, encodes it to VP8 and streams
    it over WebRTC. Keypresses come back over a data channel and are
    replayed with XTest, and save, load, reset and pause go to RetroArch's
    stdin command interface.
  - The signaling port is random, and it only accepts the per-session secret
    path that session-manager hands the container. The container ends itself
    after 5 minutes with no viewer (`IDLE_TIMEOUT_SECONDS`).
- **`session-manager/`** is the orchestrator and web UI.
  - `POST /sessions` starts an emulator container through the host's Docker
    daemon (the mounted `docker.sock`). It allows at most `MAX_SESSIONS` at
    once (default 4) and one session per player per game, so two emulators
    never write the same save file.
  - `/stream/<id>` proxies the WebRTC signaling to that container, so the
    browser only ever talks to port 4000 for HTTP and WebSockets.
  - `DELETE /sessions/:id` sends SIGTERM so RetroArch flushes SRAM first.
  - Sessions whose container ended on its own are dropped every 15s. After
    a restart, leftover emulator containers are stopped.
  - Session state is in memory, which is fine for one replica.
- **`docker-compose.yml`** builds both images and runs session-manager plus
  the monitoring stack, all with `restart: unless-stopped`.

## Limits and next steps

- **Save storage is a local bind mount**, not object storage. For S3 or GCS,
  mount the bucket as a filesystem (`s3fs`/`goofys`) so nothing else
  changes, or sync explicitly on session start and stop.
  `session-manager/src/storage.js` is isolated so this doesn't touch the
  routes.
- **One host only.** Sessions live in memory and containers are started
  through one Docker daemon. More hosts would need shared session state
  (Redis or a database) and a Kubernetes backend (see CI/CD).
- **No container pool.** Each session is a cold start of about 5–8 seconds.
  Pre-warmed idle containers would hide that.
- **Network path.** WebRTC needs the browser to reach the server's UDP
  ports directly. Over Tailscale that works, but through a relay (DERP) it
  adds latency; a direct Tailscale connection or a TURN server fixes it.

## Running it locally

Requires Docker with Linux containers and Docker Compose.

1. Put a ROM you legally own (`.gba` or `.nes`) in `roms/`.
2. Copy `.env.example` to `.env` and set `ROMS_HOST_DIR`/`SAVES_HOST_DIR` to
   the **absolute host paths** of `roms/` and `saves/`. Docker resolves
   these binds on the host, not inside session-manager (see the comment in
   `docker-compose.yml`).
3. Build both images (the emulator service sits behind a profile, so name
   it), then start the stack:

   ```bash
   docker compose build session-manager emulator
   docker compose up -d
   ```

4. Open http://localhost:4000, enter a player name and press **Play**.
   Arrow keys move, Z/X are B/A, Enter is Start and Shift is Select.

Run the API tests with `cd session-manager && npm ci && npm test`.

## CI/CD

- **`.github/workflows/ci.yml`** runs on every push and PR. It installs
  dependencies from the lockfile, syntax-checks session-manager, and runs
  the API tests (`session-manager/test/`). It also audits dependencies and
  syntax-checks the emulator's Python and shell scripts. On `main` only, it
  then builds and pushes both images to GHCR, tagged with the git SHA and
  `latest`.
- **Deploys are off by default**: both CD workflows skip unless the
  repository variable `K8S_DEPLOY_ENABLED` is `true` (Settings → Secrets and
  variables → Actions → Variables), since they need a Kubernetes cluster.
- **`.github/workflows/cd-staging.yml`** — on a successful CI run on `main`:
  applies `deploy/k8s/overlays/staging` (idempotent) and rolls the new image
  out, then runs a smoke test against `/health`. Needs a GitHub Environment
  named `staging` with secret `STAGING_KUBECONFIG` (base64 kubeconfig) and
  variable `STAGING_HEALTH_URL`.
- **`.github/workflows/cd-production.yml`** — on a successful staging
  deploy: applies `deploy/k8s/overlays/production`, starts the rollout, then
  **pauses** it. Needs a GitHub Environment named `production` with
  **required reviewers** configured (Settings → Environments) — that
  approval is the real manual gate, since the job itself only reaches the
  pause/resume steps after a reviewer approves it. Resuming completes the
  rollout; extend the "Canary window" step with an automated Prometheus
  query (error rate, p95 latency) if you want unattended canary analysis
  instead of a human eyeballing dashboards during the pause.

**The one real gap**: `session-manager` currently orchestrates emulator
containers via `dockerManager.js` talking to a Docker daemon over
`docker.sock` (dockerode) — a docker-compose/single-host pattern. The
`deploy/k8s/` manifests describe how `session-manager` itself would run as
a Kubernetes Deployment, but nothing in this repo yet makes *it* spawn
emulator sessions as Kubernetes Pods/Jobs — docker.sock sidecar access
("Docker-outside-of-Docker") isn't available or advisable inside a plain
k8s Pod. Before these CD workflows are deploying something that actually
works end-to-end, `dockerManager.js` needs a Kubernetes-API backend (e.g.
via `@kubernetes/client-node`, creating a Pod/Job per session) as an
alternative to the current Docker-API one.

## Observability stack

`docker compose up -d` also brings up Prometheus, Grafana, Loki, Promtail,
Alertmanager, and cAdvisor alongside `session-manager`.

- **Grafana**: http://localhost:3000 (user `admin`, password
  `GRAFANA_ADMIN_PASSWORD` from `.env`, or `admin` if unset) — "Container emulator -
  sessions overview" dashboard is pre-provisioned: active sessions, p95
  session-start latency, save-flush error rate.
- **Prometheus**: http://localhost:9091 (host port 9091, since some servers
  already run a Prometheus on 9090) — scrapes `session-manager:4000/metrics`
  (exposed via `session-manager/src/metrics.js`, using `prom-client`) and
  `cadvisor:8080` for per-container resource stats.
- **cAdvisor**: http://localhost:8081.
- **Alertmanager**: http://localhost:9093 — three rules ship in
  `observability/prometheus/rules/alerts.yml`: `SessionManagerDown`,
  `HighSaveFlushErrorRate`, `SessionStartLatencyHigh`. Replace the
  placeholder Slack webhook in `observability/alertmanager/alertmanager.yml`
  before relying on alerts firing anywhere.
- **Logs**: promtail reads container logs via a bind-mounted
  `/var/lib/docker/containers` — this only works on a **native Linux Docker
  host** (that path lives inside Docker Desktop's VM on Windows/Mac, not on
  your filesystem). On Docker Desktop, set `LOKI_URL` in `.env` instead (see
  `.env.example`) to have emulator containers log straight to Loki via the
  Loki Docker logging driver — one-time setup:
  `docker plugin install grafana/loki-docker-driver:latest --alias loki`.

## Running on a Linux server

This is how the demo server (Ubuntu 24.04) is set up.

1. Install Docker and Compose, and let your user run Docker without sudo
   (log in again afterwards):

   ```bash
   sudo apt-get install -y docker.io docker-compose-v2
   sudo usermod -aG docker "$USER"
   ```

2. Clone the repo and create `.env` from `.env.example` with **absolute
   host paths** for `ROMS_HOST_DIR` / `SAVES_HOST_DIR`, plus generated
   values for `ADMIN_TOKEN` and `GRAFANA_ADMIN_PASSWORD`
   (`openssl rand -hex 24`). Leave `LOKI_URL` unset on Linux.

3. Build both images. Name both services: the emulator image sits behind a
   Compose profile, so a bare `docker compose build` silently skips it.

   ```bash
   docker compose build session-manager emulator
   ```

4. Start it at boot with the bundled systemd unit (edit `User` and
   `WorkingDirectory` in it first if your user or path differ):

   ```bash
   sudo cp deploy/systemd/container-emulator.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now container-emulator
   ```

   This starts session-manager and the monitoring stack. Every service also
   has `restart: unless-stopped`, so it recovers from a Docker restart or
   crash on its own. Check on it with
   `systemctl status container-emulator` and `docker compose ps`.

To update the server later, pull and rebuild:

```bash
cd ~/container-emulator
git pull
docker compose build session-manager emulator
docker compose up -d
```

Roll back with `git checkout <commit>` and the same two commands.

The web UI is then on port 4000. Emulator containers use host networking
(for WebRTC), so the browser must be able to reach the server's address
directly, e.g. over Tailscale.

## Uploading games and the admin key

Anyone can upload a `.gba` or `.nes` ROM from the web UI ("Add a game").
Uploads land in `roms/.pending/` and appear under "Awaiting approval"; they
can't be played until the admin approves them. The server checks the real
ROM header (not just the extension), caps uploads at 48 MB, and holds at
most 20 pending files.

The admin approves or rejects uploads and is the only one who can delete
games. Admin access is a single key set as `ADMIN_TOKEN` in the server's
`.env` (never committed). Generate one with `openssl rand -hex 24`, then
in the UI click **Admin**, paste the key, and **Unlock**. Read it back on
the server with `grep ADMIN_TOKEN ~/container-emulator/.env`. Without
`ADMIN_TOKEN` set, admin actions are refused.

## Legal note

ROM distribution is legally murky almost everywhere, even for games you own
on physical media, regardless of where the ROM file itself came from. This
project never bundles, downloads, or fetches ROMs — you provide your own,
and that's a decision to make with your own legal awareness, not something
baked into this skeleton.
