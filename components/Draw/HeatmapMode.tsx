// components/Draw/HeatmapMode.tsx
// Heatmap mode for the Draw screen: glow blobs under each contact, recorded as
// frames over the touch session. Send writes a `posts` row with type='heatmap'.

import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View, Text } from 'react-native';
import { RotateCcw, Send, Sparkles } from 'lucide-react-native';
import { useSharedValue, runOnJS, SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { processSyncQueue } from '@/lib/syncEngine';
import { createRecorder } from '@/lib/touchRecording';
import HeatmapCanvas, { HeatTouch } from './HeatmapCanvas';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const HEAT_BLUR_PX = 50;

type Props = {
  // User-adjustable contact radius (px). Each touch's r is set from this.
  radius: SharedValue<number>;
  // Visual scale applied per touch (multiplied into r each frame).
  visualScale: SharedValue<number>;
  themeTint: string;
  currentUserName: string;
  onSent?: () => void;
};

export default function HeatmapMode({ radius, visualScale, themeTint, currentUserName, onSent }: Props) {
  const [isSending, setIsSending] = useState(false);

  const liveTouches = useSharedValue<HeatTouch[]>([]);
  const blurSV = useSharedValue(HEAT_BLUR_PX);
  const previousCount = useSharedValue(0);

  const recorderRef = useRef(createRecorder());

  const fireLandingHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const tickRecorderJS = (touches: { x: number; y: number; r: number; id: number }[]) => {
    recorderRef.current.tick(touches, Date.now());
  };

  const gesture = Gesture.Manual()
    .onTouchesDown((e) => {
      'worklet';
      const all = e.allTouches;
      const out: HeatTouch[] = [];
      const recOut: { id: number; x: number; y: number; r: number }[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
        recOut.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      if (out.length > previousCount.value) runOnJS(fireLandingHaptic)();
      previousCount.value = out.length;
      liveTouches.value = out;
      runOnJS(tickRecorderJS)(recOut);
    })
    .onTouchesMove((e) => {
      'worklet';
      const all = e.allTouches;
      const out: HeatTouch[] = [];
      const recOut: { id: number; x: number; y: number; r: number }[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
        recOut.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      previousCount.value = out.length;
      liveTouches.value = out;
      runOnJS(tickRecorderJS)(recOut);
    })
    .onTouchesUp((e) => {
      'worklet';
      const all = e.allTouches;
      previousCount.value = all.length;
      if (all.length === 0) {
        // All fingers lifted: keep the last frame visible until a new touch.
        return;
      }
      const out: HeatTouch[] = [];
      const recOut: { id: number; x: number; y: number; r: number }[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
        recOut.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      liveTouches.value = out;
      runOnJS(tickRecorderJS)(recOut);
    })
    .onTouchesCancelled(() => {
      'worklet';
      previousCount.value = 0;
    });

  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    liveTouches.value = [];
    recorderRef.current.reset();
  };

  const handleSend = async () => {
    if (isSending) return;
    const snapshot = liveTouches.value;
    if (!snapshot || snapshot.length === 0) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const recording = recorderRef.current.finalize(
        new Float32Array(0),
        { w: SCREEN_WIDTH, h: SCREEN_HEIGHT }
      );
      const payload = {
        v: 1 as const,
        type: 'heatmap' as const,
        screen: { w: SCREEN_WIDTH, h: SCREEN_HEIGHT },
        duration_ms: recording.duration_ms,
        frames: recording.frames,
        // Final still frame so a static viewer can render the resting state
        // without playing through the recording.
        final_touches: snapshot.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      };
      const id = generateUUID();
      const now = new Date().toISOString();
      const content = JSON.stringify(payload);
      db.runSync(
        `INSERT INTO posts (id, created_at, updated_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, now, now, 'heatmap', content, currentUserName || 'user_1', JSON.stringify({}), '']
      );
      queueSyncOperation('posts', id, 'INSERT', {
        id,
        type: 'heatmap',
        content,
        user_id: currentUserName || 'user_1',
        created_at: now,
        updated_at: now,
        reactions: {},
      });
      processSyncQueue();
      liveTouches.value = [];
      recorderRef.current.reset();
      if (onSent) onSent();
      setTimeout(() => setIsSending(false), 1000);
    } catch (e) {
      console.warn('heatmap send failed', e);
      setIsSending(false);
    }
  };

  useEffect(() => {
    return () => {
      // No-op cleanup hook to mirror GridMode pattern (and reserve a place for
      // future cancellation logic).
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <HeatmapCanvas
            touches={liveTouches}
            visualScale={visualScale}
            blur={blurSV}
            color={themeTint}
          />
        </View>
      </GestureDetector>

      <View style={styles.actionsRow} pointerEvents="box-none">
        <TouchableOpacity onPress={handleClear} style={styles.actionBtn}>
          <RotateCcw size={20} color="#FFF" />
          <Text style={styles.actionLabel}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleSend}
          disabled={isSending}
          style={[styles.sendBtn, { backgroundColor: themeTint }]}
        >
          {isSending ? <Sparkles size={22} color="#FFF" /> : <Send size={22} color="#FFF" />}
          <Text style={styles.sendLabel}>{isSending ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionsRow: { position: 'absolute', bottom: 100, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 16 },
  actionBtn: { paddingHorizontal: 20, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionLabel: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  sendBtn: { paddingHorizontal: 30, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sendLabel: { color: '#FFF', fontSize: 16, fontWeight: '900' },
});
