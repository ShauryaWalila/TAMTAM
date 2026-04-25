// components/Draw/DrawReplay.tsx
// Replay-view of a recorded drawing. Reads the playback object stored on a
// post's `reactions` JSON and animates strokes back as they were drawn —
// each stroke grows from its first point to its last across the original
// time window, so the receiver watches the drawing being made instead of
// seeing each stroke pop in as a complete shape.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { Play, RotateCcw } from 'lucide-react-native';
import { Canvas, Path, Skia, Group, Rect } from '@shopify/react-native-skia';

export type RecordedStroke = {
  id: string;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
  points: [number, number][];
  t_start: number;
  t_end: number;
};

export type DrawPlayback = {
  v: 1;
  duration_ms: number;
  screen: { w: number; h: number };
  strokes: RecordedStroke[];
};

type Props = {
  playback: DrawPlayback;
  boardBg: string;
  surfaceWidth: number;   // square; height = surfaceWidth
  themeTint: string;
};

export default function DrawReplay({ playback, boardBg, surfaceWidth, themeTint }: Props) {
  // Square surface — matches the existing image-viewer layout. Fit the
  // sender's drawing inside with a uniform scale + center offset so the
  // aspect ratio is preserved without overflowing.
  const surfaceSize = surfaceWidth;
  const fit = Math.min(surfaceSize / playback.screen.w, surfaceSize / playback.screen.h);
  const offsetX = (surfaceSize - playback.screen.w * fit) / 2;
  const offsetY = (surfaceSize - playback.screen.h * fit) / 2;

  // Pre-build complete Skia paths so finished strokes render without
  // being reconstructed every frame.
  const fullPaths = useMemo(() => {
    return playback.strokes.map((s) => buildPath(s.points, fit, offsetX, offsetY, s.points.length));
  }, [playback, fit, offsetX, offsetY]);

  const [elapsed, setElapsed] = useState<number>(playback.duration_ms); // default = end state
  const [isPlaying, setIsPlaying] = useState(false);
  const playStartRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = () => {
      const e = Date.now() - playStartRef.current;
      if (e >= playback.duration_ms) {
        setElapsed(playback.duration_ms);
        setIsPlaying(false);
        return;
      }
      setElapsed(e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playback]);

  const startReplay = () => {
    playStartRef.current = Date.now();
    setElapsed(0);
    setIsPlaying(true);
  };

  // Determine which strokes are visible right now and at what completion.
  // Finished strokes use their pre-built path; the at-most-one in-progress
  // stroke gets a fresh partial path each frame.
  const rendered = useMemo(() => {
    const out: { id: string; color: string; strokeWidth: number; isEraser: boolean; path: ReturnType<typeof Skia.Path.Make> }[] = [];
    for (let i = 0; i < playback.strokes.length; i++) {
      const s = playback.strokes[i];
      if (elapsed < s.t_start) continue;
      let p;
      if (elapsed >= s.t_end) {
        p = fullPaths[i];
      } else {
        const dur = Math.max(1, s.t_end - s.t_start);
        const frac = (elapsed - s.t_start) / dur;
        const n = Math.max(1, Math.floor(frac * s.points.length));
        p = buildPath(s.points, fit, offsetX, offsetY, n);
      }
      out.push({
        id: s.id,
        color: s.color,
        strokeWidth: Math.max(0.5, s.strokeWidth * fit),
        isEraser: s.isEraser,
        path: p,
      });
    }
    return out;
  }, [elapsed, playback, fullPaths, fit, offsetX, offsetY]);

  return (
    <View>
      <Canvas style={{ width: surfaceSize, height: surfaceSize, backgroundColor: boardBg }}>
        <Rect x={0} y={0} width={surfaceSize} height={surfaceSize} color={boardBg} />
        <Group layer>
          {rendered.map((r) => (
            <Path
              key={r.id}
              path={r.path}
              color={r.color}
              style="stroke"
              strokeWidth={r.strokeWidth}
              strokeCap="round"
              strokeJoin="round"
              blendMode={r.isEraser ? 'clear' : 'srcOver'}
            />
          ))}
        </Group>
      </Canvas>

      <View style={styles.controls}>
        <TouchableOpacity onPress={startReplay} disabled={isPlaying} style={[styles.btn, { backgroundColor: themeTint, opacity: isPlaying ? 0.7 : 1 }]}>
          {isPlaying ? <Play size={20} color="white" fill="white" /> : <RotateCcw size={20} color="white" />}
          <Text style={styles.btnLabel}>{isPlaying ? 'Playing…' : 'Replay'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function buildPath(
  points: [number, number][],
  fit: number,
  offsetX: number,
  offsetY: number,
  numPoints: number
) {
  const p = Skia.Path.Make();
  if (points.length === 0 || numPoints <= 0) return p;
  const limit = Math.min(numPoints, points.length);
  p.moveTo(points[0][0] * fit + offsetX, points[0][1] * fit + offsetY);
  for (let i = 1; i < limit; i++) {
    p.lineTo(points[i][0] * fit + offsetX, points[i][1] * fit + offsetY);
  }
  if (limit === 1) {
    // Make a tap render as a tiny dot so it doesn't disappear.
    p.lineTo(points[0][0] * fit + offsetX + 0.1, points[0][1] * fit + offsetY + 0.1);
  }
  return p;
}

const styles = StyleSheet.create({
  controls: { padding: 14, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, height: 44, borderRadius: 22 },
  btnLabel: { color: '#FFF', fontSize: 14, fontWeight: '900' },
});
