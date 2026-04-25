# Touch Partner Pin-Art Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current soft-glow touch screen with a pin-art aesthetic where pins depress only under the actual contact patch and stay depressed (handprint holds), then record the gesture and let the partner replay it.

**Architecture:** Extract the Skia rendering into a reusable `<PinGrid>` driven by Reanimated shared values. Sender screen owns touch capture + held-imprint state machine + recorder. Receiver screen loads a recorded `touch_payload` from supabase, renders the static handprint immediately, and steps through frames on Replay using the same `<PinGrid>`.

**Tech Stack:** React Native (Expo), `@shopify/react-native-skia` 2.2.12, `react-native-reanimated` 4.1.1, `expo-router`, `expo-haptics`, `@supabase/supabase-js`.

**Reference spec:** `docs/superpowers/specs/2026-04-25-touch-partner-pinart-design.md`

**Verification approach:** This project has no test framework. Each task ends with manual on-device verification via `npx expo start`. Commit only when the named acceptance criteria pass on a real device or simulator.

---

## File Structure

**New files:**
- `components/PinGrid/types.ts` — Touch, TouchFrame, TouchRecording type defs
- `components/PinGrid/constants.ts` — grid layout constants (SPACING, MAX_DIST, colors)
- `components/PinGrid/geometry.ts` — pure functions: hex grid generation, smoothstep, distance falloff
- `components/PinGrid/PinGrid.tsx` — Skia renderer, takes shared values
- `lib/touchRecording.ts` — createRecorder + createPlayer (pure TS)
- `app/touch-view/[momentId].tsx` — receiver/replay screen

**Modified files:**
- `app/touch-partner.tsx` — refactored to consume `<PinGrid>` + own state machine + recorder + send-writes-payload + two-finger-clear

**Database:**
- Supabase: `alter table moments add column touch_payload jsonb`

---

## Task 1: Database migration — add `touch_payload` column

**Files:**
- Run migration via Supabase SQL editor (no project file change). Document it.

- [ ] **Step 1: Run the SQL migration in Supabase**

Open the Supabase project SQL editor (project ref `jzxfdaalvmsjzkrrajvp`, see `lib/supabase.ts:5`) and run:

```sql
alter table moments add column if not exists touch_payload jsonb;
```

- [ ] **Step 2: Verify the column exists**

In the SQL editor, run:

```sql
select column_name, data_type from information_schema.columns
where table_name = 'moments' and column_name = 'touch_payload';
```

Expected: one row, `touch_payload | jsonb`.

- [ ] **Step 3: Commit a note documenting the migration**

Create `docs/superpowers/migrations/2026-04-25-add-touch-payload.md`:

```markdown
# 2026-04-25 — Add `touch_payload` to `moments`

Adds optional `jsonb` column to store handprint recording for touch-partner replay.

```sql
alter table moments add column if not exists touch_payload jsonb;
```

Backwards compatible: nullable, existing rows unaffected.
```

```bash
git add docs/superpowers/migrations/
git commit -m "docs: record touch_payload migration"
```

---

## Task 2: Types module

**Files:**
- Create: `components/PinGrid/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// components/PinGrid/types.ts
export type Touch = {
  id: number;
  x: number;
  y: number;
  r: number; // contact radius in px; 14 default when device doesn't expose it
};

export type TouchFrame = {
  t: number;          // ms since recording start
  points: Touch[];
};

export type TouchRecording = {
  v: 1;
  duration_ms: number;
  screen: { w: number; h: number };
  frames: TouchFrame[];
  final_imprint: string;   // base64-encoded Float32Array of held pressed amounts (length = pin count for sender's screen)
};
```

- [ ] **Step 2: Commit**

```bash
git add components/PinGrid/types.ts
git commit -m "feat(pingrid): add shared type definitions"
```

---

## Task 3: Grid constants module

**Files:**
- Create: `components/PinGrid/constants.ts`

- [ ] **Step 1: Create the constants file**

```typescript
// components/PinGrid/constants.ts
export const SPACING = 14;            // px between pins (hex grid step)
export const MAX_DIST = 22;           // px — beyond this no pin movement
export const MAX_DIST_SQ = MAX_DIST * MAX_DIST;
export const PIN_CAP_RADIUS = 5;      // resting cap radius
export const MAX_DEPRESSION_PX = 30;  // how far a fully-pressed pin sinks
export const PARALLAX_FACTOR = 0.12;  // perspective shift toward edges
export const PRESS_THRESHOLD = 0.05;  // below this, pin is considered untouched
export const DEFAULT_TOUCH_RADIUS = 14;

// Colors (pin-art look — no glow)
export const COLOR_BG_TOP = '#101012';
export const COLOR_BG_BOTTOM = '#050506';
export const COLOR_STEM = '#1a1a1a';
export const COLOR_CAP_RESTING = '#9aa0a6';
export const COLOR_CAP_PRESSED = '#3a3a3a';
export const COLOR_PIN_SHADOW = '#000000';
```

- [ ] **Step 2: Commit**

```bash
git add components/PinGrid/constants.ts
git commit -m "feat(pingrid): add layout and color constants"
```

---

## Task 4: Geometry helpers (pure functions)

**Files:**
- Create: `components/PinGrid/geometry.ts`

- [ ] **Step 1: Create the geometry helpers**

```typescript
// components/PinGrid/geometry.ts
import { SPACING, MAX_DIST } from './constants';

/**
 * Builds a hex-packed grid covering the given screen dims.
 * Odd rows are offset by SPACING/2 horizontally; rows are SPACING * sin(60deg) apart.
 */
export function buildHexGrid(screenW: number, screenH: number) {
  const rowStep = SPACING * Math.sin(Math.PI / 3); // ~12.12px for SPACING=14
  const cols = Math.ceil(screenW / SPACING) + 2;
  const rows = Math.ceil(screenH / rowStep) + 2;
  const pinCount = rows * cols;
  const X = new Float32Array(pinCount);
  const Y = new Float32Array(pinCount);
  const offsetX = (screenW - (cols - 1) * SPACING) / 2;
  const offsetY = (screenH - (rows - 1) * rowStep) / 2;
  for (let r = 0; r < rows; r++) {
    const rowOffset = (r % 2 === 0) ? 0 : SPACING / 2;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      X[i] = c * SPACING + rowOffset + offsetX;
      Y[i] = r * rowStep + offsetY;
    }
  }
  return { X, Y, pinCount, rows, cols };
}

/**
 * Smoothstep falloff: 1 at distance=0, 0 at distance>=MAX_DIST, with a Hermite curve in between.
 * Sharper boundary than pow(r, k) — full pressure under the contact patch, zero outside.
 */
export function pressureAt(distSq: number): number {
  'worklet';
  if (distSq >= MAX_DIST * MAX_DIST) return 0;
  const dist = Math.sqrt(distSq);
  const t = 1 - dist / MAX_DIST;     // 1 at center → 0 at edge
  return t * t * (3 - 2 * t);        // smoothstep(t)
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PinGrid/geometry.ts
git commit -m "feat(pingrid): add hex-grid builder and smoothstep falloff"
```

---

## Task 5: Recording library

**Files:**
- Create: `lib/touchRecording.ts`

- [ ] **Step 1: Create the recorder + player**

```typescript
// lib/touchRecording.ts
import { Touch, TouchFrame, TouchRecording } from '@/components/PinGrid/types';

// ---------- Recorder ----------

export type Recorder = {
  tick: (touches: Touch[], nowMs: number) => void;
  finalize: (
    finalImprint: Float32Array,
    screen: { w: number; h: number }
  ) => TouchRecording;
  reset: () => void;
};

const FRAME_INTERVAL_MS = 33;       // ~30fps
const MAX_DURATION_MS = 10_000;     // cap to bound payload size

export function createRecorder(): Recorder {
  let frames: TouchFrame[] = [];
  let startMs: number | null = null;
  let lastFrameMs = 0;

  const samePoints = (a: Touch[], b: Touch[]) => {
    if (a.length !== b.length) return false;
    const idsA = new Set(a.map((t) => t.id));
    for (const t of b) if (!idsA.has(t.id)) return false;
    for (const t of b) {
      const m = a.find((x) => x.id === t.id);
      if (!m) return false;
      if (Math.abs(m.x - t.x) >= 1) return false;
      if (Math.abs(m.y - t.y) >= 1) return false;
      if (Math.abs(m.r - t.r) >= 1) return false;
    }
    return true;
  };

  return {
    tick(touches, nowMs) {
      if (touches.length === 0 && startMs === null) return; // no recording yet
      if (startMs === null) startMs = nowMs;
      const t = nowMs - startMs;
      if (t > MAX_DURATION_MS) return;
      if (nowMs - lastFrameMs < FRAME_INTERVAL_MS) return;
      const prev = frames[frames.length - 1];
      if (prev && samePoints(prev.points, touches)) {
        lastFrameMs = nowMs;
        return;
      }
      frames.push({ t, points: touches.map((p) => ({ ...p })) });
      lastFrameMs = nowMs;
    },
    finalize(finalImprint, screen) {
      const duration_ms = startMs === null ? 0 : (frames[frames.length - 1]?.t ?? 0);
      return {
        v: 1,
        duration_ms,
        screen,
        frames,
        final_imprint: float32ToBase64(finalImprint),
      };
    },
    reset() {
      frames = [];
      startMs = null;
      lastFrameMs = 0;
    },
  };
}

// ---------- Player ----------

export type Player = {
  frameAt: (elapsedMs: number) => Touch[];
  totalDurationMs: number;
};

export function createPlayer(rec: TouchRecording): Player {
  const frames = rec.frames;
  return {
    totalDurationMs: rec.duration_ms,
    frameAt(elapsedMs) {
      if (frames.length === 0 || elapsedMs <= 0) return [];
      if (elapsedMs >= rec.duration_ms) return [];
      // binary search for the frame with t <= elapsed
      let lo = 0, hi = frames.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].t <= elapsedMs) lo = mid;
        else hi = mid - 1;
      }
      const a = frames[lo];
      const b = frames[lo + 1];
      if (!b) return a.points;
      // interpolate per-id between a and b
      const span = b.t - a.t;
      const u = span > 0 ? (elapsedMs - a.t) / span : 0;
      const out: Touch[] = [];
      for (const pa of a.points) {
        const pb = b.points.find((p) => p.id === pa.id);
        if (pb) {
          out.push({
            id: pa.id,
            x: pa.x + (pb.x - pa.x) * u,
            y: pa.y + (pb.y - pa.y) * u,
            r: pa.r + (pb.r - pa.r) * u,
          });
        } else {
          out.push(pa);
        }
      }
      return out;
    },
  };
}

// ---------- Float32Array <-> base64 ----------

export function float32ToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // global.btoa available in Hermes/RN
  return global.btoa(bin);
}

export function base64ToFloat32(b64: string): Float32Array {
  const bin = global.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Ensure aligned: copy bytes into a fresh ArrayBuffer
  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}
```

- [ ] **Step 2: Smoke-test in the app**

Add a one-off log in `app/touch-partner.tsx` `useEffect` (it'll be removed in later tasks):

```typescript
import { createRecorder, createPlayer, float32ToBase64, base64ToFloat32 } from '@/lib/touchRecording';

useEffect(() => {
  loadUsers();
  // smoke test
  const rec = createRecorder();
  rec.tick([{ id: 1, x: 10, y: 10, r: 14 }], 0);
  rec.tick([{ id: 1, x: 50, y: 50, r: 14 }], 100);
  const f = new Float32Array([0, 0.5, 1]);
  const out = rec.finalize(f, { w: 390, h: 844 });
  console.log('REC frames:', out.frames.length, 'duration:', out.duration_ms);
  const p = createPlayer(out);
  console.log('mid frame:', JSON.stringify(p.frameAt(50)));
  const round = base64ToFloat32(out.final_imprint);
  console.log('roundtrip:', Array.from(round));
}, []);
```

Run `npx expo start`, open the touch-partner screen, check Metro logs.

Expected output:
```
REC frames: 2 duration: 100
mid frame: [{"id":1,"x":30,"y":30,"r":14}]
roundtrip: [0, 0.5, 1]
```

- [ ] **Step 3: Remove the smoke test and commit**

Remove the smoke-test imports and `useEffect` block. Then:

```bash
git add lib/touchRecording.ts
git commit -m "feat(touch): add handprint recorder and player"
```

---

## Task 6: PinGrid component skeleton

**Files:**
- Create: `components/PinGrid/PinGrid.tsx`

- [ ] **Step 1: Create the skeleton**

```typescript
// components/PinGrid/PinGrid.tsx
import React, { useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { Canvas, Rect } from '@shopify/react-native-skia';
import { SharedValue } from 'react-native-reanimated';
import { Touch } from './types';
import { buildHexGrid } from './geometry';
import { COLOR_BG_TOP } from './constants';

type Props = {
  activeTouches: SharedValue<Touch[]>;
  heldImprint: SharedValue<Float32Array>;
  isClearing: SharedValue<number>;
};

export default function PinGrid({ activeTouches, heldImprint, isClearing }: Props) {
  const { width: W, height: H } = Dimensions.get('window');
  const grid = useMemo(() => buildHexGrid(W, H), [W, H]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H} color={COLOR_BG_TOP} />
    </Canvas>
  );
}
```

- [ ] **Step 2: Verify it compiles**

`npx expo start` → no red-screen errors importing from `@/components/PinGrid/PinGrid`. Touch-partner screen still works as before because it doesn't use this component yet.

- [ ] **Step 3: Commit**

```bash
git add components/PinGrid/PinGrid.tsx
git commit -m "feat(pingrid): add component skeleton"
```

---

## Task 7: PinGrid — render static pin grid (no touch interaction yet)

**Files:**
- Modify: `components/PinGrid/PinGrid.tsx`

- [ ] **Step 1: Compute pin positions and render circles + stems**

Replace the contents of `PinGrid.tsx` with:

```typescript
// components/PinGrid/PinGrid.tsx
import React, { useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import {
  Canvas, Group, LinearGradient, Points, Rect, Skia, vec,
} from '@shopify/react-native-skia';
import { SharedValue, useDerivedValue } from 'react-native-reanimated';
import { Touch } from './types';
import { buildHexGrid, pressureAt } from './geometry';
import {
  COLOR_BG_TOP, COLOR_BG_BOTTOM, COLOR_STEM,
  COLOR_CAP_RESTING, COLOR_CAP_PRESSED,
  PIN_CAP_RADIUS, MAX_DEPRESSION_PX, PARALLAX_FACTOR, PRESS_THRESHOLD,
} from './constants';

type Props = {
  activeTouches: SharedValue<Touch[]>;
  heldImprint: SharedValue<Float32Array>;
  isClearing: SharedValue<number>;
};

export default function PinGrid({ activeTouches, heldImprint, isClearing }: Props) {
  const { width: W, height: H } = Dimensions.get('window');
  const grid = useMemo(() => buildHexGrid(W, H), [W, H]);
  const cx_mid = W / 2;
  const cy_mid = H / 2;

  // Static stem and cap point arrays (recomputed each frame from heldImprint).
  const visuals = useDerivedValue(() => {
    const X = grid.X;
    const Y = grid.Y;
    const N = grid.pinCount;
    const held = heldImprint.value;
    const stems: ReturnType<typeof vec>[] = [];
    const caps: ReturnType<typeof vec>[] = [];
    for (let i = 0; i < N; i++) {
      const bx = X[i];
      const by = Y[i];
      const px = (bx - cx_mid) * PARALLAX_FACTOR;
      const py = (by - cy_mid) * PARALLAX_FACTOR;
      const pressed = held[i] ?? 0;
      const dep = pressed * MAX_DEPRESSION_PX;
      const topX = bx + px;
      const topY = by + py - (MAX_DEPRESSION_PX - dep);
      stems.push(vec(bx, by));
      stems.push(vec(topX, topY));
      caps.push(vec(topX, topY));
    }
    return { stems, caps };
  });

  const stemPoints = useDerivedValue(() => visuals.value.stems);
  const capPoints = useDerivedValue(() => visuals.value.caps);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, H)}
          colors={[COLOR_BG_TOP, COLOR_BG_BOTTOM]}
        />
      </Rect>
      <Points points={stemPoints} mode="lines" color={COLOR_STEM} strokeWidth={1} />
      {/* Resting caps: cast a small drop shadow */}
      <Group>
        <Points
          points={capPoints}
          mode="points"
          color={COLOR_CAP_RESTING}
          strokeWidth={PIN_CAP_RADIUS * 2}
          strokeCap="round"
        />
        <Shadow dx={1} dy={2} blur={2} color={COLOR_PIN_SHADOW} />
      </Group>
    </Canvas>
  );
}
```

Update the imports at the top of the file to include `Shadow`:

```typescript
import {
  Canvas, Group, LinearGradient, Points, Rect, Shadow, Skia, vec,
} from '@shopify/react-native-skia';
```

(In Task 7, every pin is rendered as resting since `heldImprint` is empty. Task 8 will split into resting + pressed layers.)

- [ ] **Step 2: Quick mount-test in `touch-partner.tsx`**

Temporarily render `<PinGrid>` in `touch-partner.tsx` BELOW the existing canvas to confirm it draws. Add at the top of `touch-partner.tsx`:

```typescript
import PinGrid from '@/components/PinGrid/PinGrid';
import { useSharedValue } from 'react-native-reanimated';
```

Inside `TouchPartnerScreen` add:

```typescript
const _testHeld = useSharedValue<Float32Array>(new Float32Array(2000));
const _testActive = useSharedValue<Touch[]>([]);
const _testClear = useSharedValue(0);
```

Render at the bottom of the JSX (before `</View>`):

```tsx
<View style={StyleSheet.absoluteFill} pointerEvents="none">
  <PinGrid activeTouches={_testActive} heldImprint={_testHeld} isClearing={_testClear} />
</View>
```

Run on device. Expected: a charcoal background with a hex-packed grid of silver pin caps. No interaction yet. Pins near edges should be parallax-shifted slightly outward.

- [ ] **Step 3: Remove the test mount and commit**

Strip the `_testHeld` / `_testActive` / `_testClear` shared values and the test `<View>` from `touch-partner.tsx`. Keep the `import PinGrid` only if you'll use it next task — otherwise remove it too.

```bash
git add components/PinGrid/PinGrid.tsx
git commit -m "feat(pingrid): render static hex pin grid with parallax"
```

---

## Task 8: PinGrid — touch-driven live pressures + held imprint merge

**Files:**
- Modify: `components/PinGrid/PinGrid.tsx`

- [ ] **Step 1: Add the per-frame UI-thread merge**

Add `useFrameCallback` import and the merge logic. Replace the imports and component body of `PinGrid.tsx` with:

```typescript
// components/PinGrid/PinGrid.tsx
import React, { useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import {
  Canvas, Group, LinearGradient, Points, Rect, Shadow, vec,
} from '@shopify/react-native-skia';
import { SharedValue, useDerivedValue, useFrameCallback } from 'react-native-reanimated';
import { Touch } from './types';
import { buildHexGrid, pressureAt } from './geometry';
import {
  COLOR_BG_TOP, COLOR_BG_BOTTOM, COLOR_STEM,
  COLOR_CAP_RESTING, COLOR_CAP_PRESSED, COLOR_PIN_SHADOW,
  PIN_CAP_RADIUS, MAX_DEPRESSION_PX, PARALLAX_FACTOR, PRESS_THRESHOLD, MAX_DIST_SQ,
} from './constants';

type Props = {
  activeTouches: SharedValue<Touch[]>;
  heldImprint: SharedValue<Float32Array>;
  isClearing: SharedValue<number>;
};

export default function PinGrid({ activeTouches, heldImprint, isClearing }: Props) {
  const { width: W, height: H } = Dimensions.get('window');
  const grid = useMemo(() => buildHexGrid(W, H), [W, H]);
  const cx_mid = W / 2;
  const cy_mid = H / 2;

  // Per-frame: merge live pressures into the monotonic heldImprint on UI thread.
  useFrameCallback(() => {
    'worklet';
    const X = grid.X;
    const Y = grid.Y;
    const N = grid.pinCount;
    const held = heldImprint.value;
    const touches = activeTouches.value;
    const numT = touches.length;
    const clearing = isClearing.value;

    // While clearing animates from 0→1 we suppress merging and the visuals layer fades held → 0.
    if (clearing > 0.01) return;
    if (numT === 0) return;

    for (let i = 0; i < N; i++) {
      const bx = X[i];
      const by = Y[i];
      let live = 0;
      for (let j = 0; j < numT; j++) {
        const t = touches[j];
        const dx = bx - t.x;
        const dy = by - t.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < MAX_DIST_SQ) {
          const p = pressureAt(d2);
          if (p > live) live = p;
        }
      }
      if (live > held[i]) held[i] = live;
    }
    // Trigger re-render of the derived value
    heldImprint.value = held;
  });

  // Split caps into two arrays so resting layer can have a drop shadow and pressed layer doesn't.
  const visuals = useDerivedValue(() => {
    const X = grid.X;
    const Y = grid.Y;
    const N = grid.pinCount;
    const held = heldImprint.value;
    const clearing = isClearing.value; // 0 normal, 1 fully cleared
    const stems: ReturnType<typeof vec>[] = [];
    const restingCaps: ReturnType<typeof vec>[] = [];
    const pressedCaps: ReturnType<typeof vec>[] = [];
    for (let i = 0; i < N; i++) {
      const bx = X[i];
      const by = Y[i];
      const px = (bx - cx_mid) * PARALLAX_FACTOR;
      const py = (by - cy_mid) * PARALLAX_FACTOR;
      const rawPressed = held[i] ?? 0;
      const pressed = rawPressed * (1 - clearing);
      const dep = pressed * MAX_DEPRESSION_PX;
      const topX = bx + px;
      const topY = by + py - (MAX_DEPRESSION_PX - dep);
      stems.push(vec(bx, by));
      stems.push(vec(topX, topY));
      if (pressed > PRESS_THRESHOLD) {
        pressedCaps.push(vec(topX, topY));
      } else {
        restingCaps.push(vec(topX, topY));
      }
    }
    return { stems, restingCaps, pressedCaps };
  });

  const stemPoints = useDerivedValue(() => visuals.value.stems);
  const restingCapPoints = useDerivedValue(() => visuals.value.restingCaps);
  const pressedCapPoints = useDerivedValue(() => visuals.value.pressedCaps);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, H)}
          colors={[COLOR_BG_TOP, COLOR_BG_BOTTOM]}
        />
      </Rect>
      <Points points={stemPoints} mode="lines" color={COLOR_STEM} strokeWidth={1} />
      {/* Pressed pins: sunken, no shadow (flush with board) */}
      <Points
        points={pressedCapPoints}
        mode="points"
        color={COLOR_CAP_PRESSED}
        strokeWidth={PIN_CAP_RADIUS * 2}
        strokeCap="round"
      />
      {/* Resting pins: silver caps with drop shadow */}
      <Group>
        <Points
          points={restingCapPoints}
          mode="points"
          color={COLOR_CAP_RESTING}
          strokeWidth={PIN_CAP_RADIUS * 2}
          strokeCap="round"
        />
        <Shadow dx={1} dy={2} blur={2} color={COLOR_PIN_SHADOW} />
      </Group>
    </Canvas>
  );
}
```

- [ ] **Step 2: Commit**

This change is internal to `PinGrid` and isn't yet visible (no caller drives `activeTouches`). Verify that the touch-partner screen still works with the OLD canvas (we haven't refactored sender yet).

```bash
git add components/PinGrid/PinGrid.tsx
git commit -m "feat(pingrid): merge live pressures into monotonic held imprint"
```

---

## Task 9: Refactor `touch-partner.tsx` to use `<PinGrid>` + new state model

**Files:**
- Modify: `app/touch-partner.tsx`

- [ ] **Step 1: Replace the file**

Replace `app/touch-partner.tsx` with:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Sparkles, X } from 'lucide-react-native';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import {
  DEFAULT_TOUCH_RADIUS,
} from '@/components/PinGrid/constants';
import { createRecorder, float32ToBase64 } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TouchPartnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Allocate held imprint sized to this device's pin count.
  const pinCount = React.useMemo(
    () => buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT).pinCount,
    []
  );
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  // Recorder lives on JS thread.
  const recorderRef = useRef(createRecorder());

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    if (user) {
      setUserName(user.toLowerCase());
      setPartnerName(user.toLowerCase() === 'love' ? 'supriya' : 'love');
    }
  };

  const extractTouches = (event: any): Touch[] => {
    const native = event.nativeEvent.touches;
    const out: Touch[] = [];
    for (let i = 0; i < native.length; i++) {
      const t = native[i];
      const force = typeof t.force === 'number' ? t.force : 0;
      const radius =
        typeof t.radiusX === 'number' && t.radiusX > 0
          ? Math.max(t.radiusX, t.radiusY ?? t.radiusX)
          : typeof t.touchMajor === 'number' && t.touchMajor > 0
          ? t.touchMajor / 2
          : DEFAULT_TOUCH_RADIUS + force * 6; // iOS force boost
      out.push({
        id: t.identifier,
        x: t.locationX,
        y: t.locationY,
        r: radius,
      });
    }
    return out;
  };

  const previousCountRef = useRef(0);

  const handleTouchUpdate = (event: any) => {
    const touches = extractTouches(event);
    if (touches.length > previousCountRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    previousCountRef.current = touches.length;
    activeTouches.value = touches;
    recorderRef.current.tick(touches, Date.now());
  };

  const handleTouchEnd = (event: any) => {
    const touches = extractTouches(event);
    previousCountRef.current = touches.length;
    activeTouches.value = touches;
    recorderRef.current.tick(touches, Date.now());
  };

  const sendTouch = async () => {
    if (isSending) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const recording = recorderRef.current.finalize(
        heldImprint.value,
        { w: SCREEN_WIDTH, h: SCREEN_HEIGHT }
      );
      updateTouchWidget('Touch sent!');
      await supabase.from('moments').insert([{
        user_id: userName,
        message: 'sent a touch',
        created_at: new Date().toISOString(),
        touch_payload: recording,
      }]);
      // Clear locally
      heldImprint.value = new Float32Array(pinCount);
      activeTouches.value = [];
      recorderRef.current.reset();
      setTimeout(() => setIsSending(false), 1000);
    } catch (error) {
      console.warn('sendTouch failed', error);
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />

      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={handleTouchUpdate}
        onTouchMove={handleTouchUpdate}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { activeTouches.value = []; previousCountRef.current = 0; }}
      >
        <PinGrid
          activeTouches={activeTouches}
          heldImprint={heldImprint}
          isClearing={isClearing}
        />
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Touch Partner</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={sendTouch}
          disabled={isSending}
          style={[styles.sendButton, { backgroundColor: theme.tint }]}
        >
          <MotiView animate={{ scale: isSending ? 0.95 : 1 }}>
            <View style={styles.sendButtonContent}>
              {isSending ? <Sparkles size={24} color="white" /> : <Heart size={24} color="white" fill="white" />}
              <Text style={styles.sendButtonText}>Send Touch</Text>
            </View>
          </MotiView>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 2 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '900' },
});
```

- [ ] **Step 2: Verify on device**

Run `npx expo start`, open the touch-partner screen.

Expected:
- Charcoal background, hex grid of silver pins
- Touch with one finger → only pins under contact patch (~22px radius) depress; no soft halo bleed
- Lift finger → depressed pins **stay down**
- Slide finger → trail of depressed pins
- Tap "Send Touch" → grid clears, row written to supabase

Verify in Supabase dashboard the row has a populated `touch_payload`.

- [ ] **Step 3: Commit**

```bash
git add app/touch-partner.tsx
git commit -m "feat(touch-partner): swap to PinGrid + held imprint + payload send"
```

---

## Task 10: Two-finger long-press clear

**Files:**
- Modify: `app/touch-partner.tsx`

- [ ] **Step 1: Add the long-press detection and clear animation**

Add at the top of `app/touch-partner.tsx` imports:

```typescript
import Animated, { runOnJS } from 'react-native-reanimated';
```

Inside `TouchPartnerScreen` (right after `previousCountRef`), add:

```typescript
const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const startClearTimer = () => {
  if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  clearTimerRef.current = setTimeout(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    isClearing.value = withTiming(1, { duration: 600 }, (finished) => {
      'worklet';
      if (!finished) return;
      heldImprint.value = new Float32Array(pinCount);
      isClearing.value = 0;
      runOnJS(resetRecorderJS)();
    });
  }, 1000);
};

const cancelClearTimer = () => {
  if (clearTimerRef.current) {
    clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
  }
};

const resetRecorderJS = () => {
  recorderRef.current.reset();
};
```

Update `handleTouchUpdate` to start/cancel the timer based on finger count:

```typescript
const handleTouchUpdate = (event: any) => {
  const touches = extractTouches(event);
  if (touches.length > previousCountRef.current) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  if (touches.length === 2 && previousCountRef.current !== 2) {
    startClearTimer();
  } else if (touches.length !== 2) {
    cancelClearTimer();
  }
  previousCountRef.current = touches.length;
  activeTouches.value = touches;
  recorderRef.current.tick(touches, Date.now());
};
```

Update `handleTouchEnd` and `onTouchCancel` to cancel the timer:

```typescript
const handleTouchEnd = (event: any) => {
  const touches = extractTouches(event);
  if (touches.length !== 2) cancelClearTimer();
  previousCountRef.current = touches.length;
  activeTouches.value = touches;
  recorderRef.current.tick(touches, Date.now());
};
```

And the `onTouchCancel` prop:

```tsx
onTouchCancel={() => {
  activeTouches.value = [];
  previousCountRef.current = 0;
  cancelClearTimer();
}}
```

- [ ] **Step 2: Verify on device**

- Touch with one finger → no clear
- Touch and hold with two fingers for ~1 second without lifting → warning haptic, pins rise back smoothly over ~600ms, recording resets
- Lift before 1 second → no clear

- [ ] **Step 3: Commit**

```bash
git add app/touch-partner.tsx
git commit -m "feat(touch-partner): two-finger long-press to clear imprint"
```

---

## Task 11: Receiver screen — load + render static handprint

**Files:**
- Create: `app/touch-view/[momentId].tsx`

- [ ] **Step 1: Create the receiver screen**

```typescript
// app/touch-view/[momentId].tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, X } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch, TouchRecording } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import { base64ToFloat32 } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TouchViewScreen() {
  const { momentId } = useLocalSearchParams<{ momentId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState<TouchRecording | null>(null);
  const [senderName, setSenderName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const pinCount = React.useMemo(
    () => buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT).pinCount,
    []
  );
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: dbErr } = await supabase
          .from('moments')
          .select('user_id, touch_payload')
          .eq('id', momentId)
          .single();
        if (cancelled) return;
        if (dbErr) {
          setError(dbErr.message);
          return;
        }
        setSenderName(data?.user_id ?? '');
        const payload = data?.touch_payload as TouchRecording | null;
        if (!payload || payload.v !== 1) {
          setRecording(null);
          return;
        }
        setRecording(payload);
        // Decode held imprint immediately and apply (with sender→receiver scaling NOT needed for imprint
        // because it's per-pin and we use receiver's own pin count if mismatched).
        const decoded = base64ToFloat32(payload.final_imprint);
        if (decoded.length === pinCount) {
          heldImprint.value = decoded;
        } else {
          // Fallback: replay the final frame's points into pinCount-sized imprint via interpolation in next task.
          heldImprint.value = new Float32Array(pinCount); // leave blank; replay will fill
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [momentId, pinCount]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator color="#FFF" />
      </View>
    );
  }

  if (error || !recording) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Text style={styles.fallbackText}>
          {error ?? `${senderName || 'someone'} sent a touch`}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.closeBtn, { marginTop: 24 }]}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />

      <PinGrid activeTouches={activeTouches} heldImprint={heldImprint} isClearing={isClearing} />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{senderName ? `${senderName} sent you this` : 'A touch'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        {/* Replay button placeholder — wired in next task */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => { /* TODO Task 12 */ }}
          style={[styles.replayButton, { backgroundColor: '#E91E63' }]}
        >
          <View style={styles.replayContent}>
            <Heart size={24} color="white" fill="white" />
            <Text style={styles.replayText}>Feel it</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  replayButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  replayContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  replayText: { color: 'white', fontSize: 16, fontWeight: '900' },
  fallbackText: { color: '#FFF', fontSize: 18 },
});
```

- [ ] **Step 2: Verify**

You need a moment row with a `touch_payload`. Use the sender (Task 9) to create one: open touch-partner, touch the screen, hit Send. Then look up the row id in Supabase and navigate to `/touch-view/<id>` (e.g., add a temporary button somewhere or use the dev-tools deep link).

Quick deep-link test in Expo: in the URL bar of the dev tools, enter:

```
exp://<lan-ip>:8081/--/touch-view/<momentId>
```

Expected:
- The static handprint imprint shows immediately (silver background with sunken pressed pins).
- Header shows the sender's name.
- "Feel it" button is visible but does nothing yet.

If the moment row's `pin_count` doesn't match the receiver's screen, the imprint won't decode. That's expected — Task 12's playback fills the imprint from frames in that case.

- [ ] **Step 3: Commit**

```bash
git add app/touch-view/[momentId].tsx
git commit -m "feat(touch-view): add receiver screen with static handprint render"
```

---

## Task 12: Receiver screen — "Feel it" replay with sync'd haptics

**Files:**
- Modify: `app/touch-view/[momentId].tsx`

- [ ] **Step 1: Add player + frame loop + haptic sync**

Add these imports at the top:

```typescript
import * as Haptics from 'expo-haptics';
import { createPlayer, Player } from '@/lib/touchRecording';
```

Inside the component, after the `useSharedValue`s, add player state + a JS-thread RAF driver (no `useFrameCallback` needed — replay is ~30fps and a JS-thread RAF gives easier access to React state and refs):

```typescript
const [isPlaying, setIsPlaying] = useState(false);
const playerRef = React.useRef<Player | null>(null);
const playStartRef = React.useRef<number>(0);
const lastFrameIdsRef = React.useRef<Set<number>>(new Set());

const scaleX = recording ? SCREEN_WIDTH / recording.screen.w : 1;
const scaleY = recording ? SCREEN_HEIGHT / recording.screen.h : 1;

React.useEffect(() => {
  if (!isPlaying || !playerRef.current) return;
  let raf: number;
  const tick = () => {
    const elapsed = Date.now() - playStartRef.current;
    const player = playerRef.current!;
    if (elapsed >= player.totalDurationMs) {
      activeTouches.value = [];
      lastFrameIdsRef.current = new Set();
      setIsPlaying(false);
      return;
    }
    const points = player.frameAt(elapsed);
    const scaled: Touch[] = points.map((p) => ({
      id: p.id,
      x: p.x * scaleX,
      y: p.y * scaleY,
      r: p.r,
    }));
    const ids = new Set(scaled.map((p) => p.id));
    let newFinger = false;
    for (const id of ids) if (!lastFrameIdsRef.current.has(id)) { newFinger = true; break; }
    if (newFinger) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    lastFrameIdsRef.current = ids;
    activeTouches.value = scaled;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [isPlaying, scaleX, scaleY]);

const startReplay = () => {
  if (!recording) return;
  if (!playerRef.current) playerRef.current = createPlayer(recording);
  lastFrameIdsRef.current = new Set();
  playStartRef.current = Date.now();
  setIsPlaying(true);
};
```

Wire the button:

```tsx
<TouchableOpacity
  activeOpacity={0.8}
  onPress={startReplay}
  disabled={isPlaying || (recording.frames?.length ?? 0) === 0}
  style={[
    styles.replayButton,
    { backgroundColor: (recording.frames?.length ?? 0) === 0 ? '#444' : '#E91E63' },
  ]}
>
  <View style={styles.replayContent}>
    <Heart size={24} color="white" fill="white" />
    <Text style={styles.replayText}>
      {isPlaying ? 'Feeling…' : (recording.frames?.length ?? 0) === 0 ? 'No replay' : 'Feel it'}
    </Text>
  </View>
</TouchableOpacity>
```

- [ ] **Step 2: Verify**

Send a touch with multi-finger movement (e.g., place all five fingers, slide them across). Open the corresponding `/touch-view/<id>`.

Expected:
- Static imprint shows on load.
- Tap "Feel it" → live touches animate over the static imprint at the original speed; haptic taps fire on each new finger landing; button disables during play; ends → live touches clear, imprint remains.
- For a moment with empty `frames`, button shows "No replay" and is disabled.

- [ ] **Step 3: Commit**

```bash
git add app/touch-view/[momentId].tsx
git commit -m "feat(touch-view): replay recorded gestures with sync'd haptics"
```

---

## Task 13: Receiver screen — fill imprint from final frame when sender pin count differs

**Files:**
- Modify: `app/touch-view/[momentId].tsx`

The Task 11 load logic only applies the decoded imprint when `decoded.length === pinCount` (sender and receiver have matching pin counts). When they differ, the imprint stays blank. Fix: render the imprint from the recording's final frame using the receiver's own pin grid.

**Files:**
- Modify: `components/PinGrid/geometry.ts` — add a helper that computes an imprint from a list of touches.
- Modify: `app/touch-view/[momentId].tsx` — fall back to that helper.

- [ ] **Step 1: Add `imprintFromTouches` helper**

Append to `components/PinGrid/geometry.ts`:

```typescript
import { MAX_DIST_SQ } from './constants';

/**
 * Computes an imprint Float32Array from a list of touches against a hex grid.
 * Same math as the per-frame UI-thread merge, intended for one-shot use on JS thread.
 */
export function imprintFromTouches(
  X: Float32Array,
  Y: Float32Array,
  pinCount: number,
  touches: { x: number; y: number; r: number }[]
): Float32Array {
  const out = new Float32Array(pinCount);
  for (let i = 0; i < pinCount; i++) {
    const bx = X[i];
    const by = Y[i];
    let live = 0;
    for (let j = 0; j < touches.length; j++) {
      const t = touches[j];
      const dx = bx - t.x;
      const dy = by - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < MAX_DIST_SQ) {
        const dist = Math.sqrt(d2);
        const u = 1 - dist / Math.sqrt(MAX_DIST_SQ);
        const p = u * u * (3 - 2 * u);
        if (p > live) live = p;
      }
    }
    out[i] = live;
  }
  return out;
}
```

- [ ] **Step 2: Use it as a fallback in the receiver**

In `app/touch-view/[momentId].tsx`, replace the imprint-decoding block in the `useEffect` with:

```typescript
const decoded = base64ToFloat32(payload.final_imprint);
if (decoded.length === pinCount) {
  heldImprint.value = decoded;
} else {
  // Sender's pin count differs — synthesize from the final frame using receiver's grid.
  const lastFrame = payload.frames[payload.frames.length - 1];
  const grid = buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT);
  const sx = SCREEN_WIDTH / payload.screen.w;
  const sy = SCREEN_HEIGHT / payload.screen.h;
  const scaledTouches = (lastFrame?.points ?? []).map((p) => ({
    x: p.x * sx,
    y: p.y * sy,
    r: p.r,
  }));
  // Accumulate imprint from every frame (gives the trail), not just the last.
  const acc = new Float32Array(pinCount);
  for (const f of payload.frames) {
    const sc = f.points.map((p) => ({ x: p.x * sx, y: p.y * sy, r: p.r }));
    const im = imprintFromTouches(grid.X, grid.Y, pinCount, sc);
    for (let i = 0; i < pinCount; i++) if (im[i] > acc[i]) acc[i] = im[i];
  }
  heldImprint.value = acc;
}
```

Add the import at the top:

```typescript
import { buildHexGrid, imprintFromTouches } from '@/components/PinGrid/geometry';
```

- [ ] **Step 3: Verify on a smaller / larger device**

If you only have one device, set Expo's web version to a different size, or use an emulator with different dimensions. Open a moment sent from the other device. Expected: the static handprint still shows correctly (no blank screen), and "Feel it" still plays back with proper scaling.

- [ ] **Step 4: Commit**

```bash
git add components/PinGrid/geometry.ts app/touch-view/[momentId].tsx
git commit -m "feat(touch-view): synthesize imprint from frames when pin count differs"
```

---

## Task 14: "Fresh press" scale-in cue (visual polish)

**Files:**
- Modify: `components/PinGrid/PinGrid.tsx`

The spec calls for a 200ms scale-in animation when a pin first crosses the press threshold. Implement using a per-pin "first-pressed timestamp" Float32Array and a smoothstep-based scale factor.

- [ ] **Step 1: Add the press-timestamp tracking and apply scale**

In `PinGrid.tsx`, add inside the component:

```typescript
const pressStartTimes = useSharedValue<Float32Array>(new Float32Array(grid.pinCount));
const PRESS_ANIM_MS = 200;
```

In the `useFrameCallback` (where `held[i] = max(...)` is set), record the timestamp the first time a pin crosses the threshold:

```typescript
'worklet';
const now = global.performance?.now?.() ?? Date.now();
// inside the loop, after updating held[i]:
if (held[i] > PRESS_THRESHOLD && pressStartTimes.value[i] === 0) {
  pressStartTimes.value[i] = now;
}
```

(Make sure `pressStartTimes.value` is reset to a fresh Float32Array when the imprint is cleared — add `pressStartTimes.value = new Float32Array(pinCount)` to the clear callback in `app/touch-partner.tsx` Task 10.)

In the `useDerivedValue` block, modify the cap stroke width to apply scale:

```typescript
// Replace the simple capPoints push with capPoints + capRadii:
const radii: number[] = [];
const now = global.performance?.now?.() ?? Date.now();
// ...
for (let i = 0; i < N; i++) {
  // existing pressed/dep math
  const ts = pressStartTimes.value[i];
  let scale = 1;
  if (ts > 0) {
    const dt = now - ts;
    const u = Math.min(1, dt / PRESS_ANIM_MS);
    scale = 0.6 + 0.4 * (u * u * (3 - 2 * u)); // smoothstep 0.6 → 1.0
  }
  radii.push(PIN_CAP_RADIUS * 2 * scale);
  // ...existing pushes
}
return { stems, caps, colors, radii };
```

Skia's `Points` `mode="points"` uses a single `strokeWidth` for all points, so per-point radius needs `<Circle>`. Render circles only for pins currently inside the 200ms scale-in window — typically a handful at any time.

Add a sub-component in `PinGrid.tsx` (recomputes its own positions from the grid + parallax to avoid coupling to the split cap arrays):

```typescript
import { Circle } from '@shopify/react-native-skia';

function FreshPressOverlay({
  pressStartTimes, heldImprint, isClearing, gridX, gridY, pinCount,
  cxMid, cyMid,
}: {
  pressStartTimes: SharedValue<Float32Array>;
  heldImprint: SharedValue<Float32Array>;
  isClearing: SharedValue<number>;
  gridX: Float32Array;
  gridY: Float32Array;
  pinCount: number;
  cxMid: number;
  cyMid: number;
}) {
  const PRESS_ANIM_MS = 200;
  return (
    <Group>
      {Array.from({ length: pinCount }).map((_, i) => {
        const cx = useDerivedValue(() => {
          const bx = gridX[i];
          return bx + (bx - cxMid) * PARALLAX_FACTOR;
        });
        const cy = useDerivedValue(() => {
          const by = gridY[i];
          const pressed = (heldImprint.value[i] ?? 0) * (1 - isClearing.value);
          const dep = pressed * MAX_DEPRESSION_PX;
          return by + (by - cyMid) * PARALLAX_FACTOR - (MAX_DEPRESSION_PX - dep);
        });
        const r = useDerivedValue(() => {
          const ts = pressStartTimes.value[i];
          if (ts === 0) return 0;
          const now = global.performance?.now?.() ?? Date.now();
          const dt = now - ts;
          if (dt >= PRESS_ANIM_MS) return 0; // animation done; bulk layer takes over
          const u = dt / PRESS_ANIM_MS;
          const scale = 0.6 + 0.4 * (u * u * (3 - 2 * u));
          return PIN_CAP_RADIUS * scale;
        });
        return <Circle key={i} cx={cx} cy={cy} r={r} color={COLOR_CAP_PRESSED} />;
      })}
    </Group>
  );
}
```

Mount it inside the `<Canvas>` (after the pressed cap layer, before the resting+shadow group):

```tsx
<FreshPressOverlay
  pressStartTimes={pressStartTimes}
  heldImprint={heldImprint}
  isClearing={isClearing}
  gridX={grid.X}
  gridY={grid.Y}
  pinCount={grid.pinCount}
  cxMid={cx_mid}
  cyMid={cy_mid}
/>
```

NOTE: This renders one `<Circle>` per pin (~1000+), each with its own `useDerivedValue`s. Skia + Reanimated handle this via worklets but it adds significant overhead. If FPS drops below ~50 on your device, revert this task — the imprint without scale-in is still correct.

- [ ] **Step 2: Verify**

Run on device. Expected: when you tap a fresh spot, the pressed pins do a tiny pop-in (~200ms) before settling. If FPS drops below ~50 on your device, revert this task — the imprint without scale-in is still correct.

- [ ] **Step 3: Commit (or revert)**

```bash
git add components/PinGrid/PinGrid.tsx
git commit -m "feat(pingrid): fresh-press scale-in cue for newly-pressed pins"
```

If reverting:

```bash
git checkout HEAD -- components/PinGrid/PinGrid.tsx
```

---

## Task 15: Final verification + cleanup

**Files:** none modified — verification pass.

- [ ] **Step 1: Sender end-to-end**

On a real device:
- Open touch-partner, place all 5 fingers + palm. Check pins under each finger depress and the rest stay put.
- Lift fingers. Imprint stays.
- Slide a finger. Trail of depressions.
- Two-finger long-press (1s). Imprint clears.
- Place fingers again, send. Confirm a row appears in supabase with `touch_payload`.

- [ ] **Step 2: Receiver end-to-end**

- Look up the row id, navigate to `/touch-view/<id>`.
- Static handprint shows immediately.
- Tap "Feel it". Replay plays once, haptics fire on each new finger landing, imprint stays at the end.
- Tap "Feel it" again. Plays again.
- Close the screen. Reopen. Static imprint still loads.

- [ ] **Step 3: Edge cases**

- Send a touch with no movement (just hold for 1s). Receiver: static imprint shows; "No replay" disabled state on the button.
- Open `/touch-view/<some-old-momentId-without-touch_payload>`. Receiver: fallback "[user] sent a touch" text + close button.

- [ ] **Step 4: Final commit**

If you made any small fixes during verification:

```bash
git add -A
git commit -m "fix(touch-partner): polish from end-to-end verification"
```
