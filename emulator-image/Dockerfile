FROM debian:bookworm-slim

# RetroArch + libretro cores (Nestopia for NES, mGBA for GBA — the actual
# package names available in Debian bookworm's main component; there's no
# libretro-fceumm there). No ROMs are baked into this image — they're
# bind-mounted at runtime from the host's roms/ directory, which you
# populate yourself. Add more *-libretro core packages here (and to
# entrypoint.sh's extension map) to support others.
RUN apt-get update && apt-get install -y --no-install-recommends \
      retroarch \
      libretro-nestopia \
      libretro-mgba \
      xvfb \
      libx11-6 \
      libxtst6 \
      gstreamer1.0-plugins-base \
      gstreamer1.0-plugins-good \
      gstreamer1.0-plugins-bad \
      gstreamer1.0-nice \
      gir1.2-gstreamer-1.0 \
      gir1.2-gst-plugins-base-1.0 \
      gir1.2-gst-plugins-bad-1.0 \
      python3-gi \
      python3-websockets \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY webrtc_server.py /usr/local/bin/webrtc_server.py

# No EXPOSE/port publishing: the container runs with host networking (see
# dockerManager.js) so WebRTC ICE candidates are the host's real addresses.

COPY retroarch.cfg /config/retroarch.cfg
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
