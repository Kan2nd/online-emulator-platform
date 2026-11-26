#!/usr/bin/env python3
"""Streams the Xvfb display to one browser over WebRTC and injects its input.

GStreamer captures the X11 display (ximagesrc), encodes VP8 and hands it to
webrtcbin. A tiny WebSocket server carries the SDP/ICE signaling; once the
peer connection is up, video flows over RTP and keypresses come back over a
WebRTC data channel and are replayed through XTest.
"""
import asyncio
import ctypes
import json
import os
import queue
import signal
import threading
import time

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import Gst, GstSdp, GstWebRTC  # noqa: E402

import websockets  # noqa: E402

Gst.init(None)

DISPLAY = os.environ.get("DISPLAY", ":99")
# Host networking exposes the signaling port on every host interface, so
# only a client that knows this per-session secret path (session-manager's
# proxy) may connect. Unset = no check, for running the image by hand.
SIGNAL_TOKEN = os.environ.get("SIGNAL_TOKEN", "")
# With no browser connected for this long (a closed laptop, a crashed tab
# that never sent its DELETE), end the session instead of emulating forever.
IDLE_SECONDS = int(os.environ.get("IDLE_TIMEOUT_SECONDS", "300"))

# Whitelist only: browser-supplied key names never reach xdotool unmapped.
KEYMAP = {
    "ArrowUp": "Up",
    "ArrowDown": "Down",
    "ArrowLeft": "Left",
    "ArrowRight": "Right",
    "Enter": "Return",
    "Shift": "Shift_R",
    "z": "z",
    "x": "x",
    "a": "a",
    "s": "s",
    "q": "q",
    "w": "w",
}

PIPELINE = (
    "webrtcbin name=webrtc bundle-policy=max-bundle "
    # remote=true disables MIT-SHM capture: the shared-memory attach is denied
    # in the container, and Xlib's default handler then kills the process.
    f"ximagesrc display-name={DISPLAY} use-damage=false show-pointer=false remote=true "
    "! video/x-raw,framerate=60/1 ! videoconvert "
    "! queue max-size-buffers=2 leaky=downstream "
    # Latency-first encoding: no look-ahead, tiny rate-control buffers (ms),
    # and few keyframes (each one is a large burst that causes packet loss).
    "! vp8enc deadline=1 cpu-used=8 end-usage=cbr target-bitrate=1500000 "
    "keyframe-max-dist=240 lag-in-frames=0 threads=2 "
    "buffer-size=200 buffer-initial-size=100 buffer-optimal-size=150 "
    "! rtpvp8pay picture-id-mode=15-bit "
    "! application/x-rtp,media=video,encoding-name=VP8,payload=96 "
    "! webrtc."
)


class XKeys:
    """Persistent XTest connection: injecting a key is a couple of Xlib calls
    instead of spawning a process per keypress."""

    def __init__(self, display):
        self.x11 = ctypes.CDLL("libX11.so.6")
        self.xtst = ctypes.CDLL("libXtst.so.6")
        self.x11.XOpenDisplay.restype = ctypes.c_void_p
        self.x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
        self.x11.XStringToKeysym.restype = ctypes.c_ulong
        self.x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
        self.x11.XKeysymToKeycode.restype = ctypes.c_ubyte
        self.x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        self.x11.XFlush.argtypes = [ctypes.c_void_p]
        self.xtst.XTestFakeKeyEvent.argtypes = [
            ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong,
        ]
        self.dpy = self.x11.XOpenDisplay(display.encode())
        if not self.dpy:
            raise RuntimeError(f"cannot open X display {display}")
        self.lock = threading.Lock()

    def send(self, keysym_name, down):
        keysym = self.x11.XStringToKeysym(keysym_name.encode())
        with self.lock:
            keycode = self.x11.XKeysymToKeycode(self.dpy, keysym)
            if keycode == 0:  # unmapped key: an X error would kill the process
                return
            self.xtst.XTestFakeKeyEvent(self.dpy, keycode, 1 if down else 0, 0)
            self.x11.XFlush(self.dpy)


keys = None


class Peer:
    def __init__(self, ws, loop):
        self.ws = ws
        self.loop = loop
        self.channel = None
        self.pipe = Gst.parse_launch(PIPELINE)
        self.webrtc = self.pipe.get_by_name("webrtc")
        self.webrtc.connect("on-ice-candidate", self._on_ice_candidate)

    def start(self):
        self.pipe.set_state(Gst.State.PLAYING)
        # webrtcbin answers create-offer with a NULL offer until caps have
        # flowed through the encoder branch, so wait for PLAYING first.
        self.pipe.get_state(5 * Gst.SECOND)
        self.channel = self.webrtc.emit("create-data-channel", "input", None)
        if self.channel is not None:
            self.channel.connect("on-message-string", self._on_input)
        self._create_offer()

    def stop(self):
        self.pipe.set_state(Gst.State.NULL)

    def _send(self, obj):
        asyncio.run_coroutine_threadsafe(self.ws.send(json.dumps(obj)), self.loop)

    def _create_offer(self, tries=10):
        promise = Gst.Promise.new_with_change_func(self._on_offer_created, tries, None)
        self.webrtc.emit("create-offer", None, promise)

    def _on_offer_created(self, promise, tries, _):
        promise.wait()
        # Keep `reply` alive for this whole function: it owns the offer, and
        # chaining get_reply().get_value() lets it be freed immediately,
        # leaving offer.sdp dangling (segfault).
        reply = promise.get_reply()
        offer = reply.get_value("offer")
        if offer is None:
            if tries > 0:
                threading.Timer(0.5, self._create_offer, args=(tries - 1,)).start()
            else:
                print("[signal] could not create an offer", flush=True)
            return
        # Read the SDP before handing the offer to set-local-description,
        # which takes ownership of it and leaves offer.sdp NULL afterwards.
        sdp_text = offer.sdp.as_text()
        self.webrtc.emit("set-local-description", offer, Gst.Promise.new())
        self._send({"type": "offer", "sdp": sdp_text})

    def _on_ice_candidate(self, _element, mline, candidate):
        self._send({"type": "ice", "sdpMLineIndex": mline, "candidate": candidate})

    def handle(self, msg):
        kind = msg.get("type")
        if kind == "answer":
            _, sdp = GstSdp.SDPMessage.new()
            GstSdp.sdp_message_parse_buffer(msg["sdp"].encode(), sdp)
            answer = GstWebRTC.WebRTCSessionDescription.new(
                GstWebRTC.WebRTCSDPType.ANSWER, sdp
            )
            self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())
        elif kind == "ice":
            self.webrtc.emit("add-ice-candidate", msg["sdpMLineIndex"], msg["candidate"])

    def _on_input(self, _channel, text):
        try:
            msg = json.loads(text)
            if msg.get("t") == "cmd":
                commands.run(msg["action"], msg.get("slot"))
                return
            keysym = KEYMAP[msg["key"]]
            down = {"down": True, "up": False}[msg["t"]]
        except (ValueError, KeyError, TypeError):
            return
        if keys is not None:
            keys.send(keysym, down)


class RetroArchCommands:
    """Writes RetroArch stdin commands (stdin_cmd_enable) through the FIFO.

    This RetroArch has no "save to slot N" command, only slot +/-, so the
    current slot is tracked here. Commands act like one-frame hotkey presses,
    so two in the same frame can merge; a worker thread spaces them out.
    """

    MAX_SLOT = 3
    GAP_SECONDS = 0.08  # ~5 frames at 60 fps

    def __init__(self, path):
        self.path = path
        self.fd = None
        self.slot = 0
        self.lock = threading.Lock()
        self.queue = queue.Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def run(self, action, slot=None):
        with self.lock:
            if action in ("save", "load"):
                if not isinstance(slot, int) or not 0 <= slot <= self.MAX_SLOT:
                    return
                step = "STATE_SLOT_PLUS" if slot > self.slot else "STATE_SLOT_MINUS"
                for _ in range(abs(slot - self.slot)):
                    self.queue.put(step)
                self.slot = slot
                self.queue.put("SAVE_STATE" if action == "save" else "LOAD_STATE")
            elif action == "reset":
                self.queue.put("RESET")
            elif action == "pause":
                self.queue.put("PAUSE_TOGGLE")

    def _worker(self):
        while True:
            command = self.queue.get()
            if self.fd is None:
                self.fd = os.open(self.path, os.O_WRONLY | os.O_NONBLOCK)
            os.write(self.fd, (command + "\n").encode())
            time.sleep(self.GAP_SECONDS)


commands = RetroArchCommands(os.environ.get("RA_CMD_FIFO", "/tmp/ra_cmd"))


current = None
idle_since = time.monotonic()


async def handler(ws, path=None):
    global current, idle_since
    path = path if path is not None else getattr(ws, "path", "")
    if SIGNAL_TOKEN and path != "/" + SIGNAL_TOKEN:
        await ws.close(code=4001, reason="unauthorized")
        return
    if current is not None:
        current.stop()
    loop = asyncio.get_running_loop()
    peer = Peer(ws, loop)
    current = peer
    idle_since = None
    await loop.run_in_executor(None, peer.start)
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict):
                peer.handle(msg)
    finally:
        peer.stop()
        if current is peer:
            current = None
            idle_since = time.monotonic()


async def idle_watchdog():
    while True:
        await asyncio.sleep(10)
        if idle_since is not None and time.monotonic() - idle_since > IDLE_SECONDS:
            print(f"[signal] no viewer for {IDLE_SECONDS}s, ending the session", flush=True)
            # PID 1 is RetroArch (entrypoint.sh execs it): SIGTERM makes it
            # flush SRAM and exit, and the auto-removed container goes away.
            os.kill(1, signal.SIGTERM)
            return


async def main():
    global keys
    keys = XKeys(DISPLAY)
    # SIGNAL_PORT=0 (default) lets the OS pick a free host port, which we
    # report on stdout for session-manager to read — the container uses host
    # networking, so only the host itself can say what's actually free.
    server = await websockets.serve(
        handler, "0.0.0.0", int(os.environ.get("SIGNAL_PORT", "0"))
    )
    port = server.sockets[0].getsockname()[1]
    print(f"[signal] listening on port {port}", flush=True)
    if IDLE_SECONDS > 0:
        await idle_watchdog()
    await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
