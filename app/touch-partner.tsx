import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Sparkles, X } from 'lucide-react-native';
import { Stack, useRouter } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useSharedValue, useDerivedValue, SharedValue } from 'react-native-reanimated';
import { Canvas, Circle, Group, BlurMask, Rect } from '@shopify/react-native-skia';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type HeatTouch = { id: number; x: number; y: number; r: number };

// Maximum simultaneous heat blobs we draw. Real palms register up to ~10
// distinct touches on most devices; 20 is comfortably above that.
const MAX_HEAT_POINTS = 20;

// Visual scale: contact radius from the OS is much smaller than the finger
// pad we want to show. 3.5x maps a typical 14px contact radius to a ~50px
// visual circle, which the BlurMask softens into a fingertip-sized glow.
const HEAT_VISUAL_SCALE = 3.5;
const HEAT_BLUR_PX = 36;

// Default radius when the device doesn't expose contact size.
const DEFAULT_TOUCH_RADIUS = 18;

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
  const previousCountRef = useRef(0);

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

  const extractTouches = (event: any): HeatTouch[] => {
    const native = event.nativeEvent.touches;
    const out: HeatTouch[] = [];
    for (let i = 0; i < native.length; i++) {
      const t = native[i];
      const force = typeof t.force === 'number' ? t.force : 0;
      const radius =
        typeof t.radiusX === 'number' && t.radiusX > 0
          ? Math.max(t.radiusX, t.radiusY ?? t.radiusX)
          : typeof t.touchMajor === 'number' && t.touchMajor > 0
          ? t.touchMajor / 2
          : DEFAULT_TOUCH_RADIUS + force * 12;
      out.push({
        id: t.identifier,
        x: t.locationX,
        y: t.locationY,
        r: radius,
      });
    }
    return out;
  };

  const handleTouchUpdate = (event: any) => {
    const touches = extractTouches(event);
    if (touches.length > previousCountRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    previousCountRef.current = touches.length;
    if (touches.length > 0) {
      // Live: drive the heatmap from current contact points.
      displayTouches.value = touches;
    }
    // touches.length === 0 path is handled in handleTouchEnd so we keep
    // the last frame as the persistent snapshot.
  };

  const handleTouchEnd = (event: any) => {
    const touches = extractTouches(event);
    previousCountRef.current = touches.length;
    if (touches.length === 0) {
      // All fingers lifted: leave displayTouches at its last value so the
      // heatmap stays on screen until a new touch begins or we send.
      return;
    }
    displayTouches.value = touches;
  };

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

      <View
        style={StyleSheet.absoluteFill}
        onTouchStart={handleTouchUpdate}
        onTouchMove={handleTouchUpdate}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { displayTouches.value = []; previousCountRef.current = 0; }}
      >
        <HeatmapCanvas touches={displayTouches} color={theme.tint} />
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
