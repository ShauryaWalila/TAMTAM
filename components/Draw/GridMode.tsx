// components/Draw/GridMode.tsx
// Grid mode for the Draw screen: pin-art canvas with multi-pattern accumulating
// imprint and recording. Send writes a `posts` row with type='grid'.

import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View, Text } from 'react-native';
import { Heart, RotateCcw, Send, Sparkles } from 'lucide-react-native';
import { useSharedValue, withTiming, runOnJS, SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { processSyncQueue } from '@/lib/syncEngine';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import { createRecorder, float32ToBase64 } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = {
  radius: SharedValue<number>;        // user-adjustable touch radius (px)
  themeTint: string;
  currentUserName: string;
  // Called after a successful send so the parent can refresh its history.
  onSent?: () => void;
};

export default function GridMode({ radius, themeTint, currentUserName, onSent }: Props) {
  const [isSending, setIsSending] = useState(false);

  const pinCount = React.useMemo(
    () => buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT).pinCount,
    []
  );
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  const recorderRef = useRef(createRecorder());
  const previousCount = useSharedValue(0);

  const fireLandingHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const tickRecorderJS = (touches: Touch[]) => {
    recorderRef.current.tick(touches, Date.now());
  };

  const gesture = Gesture.Manual()
    .onTouchesDown((e) => {
      'worklet';
      const all = e.allTouches;
      const out: Touch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      if (out.length > previousCount.value) runOnJS(fireLandingHaptic)();
      previousCount.value = out.length;
      activeTouches.value = out;
      runOnJS(tickRecorderJS)(out);
    })
    .onTouchesMove((e) => {
      'worklet';
      const all = e.allTouches;
      const out: Touch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      previousCount.value = out.length;
      activeTouches.value = out;
      runOnJS(tickRecorderJS)(out);
    })
    .onTouchesUp((e) => {
      'worklet';
      const all = e.allTouches;
      previousCount.value = all.length;
      if (all.length === 0) {
        activeTouches.value = [];
        return;
      }
      const out: Touch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: radius.value });
      }
      activeTouches.value = out;
      runOnJS(tickRecorderJS)(out);
    })
    .onTouchesCancelled(() => {
      'worklet';
      activeTouches.value = [];
      previousCount.value = 0;
    });

  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    isClearing.value = withTiming(1, { duration: 600 }, (finished) => {
      'worklet';
      if (!finished) {
        isClearing.value = 0;
        return;
      }
      heldImprint.value = new Float32Array(pinCount);
      isClearing.value = 0;
      runOnJS(resetRecorderJS)();
    });
  };

  const resetRecorderJS = () => {
    recorderRef.current.reset();
  };

  const handleSend = async () => {
    if (isSending) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const finalImprint = heldImprint.value;
      // Bail if nothing has been drawn this session.
      let any = false;
      for (let i = 0; i < finalImprint.length; i++) {
        if (finalImprint[i] > 0) { any = true; break; }
      }
      if (!any) {
        setIsSending(false);
        return;
      }

      const recording = recorderRef.current.finalize(
        finalImprint,
        { w: SCREEN_WIDTH, h: SCREEN_HEIGHT }
      );
      const payload = { ...recording, type: 'pattern' as const };
      const id = generateUUID();
      const now = new Date().toISOString();
      const content = JSON.stringify(payload);
      db.runSync(
        `INSERT INTO posts (id, created_at, updated_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, now, now, 'grid', content, currentUserName || 'user_1', JSON.stringify({}), '']
      );
      queueSyncOperation('posts', id, 'INSERT', {
        id,
        type: 'grid',
        content,
        user_id: currentUserName || 'user_1',
        created_at: now,
        updated_at: now,
        reactions: {},
      });
      processSyncQueue();
      // Reset local state.
      heldImprint.value = new Float32Array(pinCount);
      activeTouches.value = [];
      recorderRef.current.reset();
      if (onSent) onSent();
      setTimeout(() => setIsSending(false), 1000);
    } catch (e) {
      console.warn('grid send failed', e);
      setIsSending(false);
    }
  };

  // Bail-out cleanup if component unmounts mid-clear.
  useEffect(() => {
    return () => {
      isClearing.value = 0;
    };
  }, [isClearing]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <PinGrid
            activeTouches={activeTouches}
            heldImprint={heldImprint}
            isClearing={isClearing}
            maxDist={radius}
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
