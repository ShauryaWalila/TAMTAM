// components/Draw/DrawReplay.tsx
// Replay-view of a recorded drawing. Reads the playback object stored on a
// post's `reactions` JSON and animates strokes back in chronological order.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { Heart, RotateCcw } from 'lucide-react-native';
import { Canvas, Path, Skia, Group, Rect } from '@shopify/react-native-skia';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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
  // Width of the rendering surface; height is computed from the sender's
  // aspect ratio so the replay looks the same as the sender drew it.
  surfaceWidth: number;
  themeTint: string;
};

export default function DrawReplay({ playback, boardBg, surfaceWidth, themeTint }: Props) {
  const aspect = playback.screen.h / Math.max(1, playback.screen.w);
  const surfaceHeight = surfaceWidth * aspect;
  const sx = surfaceWidth / playback.screen.w;
  const sy = surfaceHeight / playback.screen.h;

  // Pre-build full Skia paths (the static end state) so finished strokes don't
  // need to be reconstructed every frame.
  const fullPaths = useMemo(() => {
    return playback.strokes.map((s) => {
      const p = Skia.Path.Make();
      const pts = s.points;
      if (pts.length > 0) {
        p.moveTo(pts[0][0] * sx, pts[0][1] * sy);
        for (let i = 1; i < pts.length; i++) {
          p.lineTo(pts[i][0] * sx, pts[i][1] * sy);
        }
        if (pts.length === 1) {
          p.lineTo(pts[0][0] * sx + 0.1, pts[0][1] * sy + 0.1);
        }
      }
      return p;
    });
  }, [playback, sx, sy]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [shownStrokes, setShownStrokes] = useState<number[]>(
    () => playback.strokes.map((_, i) => i) // default: show everything
  );
  const playStartRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - playStartRef.current;
      // Include any stroke whose start time has passed.
      const visible: number[] = [];
      for (let i = 0; i < playback.strokes.length; i++) {
        if (playback.strokes[i].t_start <= elapsed) visible.push(i);
      }
      setShownStrokes(visible);
      if (elapsed >= playback.duration_ms) {
        setShownStrokes(playback.strokes.map((_, i) => i));
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playback]);

  const startReplay = () => {
    playStartRef.current = Date.now();
    setShownStrokes([]);
    setIsPlaying(true);
  };

  return (
    <View>
      <Canvas style={{ width: surfaceWidth, height: surfaceHeight, backgroundColor: boardBg }}>
        <Rect x={0} y={0} width={surfaceWidth} height={surfaceHeight} color={boardBg} />
        <Group layer>
          {shownStrokes.map((i) => {
            const s = playback.strokes[i];
            const p = fullPaths[i];
            if (!p) return null;
            return (
              <Path
                key={s.id}
                path={p}
                color={s.color}
                style="stroke"
                strokeWidth={s.strokeWidth * sx}
                strokeCap="round"
                strokeJoin="round"
                blendMode={s.isEraser ? 'clear' : 'srcOver'}
              />
            );
          })}
        </Group>
      </Canvas>

      <View style={styles.controls}>
        <TouchableOpacity onPress={startReplay} disabled={isPlaying} style={[styles.btn, { backgroundColor: themeTint }]}>
          {isPlaying ? <Heart size={20} color="white" fill="white" /> : <RotateCcw size={20} color="white" />}
          <Text style={styles.btnLabel}>{isPlaying ? 'Playing…' : 'Replay'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { padding: 14, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, height: 44, borderRadius: 22 },
  btnLabel: { color: '#FFF', fontSize: 14, fontWeight: '900' },
});
