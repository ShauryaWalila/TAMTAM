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
