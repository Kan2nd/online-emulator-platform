#!/bin/sh
# One image, many ephemeral containers: this script is the only thing that
# varies per session. It wires a specific ROM + a specific user's save file
# into an already-built emulator image at container start time.
set -eu

: "${GAME:?GAME env var required (e.g. mario.nes)}"
: "${USER_ID:?USER_ID env var required}"

ROM="/data/roms/${GAME}"
SAVE_DIR="/data/saves/${USER_ID}"
mkdir -p "$SAVE_DIR"

BASENAME="${GAME%.*}"
SAVE_FILE="${SAVE_DIR}/${BASENAME}.srm"
STATE_FILE="${SAVE_DIR}/${BASENAME}.state"
touch "$SAVE_FILE"

if [ ! -f "$ROM" ]; then
  echo "[entrypoint] ROM not found at $ROM" >&2
  echo "[entrypoint] place a legally-obtained ROM in roms/ on the host, named ${GAME}" >&2
  exit 1
fi

if [ -z "${CORE:-}" ]; then
  case "$GAME" in
    *.nes) CORE_NAME="nestopia" ;;
    *.gba) CORE_NAME="mgba" ;;
    *)
      echo "[entrypoint] no core mapping for extension of $GAME (edit entrypoint.sh)" >&2
      exit 1
      ;;
  esac
  CORE="$(find /usr/lib -iname "*${CORE_NAME}_libretro.so" 2>/dev/null | head -n1)"
fi

if [ -z "$CORE" ]; then
  echo "[entrypoint] could not locate a libretro core for $GAME" >&2
  exit 1
fi

# Virtual display, streamed to the browser over WebRTC by webrtc_server.py.
# Force SDL2's software renderer — Xvfb has no real GPU/GLX behind it, and
# letting SDL probe opengl/opengles2 first (its default order) is what
# caused the render loop to stall rather than fail cleanly.
export SDL_RENDER_DRIVER=software
# No sound card in the container, but SDL's "dummy" audio device still
# consumes samples in real time. RetroArch syncs emulation speed to its audio
# clock, so without this it free-runs at 100% CPU (and too fast).
export SDL_AUDIODRIVER=dummy

# The container uses host networking, which shares the host's abstract
# X11 socket namespace — a fixed display number would collide between
# concurrent sessions. -displayfd makes Xvfb pick a free number and report it.
DISPLAY_FILE="$(mktemp)"
# Small on purpose: GBA is 240x160, so 480x320 is an exact 2x. Every extra
# pixel is scaled, captured and encoded on a shared CPU; the browser upscales.
Xvfb -displayfd 3 -screen 0 480x320x24 -nolisten tcp 3>"$DISPLAY_FILE" &
for i in $(seq 1 100); do
  [ -s "$DISPLAY_FILE" ] && break
  sleep 0.1
done
export DISPLAY=":$(tr -d '\n' < "$DISPLAY_FILE")"

python3 /usr/local/bin/webrtc_server.py &

# RetroArch ignores --save/--savestate when redirecting saves into its own
# config directory; the directory settings are what it actually honors, and
# they depend on the per-session user, so they're generated here.
cat > /tmp/session.cfg <<EOF
savefile_directory = "$SAVE_DIR"
savestate_directory = "$SAVE_DIR"
EOF

echo "[entrypoint] game=$GAME user=$USER_ID core=$CORE"
echo "[entrypoint] save=$SAVE_FILE state=$STATE_FILE"

# exec replaces this shell with retroarch as PID 1, so `docker stop` sends
# SIGTERM directly to it and it gets a chance to flush SRAM before exiting.
exec retroarch \
  -L "$CORE" \
  --save="$SAVE_FILE" \
  --savestate="$STATE_FILE" \
  --appendconfig="/config/retroarch.cfg|/tmp/session.cfg" \
  --verbose \
  "$ROM"
