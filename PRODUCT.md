# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A class project audience first: a lecturer and classmates watching a demo of how a containerized cloud-emulation platform works, then trying it themselves from a laptop browser on the same Tailscale network. The owner operates it and administers the shared game library.

## Product Purpose

Container Emulator lets someone pick a retro game (GBA or NES) in a browser and play it immediately, while the game actually runs server-side in a disposable container per session and streams back over WebRTC. Success for the demo: a visitor understands that each play session is its own container, starts a game within seconds, and their progress (in-game saves and save-state slots) survives across sessions.

## Positioning

Not a browser-side emulator: emulation runs on the server, one ephemeral container per session, with saves externalized to persistent storage and the stream delivered over WebRTC. The interface is the visible face of that infrastructure.

## Operating Context

- Players sign in to an account the admin created; the first sign-in forces a password change. Saves and save states are stored per account.
- Games come from a shared library. Any player can upload a ROM, but uploads wait in a pending queue until the admin approves them; only approved games appear in the library to play.
- The owner holds the single admin account: approves or rejects pending uploads, and is the only one who can delete games.
- Played on a keyboard (arrow keys, Z/X, A/S, Q/W, Enter, Shift); the browser forwards keys to the emulator.
- Network path today goes through a Tailscale relay (~90 ms round trip), so latency is visible and should be shown honestly.

## Capabilities and Constraints

- Consoles: GBA (.gba) and NES (.nes) only; adding a console requires a new emulator core server-side.
- Per session: live video (480x320, 60 fps target), pause, reset, fullscreen, stop, four save-state slots, live fps and latency readout.
- One game session per browser tab; closing the tab ends the session.
- No audio is streamed yet.
- Admin authentication is a single shared admin token configured on the server. Player accounts are created, reset and deleted on the admin page; there is no self-registration.
- ROMs must be supplied by users; the project ships none.

## Evidence on Hand

- One working ROM on the test server (a GBA ROM hack) used for demos.
- Measured stream performance: 60 fps decoded, 0 packet loss on the optimized build.
- No screenshots, logos, or brand assets exist; no user testimonials or usage numbers exist and none may be invented.

## Product Principles

- Show the machinery honestly: sessions, saves, and latency are visible facts, not hidden.
- The game is the main thing on screen; controls support it and never crowd it.
- Uploading is open, publishing is gated: anyone can contribute, the admin decides what goes live.
- Nothing a player does can delete shared content.
