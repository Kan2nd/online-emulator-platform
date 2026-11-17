# Container Emulator — orchestration skeleton

A working proof-of-concept for the architecture discussed: one prebuilt
emulator image, spun up as a disposable container per play session, with
save data externalized to persistent storage instead of living in the
container.

```
Browser --> session-manager (Express + dockerode)
                  |
                  | docker.sock (spawns a sibling container per session)
                  v
            emulator container (RetroArch + libretro core, prebuilt image)
                  |
                  +-- reads  /data/roms/<game>        (bind mount, read-only)
                  +-- writes /data/saves/<user>/<game>.srm (bind mount, read-write)
```

## What's implemented

- **`emulator-image/`** — the prebuilt image. RetroArch + the Nestopia (NES)
  and mGBA (GBA) libretro cores, installed once at build time. Nothing game-specific is
  baked in. `entrypoint.sh` is the only per-session logic: it points
  RetroArch's `--save`/`--savestate` flags directly at a path under
  `/data/saves/<user>/`, so the save file is written straight to the mounted
  volume as the emulator runs — no separate copy-out step needed, plus an
  `autosave_interval` so a killed (not just stopped) container doesn't lose
  much progress.
- **`session-manager/`** — the orchestrator. `POST /sessions` spawns an
  emulator container (via `dockerode`, talking to the host Docker daemon
  over the mounted `docker.sock`) with the right ROM and save-directory
  binds for that user/game. `DELETE /sessions/:id` stops it (SIGTERM first,
  so RetroArch flushes SRAM before the grace period expires and the
  container is removed). Session metadata lives in memory for now.
- **`docker-compose.yml`** — builds both images and runs `session-manager`
  locally with `docker.sock` mounted (docker-outside-of-docker).

## What's stubbed / not implemented

- **Video/audio streaming.** `retroarch.cfg` runs with `video_driver=null`
  and `audio_driver=null` so the emulator runs headless in a container with
  no GPU/X server — this proves the core boots, runs, and persists saves,
  but no frames leave the container yet. Real deployments replace the null
  driver with a capture pipeline (e.g. ffmpeg reading RetroArch's video
  callback or an Xvfb framebuffer) feeding a WebRTC or low-latency HLS
  output, with player input coming back over a WebRTC data channel or
  RetroArch's network remote-input protocol.
- **Save storage is a local bind mount**, not object storage. For S3/GCS,
  either (a) mount it as a POSIX filesystem via `s3fs`/`goofys` so RetroArch
  writes directly, keeping `entrypoint.sh` unchanged, or (b) go back to
  local disk inside the container and add explicit `aws s3 cp` sync calls on
  session start/stop in `entrypoint.sh`. `session-manager/src/storage.js` is
  already isolated specifically so swapping this doesn't touch routing code.
- **Session state is in-memory** in `session-manager` — fine for one
  replica, not for a horizontally-scaled deployment (move to Redis/a DB).
- **No container pooling.** Each session does a cold `docker run`; for
  lower perceived latency, pre-warm a pool of idle containers per popular
  game and hand one out instead of starting from scratch.
- **Orchestration is Docker-API-only** — see "The one real gap" under
  CI/CD below; the Kubernetes manifests describe how `session-manager`
  itself deploys, not yet how it would spawn sessions on a real cluster.

## Running it locally

Requires Docker Desktop (with the Linux containers backend) and Docker
Compose.

1. Put a ROM you legally own in `roms/`, e.g. `roms/game.nes` (must work
   with the FCEUmm/NES core unless you change `emulator-image/`).
2. Copy `.env.example` to `.env` and set `ROMS_HOST_DIR`/`SAVES_HOST_DIR` to
   the **absolute host path** of this project's `roms/`/`saves/` folders.
   This is required — see the comment in `docker-compose.yml` for why
   (docker-outside-of-docker binds are resolved by the host daemon, not by
   paths inside the session-manager container).

   ```bash
   docker compose build
   docker compose up session-manager
   ```

3. Start a session:

   ```bash
   curl -X POST localhost:4000/sessions -H "content-type: application/json" \
     -d '{"userId":"alice","game":"game.nes"}'
   ```

4. Check it's running and look at its logs:

   ```bash
   curl localhost:4000/sessions
   curl localhost:4000/sessions/<sessionId>/logs
   ```

5. Stop it — this triggers the save flush:

   ```bash
   curl -X DELETE localhost:4000/sessions/<sessionId>
   ```

   Check `saves/alice/game.srm` now exists and has content. Starting a new
   session with the same `userId`/`game` picks that save file back up.

## CI/CD

- **`.github/workflows/ci.yml`** — on every push/PR: install deps, syntax-check
  `session-manager`, then (on `main` only) build and push both images to
  GHCR, tagged with the git SHA and `latest`.
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

## Observability stack (local)

`docker compose up` now also brings up Prometheus, Grafana, Loki, Promtail,
Alertmanager, and cAdvisor alongside `session-manager`.

- **Grafana**: http://localhost:3000 (admin/admin) — "Container emulator -
  sessions overview" dashboard is pre-provisioned: active sessions, p95
  session-start latency, save-flush error rate.
- **Prometheus**: http://localhost:9090 — scrapes `session-manager:4000/metrics`
  (exposed via `session-manager/src/metrics.js`, using `prom-client`) and
  `cadvisor:8080` for per-container resource stats.
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

## Legal note

ROM distribution is legally murky almost everywhere, even for games you own
on physical media, regardless of where the ROM file itself came from. This
project never bundles, downloads, or fetches ROMs — you provide your own,
and that's a decision to make with your own legal awareness, not something
baked into this skeleton.
