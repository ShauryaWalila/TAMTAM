# Touch Partner — Pin-Art Redesign + Handprint Capture & Replay

**Date:** 2026-04-25
**Status:** Approved (design phase)
**Scope:** `app/touch-partner.tsx` (sender), new `app/touch-view/[momentId].tsx` (receiver), reusable `<PinGrid>` component, supabase schema extension.

## Goal

Replace the current soft-glow touch screen with a tactile pin-art aesthetic where:
- Pins depress only where the finger actually contacts (sharp boundary, no bleed).
- The depression *holds* after lifting — your handprint stays on screen as a memento.
- The full handprint and gesture sequence is recorded and sent to the partner.
- The partner can view the static handprint and replay the gestures over time.

## Aesthetic Direction

**Pin-art toy** — mechanical, metallic, no glow. Silver pins on a charcoal board with subtle drop shadows under resting pins; pressed pins look *sunken into the board*, not lit up.

## Architecture

Three pieces, with the pin grid extracted so sender and receiver share the renderer.

### `components/PinGrid/PinGrid.tsx` — reusable Skia renderer
- Props: `activeTouches: SharedValue<Touch[]>`, `heldImprint: SharedValue<Float32Array>`, `isClearing: SharedValue<number>`.
- Pure visual — no capture, no storage, no business logic.
- Two consumers: sender drives shared values from real touches; receiver drives them from recorded frames.

### `app/touch-partner.tsx` — sender (refactored)
- Owns touch capture and held-imprint state machine.
- Recorder writes frames into a JS-thread buffer at ~30fps while at least one touch is active.
- On Send: serializes payload → supabase → animates confirmation → clears state.
- On two-finger 1s long-press: clears the imprint with a sweep animation.

### `app/touch-view/[momentId].tsx` — receiver (new)
- Loads a moment from supabase by id.
- Drives `<PinGrid>` from the recorded payload using `useFrameCallback` to step through frames.
- Buttons: "Feel it" (replay) and close. No editing, no capture.

### `lib/touchRecording.ts` — pure helpers
- `createRecorder()` → `{ tick(touches, ts), finalize() }` — captures frames into a buffer, dedups identical frames.
- `createPlayer(recording)` → `{ frameAt(elapsedMs) }` — binary-searches and interpolates between adjacent frames.
- No React, no Skia — testable in isolation.

## Visual / Rendering

**Grid**
- Hex-packed (rows offset by half a step) at ~14px spacing. Removes the visible "rows of dots" stripe artifact of a square grid.
- Pins rendered as filled circles, 5px cap radius, with a tiny dark base shadow under each so each pin reads as sitting in a hole.

**Touch boundary (the main fix)**
- `MAX_DIST = 22px` (≈1.5 pin-widths). Pins farther than that do not move at all.
- Falloff curve = `smoothstep(0, MAX_DIST, distance)` clamped at edges. Sharp boundary, full pressure inside, zero outside. Replaces the current soft `pow(r, 1.2)`.
- Result: only pins under the actual fingerprint area depress.

**3D look (no glow)**
- Background: deep charcoal `#0a0a0a` with subtle vertical gradient (lighter top, darker bottom) — implies a single light source above.
- Stems (cylinder bodies behind each pin): `#1a1a1a` (currently `#080808` — invisible). Visible enough to read depth.
- Resting cap: brushed-metal silver `#9aa0a6`.
- Pressed cap: darkens to `#3a3a3a` and shrinks slightly (further from camera), so it reads as sunken into the board, not lit up.
- Per-pin shadow: light `Shadow dx=1 dy=2`. Resting pins cast shadow; pressed pins do not (they're flush with the board).
- No `BlurMask` heatmap layer — that's the glow we're removing.
- Parallax: keep the current center-bias parallax shift (factor 0.12) — sells the 3D.

**Held imprint visual**
- Pins that have been pressed stay at their max pressed state. Visually identical to currently-pressed pins, just persistent. Sliding leaves a depression trail.
- "Fresh press" cue: when a pin first crosses the press threshold, a 200ms scale-in animation runs on the depressed cap so the imprint feels alive while being laid down.

**Clear gesture**
- Two-finger long-press (1s) clears the imprint with a left-to-right sweep animation (pins rise back over ~600ms).
- Avoids accidental clears with normal one-finger touches.

## Touch Capture & State Model

**Capture method**
- `onTouchStart` / `onTouchMove` / `onTouchEnd` on a full-screen `View`. Already proven for whole-hand multi-touch in `notes/multi_touch_backup.tsx`. No need for `react-native-gesture-handler`.
- Read every native touch each event: `event.nativeEvent.touches[].locationX/Y/identifier`.
- Where available, also read `force` (iOS) and `radiusX`/`radiusY` or `touchMajor` (Android) — pass through as per-touch radius `r`. Falls back to `r = 14` (≈one pin spacing) when the device doesn't expose contact size.

**Sender state**
- `activeTouches: SharedValue<Touch[]>` — current contact points (drives live render).
- `heldImprint: SharedValue<Float32Array>` — length `PIN_COUNT`, each entry = max press level the pin has reached this session (drives persistent imprint).
- `isClearing: SharedValue<number>` — 0..1, animates the clear sweep when triggered.

**Per-frame UI-thread work (`useFrameCallback`)**
1. For each pin `i`, compute `live[i] = max over active touches of smoothstep(distance, 0, MAX_DIST)`.
2. `heldImprint[i] = max(heldImprint[i], live[i])` — monotonic; never decreases except on clear.
3. Renderer reads `heldImprint[i]` for cap depression and color. Held imprint is the source of truth — active touches just feed into it.

**Recorder (parallel to state machine)**
- Every ~33ms while at least one touch is active, push a frame `{ t: ms-since-start, points: [{x, y, r}] }` to a JS-thread buffer.
- Frame dropped if every point's `x`, `y`, `r` differ by < 1px from the previous frame's same-id point AND the touch-id set is unchanged — keeps payload small without losing motion fidelity.
- Buffer caps at ~10s of duration to bound payload size.

**Send flow**
- Tap "Send Touch" → recorder finalizes → returns `{ frames, duration_ms, screen, final_imprint }` → write to supabase → animate confirmation (`Heart` → `Sparkles`) → clear all state and recorder.

**Clear gesture details**
- Two-finger 1s hold → triggers `isClearing` animation (0→1 over 600ms). On completion, zeros `heldImprint` and resets recorder. While clearing, ignore new touches.

## Data + Storage

Extend the existing `moments` table rather than create a new one — keeps the timeline simple.

```sql
alter table moments add column touch_payload jsonb;
```

Payload shape:

```ts
{
  v: 1,                                  // schema version
  duration_ms: number,                   // total time from first touch to send
  screen: { w: number, h: number },      // sender's screen dims
  frames: [
    { t: number, points: [{ x, y, r }] } // t = ms since recording start
  ],
  final_imprint: string                  // base64-encoded Float32Array of held pressed amounts
}
```

**Why this shape**
- `frames` is the replay timeline. Player linearly interpolates between adjacent frames.
- `final_imprint` is the held depression state at the moment of send. Receiver renders this *first* (the resting handprint) so they see the imprint immediately on opening — without it, the imprint would have to "build up" from blank every load, losing the "your handprint is here" feel.
- `screen` lets receiver normalize coordinates if their screen size differs from sender's. Player applies `x * receiverW/senderW`, `y * receiverH/senderH`.

**Size budget (worst case)**
- 5s × 30fps × 5 fingers × ~24 bytes per point ≈ 18KB JSON.
- `final_imprint`: 1680 floats × 4 bytes = 6.7KB raw → ~9KB base64.
- Total ~27KB per moment. Acceptable for a `jsonb` column.
- Real payloads will usually be much smaller because static frames are deduped.

**Backwards compatibility**
- Keep the existing `message: 'sent a touch'` write so anything that reads it still works.
- `touch_payload` is nullable — old rows simply don't have it.
- Receiver: if `touch_payload` is null, fall back to the existing generic notification UI.

## Playback (Receiver)

**Screen:** `app/touch-view/[momentId].tsx` — opens when partner taps a touch moment in their timeline.

**Load flow**
1. Read `moments` row by id from supabase → parse `touch_payload`.
2. Decode `final_imprint` base64 → `Float32Array`.
3. Build `frameAt(elapsedMs)` lookup over the `frames` array (binary search + linear interpolation between adjacent frames).
4. Apply screen scaling factors based on receiver dims vs sender's `screen`.

**Initial render (resting state)**
- `<PinGrid>` mounts with `heldImprint` pre-populated from the decoded `final_imprint`.
- Partner immediately sees the static handprint on screen open. No play-through required to see what was sent.

**Replay button — "Feel it"**
- On tap: starts playback. `useFrameCallback` reads `Date.now() - startTime` → calls `frameAt(elapsed)` → updates `activeTouches` shared value → `<PinGrid>` renders the live touches *on top of* the static held imprint.
- Plays once. End of recording → `activeTouches` clears, static imprint remains visible.
- Haptic taps fire when a frame contains a touch identifier not present in the previous frame (mimics the "finger landed" feel).

**Layout**
- Same pin grid filling the screen.
- Top: "💗 [partner-name] sent you this" + close button.
- Bottom: large "Feel it again" pill button (replaces sender's "Send Touch" button).
- No edit / touch capability on this screen — read-only.

**Edge cases**
- `touch_payload` missing (legacy row) → render fallback: "[partner] sent a touch" text, no pin grid.
- `frames` empty but `final_imprint` exists (user touched and held without movement) → static imprint only, "Feel it" button disabled with a "no replay available" subtitle.

## File Inventory

**New**
- `components/PinGrid/PinGrid.tsx`
- `components/PinGrid/types.ts` (Touch, TouchFrame, TouchRecording type defs)
- `lib/touchRecording.ts`
- `app/touch-view/[momentId].tsx`

**Modified**
- `app/touch-partner.tsx` — refactored to consume `<PinGrid>`, own state machine + recorder, two-finger clear, send writes payload.
- `lib/widget.ts` (if applicable) — no logic change expected; verify.

**Schema**
- Migration: `alter table moments add column touch_payload jsonb`.

**Untouched**
- `lib/supabase.ts` (no client changes needed).
- Existing notification / timeline flows.
- `notes/multi_touch_backup.tsx` (kept as reference).

## Out of Scope

- Notification / push delivery when sender sends — assume existing flow handles it.
- Timeline / moments-list screen — assume it exists or is tackled separately.
- Receiver-side reactions (sending a touch back) — separate feature.
- Image export of the handprint (e.g., for sharing outside the app) — separate feature.

## Success Criteria

- Touching the screen with one finger depresses only the pins under the contact patch (~1.5 pin-widths radius), not a 55px halo.
- Lifting a finger leaves the imprint visible. Imprint accumulates across multiple touches and gestures within a session.
- Two-finger 1s long-press clears the imprint with a sweep animation.
- Send produces a `moments` row with a populated `touch_payload`. Existing fields still write correctly.
- Receiver opens the moment and immediately sees the static handprint.
- "Feel it" button replays the recorded gestures with sync'd haptic taps on each new finger landing.
- The visual reads as "metal pins in a board" — silver caps, charcoal background, drop shadows on resting pins, sunken-cap appearance on pressed pins. No neon glow.
