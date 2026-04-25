// components/Draw/HeatmapCanvas.tsx
// Reusable Skia heatmap renderer driven by a touches SharedValue.
// Used by HeatmapMode (live capture) and the post viewer (static replay).

import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { Canvas, Circle, Group, BlurMask, Rect } from '@shopify/react-native-skia';
import { useDerivedValue, SharedValue } from 'react-native-reanimated';

export type HeatTouch = { id?: number; x: number; y: number; r: number };

const MAX_HEAT_POINTS = 30;

type Props = {
  touches: SharedValue<HeatTouch[]>;
  // Multiplier applied per touch's r each frame. Comes from a SharedValue so
  // the radius slider can update the look in real time.
  visualScale: SharedValue<number>;
  // Soft blur applied to all blobs in the group.
  blur: SharedValue<number>;
  color: string;
};

export default function HeatmapCanvas({ touches, visualScale, blur, color }: Props) {
  const { width: W, height: H } = Dimensions.get('window');
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={W} height={H} color="#000" />
      <Group>
        <BlurMask blur={blur} style="normal" />
        {Array.from({ length: MAX_HEAT_POINTS }, (_, i) => (
          <HeatBlob key={i} index={i} touches={touches} visualScale={visualScale} color={color} />
        ))}
      </Group>
    </Canvas>
  );
}

function HeatBlob({
  index,
  touches,
  visualScale,
  color,
}: {
  index: number;
  touches: SharedValue<HeatTouch[]>;
  visualScale: SharedValue<number>;
  color: string;
}) {
  // Park unused slots far offscreen with r=0 so they're cheap to skip.
  const cx = useDerivedValue(() => touches.value[index]?.x ?? -10000);
  const cy = useDerivedValue(() => touches.value[index]?.y ?? -10000);
  const r = useDerivedValue(() =>
    touches.value[index] ? touches.value[index].r * visualScale.value : 0
  );
  return <Circle cx={cx} cy={cy} r={r} color={color} />;
}
