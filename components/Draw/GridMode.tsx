// components/Draw/GridMode.tsx
// Grid mode for the Draw screen: pin-art canvas with multi-pattern accumulating
// imprint and recording. Exposes imperative send/clear via a ref so the parent
// header can drive both, leaving the canvas itself free of overlay buttons.

import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { useSharedValue, runOnJS, SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { processSyncQueue } from '@/lib/syncEngine';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import { createRecorder } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export type GridModeHandle = {
  send: () => Promise<void>;
  clear: () => void;
  isSending: () => boolean;
};

type Props = {
  radius: SharedValue<number>;
  themeTint: string;
  currentUserName: string;
  onSent?: () => void;
  onSendStart?: () => void;
  onSendEnd?: () => void;
};

const GridMode = forwardRef<GridModeHandle, Props>(function GridMode(
  { radius, currentUserName, onSent, onSendStart, onSendEnd },
  ref
) {
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

  // Synchronous clear — replaces the prior animated path that left a residual
  // mark when the worklet callback's heldImprint reassignment raced with the
  // next frame's merge. Doing the reset on the JS thread guarantees the new
  // empty Float32Array is in place before the next useFrameCallback fires.
  const handleClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    heldImprint.value = new Float32Array(pinCount);
    activeTouches.value = [];
    isClearing.value = 0;
    previousCount.value = 0;
    recorderRef.current.reset();
  };

  const handleSend = async () => {
    if (isSending) return;
    if (onSendStart) onSendStart();
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      // Use the recorder's frames as the source of truth for "did the user
      // draw anything" — Float32Arrays inside SharedValues don't reliably
      // round-trip mutations from the UI thread back to JS read access, so
      // the prior heldImprint bail-out kept failing silently.
      // The viewer reconstructs the imprint from frames if needed.
      const recording = recorderRef.current.finalize(
        new Float32Array(0),
        { w: SCREEN_WIDTH, h: SCREEN_HEIGHT }
      );
      if ((recording.frames?.length ?? 0) === 0) {
        console.warn('grid send: no frames recorded');
        setIsSending(false);
        if (onSendEnd) onSendEnd();
        return;
      }
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
      heldImprint.value = new Float32Array(pinCount);
      activeTouches.value = [];
      recorderRef.current.reset();
      if (onSent) onSent();
      setTimeout(() => {
        setIsSending(false);
        if (onSendEnd) onSendEnd();
      }, 1000);
    } catch (e) {
      console.warn('grid send failed', e);
      setIsSending(false);
      if (onSendEnd) onSendEnd();
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      send: handleSend,
      clear: handleClear,
      isSending: () => isSending,
    }),
    [isSending]
  );

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
    </View>
  );
});

export default GridMode;
