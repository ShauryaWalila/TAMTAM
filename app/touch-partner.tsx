import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Sparkles, X } from 'lucide-react-native';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import {
  DEFAULT_TOUCH_RADIUS,
} from '@/components/PinGrid/constants';
import { createRecorder } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TouchPartnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Allocate held imprint sized to this device's pin count.
  const pinCount = React.useMemo(
    () => buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT).pinCount,
    []
  );
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  // Recorder lives on JS thread.
  const recorderRef = useRef(createRecorder());

  useEffect(() => {
    loadUsers();
    return () => { cancelClearTimer(); };
  }, []);

  const loadUsers = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    if (user) {
      setUserName(user.toLowerCase());
      setPartnerName(user.toLowerCase() === 'love' ? 'supriya' : 'love');
    }
  };

  const extractTouches = (event: any): Touch[] => {
    const native = event.nativeEvent.touches;
    const out: Touch[] = [];
    for (let i = 0; i < native.length; i++) {
      const t = native[i];
      const force = typeof t.force === 'number' ? t.force : 0;
      const radius =
        typeof t.radiusX === 'number' && t.radiusX > 0
          ? Math.max(t.radiusX, t.radiusY ?? t.radiusX)
          : typeof t.touchMajor === 'number' && t.touchMajor > 0
          ? t.touchMajor / 2
          : DEFAULT_TOUCH_RADIUS + force * 6; // iOS force boost
      out.push({
        id: t.identifier,
        x: t.locationX,
        y: t.locationY,
        r: radius,
      });
    }
    return out;
  };

  const previousCountRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetRecorderJS = () => {
    recorderRef.current.reset();
  };

  const startClearTimer = () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => {
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
    }, 1000);
  };

  const cancelClearTimer = () => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
  };

  const handleTouchUpdate = (event: any) => {
    const touches = extractTouches(event);
    if (touches.length > previousCountRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (touches.length === 2 && previousCountRef.current !== 2) {
      startClearTimer();
    } else if (touches.length !== 2) {
      cancelClearTimer();
    }
    previousCountRef.current = touches.length;
    activeTouches.value = touches;
    recorderRef.current.tick(touches, Date.now());
  };

  const handleTouchEnd = (event: any) => {
    const touches = extractTouches(event);
    if (touches.length !== 2) cancelClearTimer();
    previousCountRef.current = touches.length;
    activeTouches.value = touches;
    recorderRef.current.tick(touches, Date.now());
  };

  const sendTouch = async () => {
    if (isSending) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const recording = recorderRef.current.finalize(
        heldImprint.value,
        { w: SCREEN_WIDTH, h: SCREEN_HEIGHT }
      );
      updateTouchWidget('Touch sent!');
      await supabase.from('moments').insert([{
        user_id: userName,
        message: 'sent a touch',
        created_at: new Date().toISOString(),
        touch_payload: recording,
      }]);
      // Clear locally
      heldImprint.value = new Float32Array(pinCount);
      activeTouches.value = [];
      recorderRef.current.reset();
      setTimeout(() => setIsSending(false), 1000);
    } catch (error) {
      console.warn('sendTouch failed', error);
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />

      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={handleTouchUpdate}
        onTouchMove={handleTouchUpdate}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          activeTouches.value = [];
          previousCountRef.current = 0;
          cancelClearTimer();
        }}
      >
        <PinGrid
          activeTouches={activeTouches}
          heldImprint={heldImprint}
          isClearing={isClearing}
        />
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>Touch Partner</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={sendTouch}
          disabled={isSending}
          style={[styles.sendButton, { backgroundColor: theme.tint }]}
        >
          <MotiView animate={{ scale: isSending ? 0.95 : 1 }}>
            <View style={styles.sendButtonContent}>
              {isSending ? <Sparkles size={24} color="white" /> : <Heart size={24} color="white" fill="white" />}
              <Text style={styles.sendButtonText}>Send Touch</Text>
            </View>
          </MotiView>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 2 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '900' },
});
