---
name: Container Emulator
description: A shared retro-game library kept like a lending ledger; every play is a checkout into its own container.
colors:
  ground: "#06080c"
  drawer: "#0c121c"
  drawer-2: "#121b2a"
  rule: "#1e2a3d"
  rule-strong: "#2c3c57"
  ink: "#e7edf8"
  ink-2: "#9dadc8"
  ink-3: "#6f80a0"
  stamp: "#2f5fe8"
  stamp-hover: "#2550cf"
  stamp-text: "#86a8ff"
  stamp-wash: "rgba(47, 95, 232, .14)"
  good: "#86a8ff"
  fair: "#f2b84b"
  poor: "#ff7a7a"
  screen-black: "#000000"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 68"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 68"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 68"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontVariation: "'wdth' 100"
  body-small:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  call-number:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 68"
  stamp:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 800
    letterSpacing: "0.06em"
    fontVariation: "'wdth' 70"
    fontFeature: "'tnum' 1"
  facts:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    fontFeature: "'tnum' 1"
  key:
    fontFamily: "Archivo, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    fontVariation: "'wdth' 75"
rounded:
  hairline: "2px"
  stamp: "3px"
  key: "4px"
  panel: "6px"
  dot: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  gutter: "16px"
  rail: "18px"
  gap: "22px"
  section: "28px"
components:
  button:
    backgroundColor: "{colors.drawer-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.panel}"
    padding: "6px 14px"
    height: "34px"
  button-primary:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    rounded: "{rounded.panel}"
    padding: "6px 14px"
    height: "34px"
  button-primary-hover:
    backgroundColor: "{colors.stamp-hover}"
  button-small:
    typography: "{typography.body-small}"
    padding: "3px 10px"
    height: "28px"
  button-danger:
    backgroundColor: "{colors.drawer-2}"
    textColor: "{colors.poor}"
  button-armed:
    backgroundColor: "{colors.drawer}"
    textColor: "{colors.poor}"
  field:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "6px 10px"
    height: "34px"
  catalog-entry:
    textColor: "{colors.ink}"
    padding: "10px 6px"
  catalog-entry-active:
    backgroundColor: "{colors.stamp-wash}"
  save-slot:
    backgroundColor: "{colors.drawer}"
    rounded: "{rounded.panel}"
    padding: "12px 14px"
  date-stamp:
    textColor: "{colors.stamp-text}"
    typography: "{typography.stamp}"
    rounded: "{rounded.stamp}"
    padding: "2px 8px"
  key-cap:
    backgroundColor: "{colors.drawer-2}"
    textColor: "{colors.ink}"
    typography: "{typography.key}"
    rounded: "{rounded.key}"
    padding: "3px 6px"
  toast:
    backgroundColor: "{colors.drawer-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "10px 16px"
---

# Design System: Container Emulator

## Overview

**Creative North Star: "The Lending Ledger"**

The shared game library is kept like a lending library: every game is catalogued with a call number, every play is a checkout into its own container, and every save is stamped with its date. The ground is black steel; the panels are blue-black drawers pulled out of it; one date-stamp blue does all the marking. Content removed, the world is still recognisable: black drawers, blue stamped boxes, call numbers.

Density is that of an operating ledger, not a launcher. Rows are separated by hairline rules rather than boxed into cards; facts are set as a tabular readout with right-aligned figures; the game screen leads at full width and everything else supports it. There is no cover art and no tile grid: the catalog is a list of call numbers and titles. Machinery is shown honestly; container id, signal port, frame rate and round trip are first-class facts, coloured by one fixed health ramp.

Two voices carry the type: condensed Archivo caps for drawer labels (headings, call numbers, stamps) over plain Archivo at normal width for everything a person reads. Figures are tabular wherever they are counted or compared.

**Key Characteristics:**
- Black steel ground (`ground`) with blue-black drawer panels (`drawer`, `drawer-2`) and hairline rules.
- One blue: the stamp blue marks call numbers, stamps, selection, primary actions and focus. Nothing else is blue unless it is that blue.
- Condensed uppercase drawer labels over a plain grotesk body; tabular figures for every number.
- Signature move: a double-ruled blue date stamp, tilted -3deg, pressing onto a save slot when a save lands.
- One fixed health ramp (good / fair / poor) used everywhere stream quality shows.
- Flat, ruled surfaces; depth only for things that float (toast) or are pressed (key caps).

## Colors

A near-monochrome blue-black steel palette with a single blue voice and a three-step status ramp.

### Primary
- **Date-Stamp Blue** (`stamp`): the fill of primary buttons (Play, Approve, Unlock), the upload progress fill, and text selection. The one saturated surface colour in the world.
- **Stamp Ink** (`stamp-text`): the lighter blue used as *ink* rather than fill: call numbers, the date stamp's border and lettering, the wordmark's second word, the active player token, focus outlines, field focus borders, button hover borders, the caret.
- **Pressed Stamp** (`stamp-hover`): hover state of primary buttons only.
- **Checkout Wash** (`stamp-wash`): the translucent blue behind the catalog row currently checked out.

### Neutral
- **Black Steel** (`ground`): page ground, field backgrounds, the admin box interior.
- **Drawer** (`drawer`): top bar, left rail, save slots, the overlay's action plate. The first pulled-out layer.
- **Inner Drawer** (`drawer-2`): buttons, key caps, toasts. The second layer, one step lighter.
- **Hairline Rule** (`rule`): row separators, panel edges, the screen border, progress track.
- **Strong Rule** (`rule-strong`): button and field strokes, dashed queue and ledger-line borders, scrollbar thumb.
- **Ledger Ink** (`ink`): primary text and titles.
- **Faded Ink** (`ink-2`): secondary text: fact labels, overlay copy, queued titles, key legends.
- **Margin Ink** (`ink-3`): meta lines, counts, placeholders, empty-slot text, the neutral "off" health dot.
- **Screen Black** (`screen-black`): the game screen's letterbox only.

### Status (the health ramp)
- **Good** (`good`): deliberately the same value as Stamp Ink; healthy is the world's own blue, not a foreign green.
- **Fair** (`fair`): an amber for degraded frame rate or latency.
- **Poor** (`poor`): a soft red for bad readings, and for destructive actions (Stop, Delete, Reject) and their armed state, error toasts and error hints.

### Named Rules
**The One Blue Rule.** Every blue on screen is a stamp blue (`stamp`, `stamp-text`, `stamp-hover`, `stamp-wash`). Blue means "marked by the library": a call number, a stamp, a selection, a focus, the primary action. Never introduce a second blue or a decorative blue.

**The Fixed Ramp Rule.** Stream quality uses exactly three levels (good >= 55 fps / <= 120 ms, fair >= 40 fps / <= 200 ms, poor below) plus a neutral `ink-3` "off" for paused, starting or offline. The toolbar shows the worse of the two readings. The same dot and colours appear wherever quality shows; no other component invents its own status colours.

## Typography

**Display Font:** Archivo (variable width 62-125, weight 400-800), with system-ui fallback
**Body Font:** Archivo at normal width (100%), with system-ui fallback

**Character:** One family, two widths. Condensed (68-70% width) bold uppercase Archivo is the drawer-label voice: short, stamped, catalogued. Normal-width Archivo at 400 is the reading voice: plain and legible.

### Hierarchy
- **Display** (700, 26px, condensed caps): the overlay title on the game screen ("Pick a game", "Starting", "Stream lost").
- **Headline** (700, 22px, line-height 1, condensed caps): the wordmark. The now-playing title in the toolbar uses the same voice at 20px.
- **Title** (700, 17px, condensed caps, 0.04em tracking): section heads (Catalog, Awaiting approval, Save slots, Session, Add a game). Slot names use it at 15px; small field labels at 14px.
- **Body** (400, 15px, 1.5): default text, catalog titles, buttons.
- **Body Small** (400, 13px): counts, hints, small buttons, health readout, key legends, upload note.
- **Meta** (400, 12px): console names under catalog titles, slot recency, pending uploader and age.
- **Call Number** (700, 14px, condensed 68%, 0.03em, Stamp Ink): `GBA·001`-style catalog numbers; 18px on the overlay's action plate.
- **Stamp** (800, 13px, condensed 70%, 0.06em, uppercase, tabular): the date stamp lettering.
- **Facts** (400, 14px, tabular, right-aligned values): the session readout table.

### Named Rules
**The Drawer Label Rule.** Condensed uppercase is for labels only: headings, call numbers, stamps, the wordmark. Sentences, titles of games, values and button text stay at normal width and in sentence case.

**The Tabular Figures Rule.** Any number that is counted, compared or ticks (counts, ports, fps, ms, timestamps, stamps) is set with tabular figures.

## Layout

A two-column operating layout under a single top bar. The top bar (`drawer`, 12px 24px padding, hairline bottom rule) carries the wordmark, the player field and the admin entry, wrapping when narrow. Below it a fixed 340px left rail (`drawer`, 20px 18px 28px padding, 28px between sections) holds the catalog, the awaiting-approval queue and the upload block; the main work column (22px 28px 40px padding, 22px gaps) leads with the 3:2 game screen at full width, capped at `100vh - 260px`, then the toolbar, then a lower grid of save slots (1.6fr) beside the session facts (min 260px, 1fr), then the key legend.

Spacing runs on a small tight scale (6, 8, 10, 12, 14px inside components; 16-28px between regions). Lists are ruled rows, not spaced cards: catalog rows are a 74px call-number column, a flexible title column and an actions column, separated by hairline rules.

Responsive behaviour: below 1100px the lower grid stacks (slots above facts). Below 900px the rail stacks above the work column, its right rule becoming a bottom rule, and the work column takes a 16px gutter; starting a game scrolls the screen into view. Below 640px the toolbar's four controls become an equal four-column grid at full width. Save slots stay two columns.

## Elevation & Depth

Flat and ruled. Depth is conveyed by tonal layering (`ground` < `drawer` < `drawer-2`) and by hairline and strong rules, not by shadows. Only two things cast a shadow: the toast, because it floats above the page, and key caps, because they are physical keys.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(0, 0, 0, .45)`): toasts only.
- **Key Press** (`box-shadow: 0 1px 2px rgba(0, 0, 0, .5)`): `kbd` key caps only.

### Named Rules
**The Drawer Not Card Rule.** Panels are drawers pulled from the steel: a tone step and a rule, never a shadow. A new panel takes `drawer` or `drawer-2` and a `rule` edge.

## Shapes

Gently squared corners throughout: 6px (`panel`) on buttons, fields, slots, the screen, the admin box, the overlay plate and toasts; 4px on key caps; 3px on the stamp and focus outline; 2px on the progress track; full circles only for the 8-9px health dots. Borders are 1px; dashed borders mean "not yet": empty save slots, the pending queue's rules, and the ledger line shown before a checkout. The stamp is the one shape that breaks the grid: a double rule (2px border plus a 1px outline offset 2px) tilted -3deg.

## Components

### Buttons
Quiet drawer-coloured keys; only the primary action is filled blue.
- **Shape:** gently squared (6px), minimum height 34px, 6px 14px padding; small variant 28px tall, 3px 10px, 13px text.
- **Default:** `drawer-2` fill, `rule-strong` stroke, `ink` text. Hover shifts the stroke to `stamp-text`. Disabled at 45% opacity.
- **Primary:** `stamp` fill and stroke, white 600 text; hover to `stamp-hover`.
- **Danger:** default fill with `poor` text; hover stroke turns `poor`; disabled falls to `ink-3`.
- **Armed (two-step confirm):** destructive actions (Reset, Delete, Reject) take two clicks on the same button. The first click arms it as an outline: `drawer` ground, `poor` stroke and 600 `poor` text, no fill; the label becomes "Confirm reset?" etc. It disarms after 4s.

### Inputs / Fields
- **Style:** `ground` fill, 1px `rule-strong` stroke, 6px radius, 6px 10px padding, 34px tall; placeholder in `ink-3`.
- **Focus:** stroke shifts to `stamp-text`; no glow. Elsewhere, `:focus-visible` draws a 2px `stamp-text` outline offset 2px.
- **Error:** a `poor` hint line (13px) beneath, announced as an alert.

### Catalog Rows
Ruled list rows, never tiles: call number in Stamp Ink condensed caps, title in body with ellipsis, console name in meta, then Play (primary, small) and, in admin mode, Delete (danger, small, armed confirm). The checked-out row takes the `stamp-wash` background and its button reads "Playing". The awaiting-approval queue uses the same row grammar with dashed `rule-strong` rules and `ink-2` titles.

### Save Slots
Four `drawer` panels in a two-column grid, 6px radius, 12px 14px padding, min 118px tall. The section note names the player as a token in Stamp Ink at 600 ("Player **name** · 4 slots"). Header: condensed "Slot N" label and a recency note in `ink-3` (only within 24h). Empty slots have a dashed border and "Empty" in `ink-3`. Save and Load share the footer equally. Before a checkout the grid is replaced by a single dashed ledger line rather than four disabled cards.

### Date Stamp (signature)
The world's one signature move. A saved slot carries "SAVED 25 NOV · 14:02" in `stamp-text`, condensed 800 caps, tabular, inside a 2px border plus 1px outline at 2px offset, 3px radius, tilted -3deg at 92% opacity. When a save lands, the stamp presses in: 320ms from scale 1.55, blurred and transparent to rest, on `cubic-bezier(.16, 1, .3, 1)`. Under reduced motion it appears without the press.

### Session Facts
A two-column table: `ink-2` labels left (42% width), tabular right-aligned values, hairline rules between rows. Frame rate and round trip carry a leading 8px health dot from the fixed ramp. Paused is a state, not a level: the frame-rate row reads "Paused" with no dot.

### Health Readout
In the toolbar: a 9px dot plus 13px `ink-2` text ("Good · 60 fps · 92 ms"), live-announced. Dot colour follows the fixed ramp; `ink-3` when off, starting or paused.

### Game Screen and Overlay
Black 3:2 screen with a hairline border and 6px radius, pixelated scaling. When idle or connecting, an overlay of `ground` at 82% opacity carries a Display title, `ink-2` copy (max 42ch) and the next step itself: a drawer plate with the first call number, title and Play, or a single primary button.

### Navigation
There is no navigation chrome; the top bar is a header with wordmark ("Container" in `ink`, "Emulator" in `stamp-text`, condensed caps 22px), a "Player" field and a small Admin toggle that reads "Admin · on" when unlocked.

### Key Caps
Controls legend keys: `drawer-2` fill, `rule-strong` stroke, 4px radius, 3px 6px padding, minimum 26px wide so single letters and arrows sit on equal caps, condensed 600 12px label, Key Press shadow.

### Toast
Bottom-centred `drawer-2` panel, `rule-strong` stroke (`poor` for errors), 6px radius, Float shadow; slides up 14px and fades in over 250ms, dismisses after 3.2s.

## Do's and Don'ts

### Do:
- **Do** keep every blue a stamp blue: `stamp` for fills, `stamp-text` for ink, focus and hover strokes.
- **Do** set headings, call numbers and stamps in condensed (68-70% width) bold uppercase Archivo, and everything else at normal width.
- **Do** use tabular figures for every count, port, fps, latency and timestamp.
- **Do** separate list rows with hairline `rule` lines and layer panels by tone (`ground` < `drawer` < `drawer-2`).
- **Do** use the fixed good / fair / poor ramp, with an `ink-3` neutral for off or paused, anywhere stream quality appears.
- **Do** guard destructive actions with the two-step armed button in `poor`.
- **Do** use dashed borders for things that are empty or not yet live (empty slots, pending queue, pre-checkout ledger line).
- **Do** keep the game screen as the largest thing on the page, leading at full width.

### Don't:
- **Don't** build a launcher grid of cover tiles or invent box art; games are catalogue rows with call numbers.
- **Don't** introduce a second accent hue or a green "good" state; good is the stamp's own blue.
- **Don't** put shadows on panels, slots or buttons; only toasts and key caps cast shadows.
- **Don't** set sentences, game titles or button labels in condensed caps.
- **Don't** fill an armed destructive button; armed is a `poor` outline on the drawer ground.
- **Don't** tilt, double-rule or animate anything other than the date stamp; the press belongs to the save landing.
