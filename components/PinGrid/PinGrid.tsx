// components/PinGrid/PinGrid.tsx
import React, { useMemo } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import {
  Canvas, Group, LinearGradient, Points, Rect, Shadow, vec,
} from '@shopify/react-native-skia';
import { SharedValue, useDerivedValue } from 'react-native-reanimated';
import { Touch } from './types';
import { buildHexGrid } from './geometry';
import {
  COLOR_BG_TOP, COLOR_BG_BOTTOM, COLOR_STEM,
  COLOR_CAP_RESTING, COLOR_PIN_SHADOW,
  PIN_CAP_RADIUS, MAX_DEPRESSION_PX, PARALLAX_FACTOR,
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
