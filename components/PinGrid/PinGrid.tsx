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
