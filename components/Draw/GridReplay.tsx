// components/Draw/GridReplay.tsx
// Viewer for a recorded grid pattern. Loads a TouchRecording payload, shows
// the static handprint immediately (synthesizing it from frames so it
// renders correctly across device sizes), and animates the recorded touch
// trail back over time when the user taps Replay.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { Play, RotateCcw } from 'lucide-react-native';
import { useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch, TouchRecording } from '@/components/PinGrid/types';
import { buildHexGrid, imprintFromTouches } from '@/components/PinGrid/geometry';
import { createPlayer, Player } from '@/lib/touchRecording';

type Props = {
  payload: TouchRecording & { type?: 'pattern' };
  surfaceWidth: number;   // square; height = surfaceWidth
  themeTint: string;
};

export default function GridReplay({ payload, surfaceWidth, themeTint }: Props) {
  const surfaceSize = surfaceWidth;

  // Derive the radius the sender used (each recorded Touch has r baked in).
  const senderRadius = payload.frames?.[0]?.points?.[0]?.r ?? 22;
  const radiusSV = useSharedValue(senderRadius);

  const pinCount = useMemo(() => buildHexGrid(surfaceSize, surfaceSize).pinCount, [surfaceSize]);
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  // Sender→receiver coordinate scaling.
  const sx = surfaceSize / payload.screen.w;
  const sy = surfaceSize / payload.screen.h;

  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<Player | null>(null);
  const playStartRef = useRef<number>(0);
  const lastFrameIdsRef = useRef<Set<number>>(new Set());

  // Synthesize the static handprint from the recorded frame timeline so the
  // viewer reads correctly even when the sender's pin count differs from
  // ours. This runs once on mount.
  useEffect(() => {
    const grid = buildHexGrid(surfaceSize, surfaceSize);
    const acc = new Float32Array(pinCount);
    for (const f of payload.frames ?? []) {
      const sc = (f.points ?? []).map((p) => ({ x: p.x * sx, y: p.y * sy, r: senderRadius }));
      const im = imprintFromTouches(grid.X, grid.Y, pinCount, sc, senderRadius);
      for (let i = 0; i < pinCount; i++) if (im[i] > acc[i]) acc[i] = im[i];
    }
    heldImprint.value = acc;
    // playerRef created lazily on first replay tap
  }, [payload, pinCount, surfaceSize, sx, sy, senderRadius, heldImprint]);

  // Replay loop: walk the frames, scale coords, drive activeTouches.
  useEffect(() => {
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
        x: p.x * sx,
        y: p.y * sy,
        r: senderRadius,
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
  }, [isPlaying, sx, sy, senderRadius, activeTouches]);

  const startReplay = () => {
    if (!playerRef.current) playerRef.current = createPlayer(payload);
    // Reset visible state to a blank grid so the replay actually animates in
    // from nothing; the held imprint will rebuild as the worklet merges
    // active touches each frame.
    heldImprint.value = new Float32Array(pinCount);
    lastFrameIdsRef.current = new Set();
    playStartRef.current = Date.now();
    setIsPlaying(true);
  };

  const hasFrames = (payload.frames?.length ?? 0) > 0;

  return (
    <View>
      <View style={{ width: surfaceSize, height: surfaceSize, overflow: 'hidden' }}>
        <PinGrid
          activeTouches={activeTouches}
          heldImprint={heldImprint}
          isClearing={isClearing}
          maxDist={radiusSV}
          width={surfaceSize}
          height={surfaceSize}
        />
      </View>
      <View style={styles.controls}>
        <TouchableOpacity
          onPress={startReplay}
          disabled={isPlaying || !hasFrames}
          style={[styles.btn, { backgroundColor: hasFrames ? themeTint : '#444', opacity: isPlaying ? 0.7 : 1 }]}
        >
          {isPlaying ? <Play size={20} color="white" fill="white" /> : <RotateCcw size={20} color="white" />}
          <Text style={styles.btnLabel}>{isPlaying ? 'Playing…' : hasFrames ? 'Replay' : 'No replay'}</Text>
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
