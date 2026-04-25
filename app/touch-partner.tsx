import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Sparkles, X } from 'lucide-react-native';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useSharedValue, useDerivedValue, runOnJS, SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Canvas, Circle, Group, BlurMask, Rect } from '@shopify/react-native-skia';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type HeatTouch = { id: number; x: number; y: number; r: number };

// Maximum simultaneous heat blobs we draw. A whole-hand contact rarely
// surfaces more than ~10 touches; 30 leaves room for two hands plus
// transient artifacts.
const MAX_HEAT_POINTS = 30;

// Radius gesture-handler doesn't expose, so each touch is given the same
// nominal contact size; the BlurMask softens it into a fingerpad glow.
const TOUCH_RADIUS = 30;
const HEAT_VISUAL_SCALE = 4;
const HEAT_BLUR_PX = 50;

export default function TouchPartnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Last visible heatmap state — kept after lift, replaced on next fresh touch.
  const displayTouches = useSharedValue<HeatTouch[]>([]);
  // Read & written from the worklet so we can fire haptics on new finger landings.
  const previousCount = useSharedValue(0);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    if (user) {
      setUserName(user.toLowerCase());
      setPartnerName(user.toLowerCase() === 'love' ? 'supriya' : 'love');
    }
  };

  const fireLandingHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const gesture = Gesture.Manual()
    .onTouchesDown((e) => {
      'worklet';
      const all = e.allTouches;
      const out: HeatTouch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: TOUCH_RADIUS });
      }
      if (out.length > previousCount.value) runOnJS(fireLandingHaptic)();
      previousCount.value = out.length;
      displayTouches.value = out;
    })
    .onTouchesMove((e) => {
      'worklet';
      const all = e.allTouches;
      const out: HeatTouch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: TOUCH_RADIUS });
      }
      previousCount.value = out.length;
      displayTouches.value = out;
    })
    .onTouchesUp((e) => {
      'worklet';
      const all = e.allTouches;
      if (all.length === 0) {
        // Last finger lifted: leave displayTouches at its last value so the
        // heatmap stays on screen until a new touch begins or we send.
        previousCount.value = 0;
        return;
      }
      const out: HeatTouch[] = [];
      for (let i = 0; i < all.length; i++) {
        out.push({ id: all[i].id, x: all[i].x, y: all[i].y, r: TOUCH_RADIUS });
      }
      previousCount.value = out.length;
      displayTouches.value = out;
    })
    .onTouchesCancelled(() => {
      'worklet';
      previousCount.value = 0;
      // Don't wipe displayTouches so the user keeps their last imprint visible.
    });

  const sendTouch = async () => {
    if (isSending) return;
    const snapshot = displayTouches.value;
    if (!snapshot || snapshot.length === 0) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      const payload = {
        v: 1,
        type: 'heatmap' as const,
        screen: { w: SCREEN_WIDTH, h: SCREEN_HEIGHT },
        touches: snapshot.map((t) => ({ x: t.x, y: t.y, r: t.r })),
      };
      updateTouchWidget('Touch sent!');
      await supabase.from('moments').insert([{
        user_id: userName,
        message: 'sent a touch',
        created_at: new Date().toISOString(),
        touch_payload: payload,
      }]);
      // Reset visual state so the screen reads as "ready for next imprint".
      displayTouches.value = [];
      setTimeout(() => setIsSending(false), 1000);
    } catch (error) {
      console.warn('sendTouch failed', error);
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />

      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <HeatmapCanvas touches={displayTouches} color={theme.tint} />
        </View>
      </GestureDetector>

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

function HeatmapCanvas({ touches, color }: { touches: SharedValue<HeatTouch[]>; color: string }) {
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} color="#000" />
      <Group>
        <BlurMask blur={HEAT_BLUR_PX} style="normal" />
        {Array.from({ length: MAX_HEAT_POINTS }, (_, i) => (
          <HeatBlob key={i} index={i} touches={touches} color={color} />
        ))}
      </Group>
    </Canvas>
  );
}

function HeatBlob({
  index,
  touches,
  color,
}: {
  index: number;
  touches: SharedValue<HeatTouch[]>;
  color: string;
}) {
  // Park unused slots far offscreen with r=0 so they're cheap to skip.
  const cx = useDerivedValue(() => touches.value[index]?.x ?? -10000);
  const cy = useDerivedValue(() => touches.value[index]?.y ?? -10000);
  const r = useDerivedValue(() =>
    touches.value[index] ? touches.value[index].r * HEAT_VISUAL_SCALE : 0
  );
  return <Circle cx={cx} cy={cy} r={r} color={color} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 2 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '900' }
});
