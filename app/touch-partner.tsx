import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Heart, Sparkles } from 'lucide-react-native';
import { useRouter, Stack } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Canvas, Skia, Points, vec, Group, Path, Shadow, Rect, BlurMask } from '@shopify/react-native-skia';
import Animated, { useSharedValue, useDerivedValue, withTiming } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ⚙️ ULTRA-HIGH DENSITY ENGINE
const SPACING = 14; // Massive density (4x original)
const COLS = Math.floor(SCREEN_WIDTH / SPACING) + 1;
const ROWS = Math.floor(SCREEN_HEIGHT / SPACING) + 1;
const PIN_COUNT = ROWS * COLS;
const MAX_DIST = 55; // Smaller, more accurate radius
const MAX_DIST_SQ = MAX_DIST * MAX_DIST;

// Static grid coordinates (Typed Arrays for speed)
const STATIC_X = new Float32Array(PIN_COUNT);
const STATIC_Y = new Float32Array(PIN_COUNT);
const OFFSET_X = (SCREEN_WIDTH - (COLS - 1) * SPACING) / 2;
const OFFSET_Y = (SCREEN_HEIGHT - (ROWS - 1) * SPACING) / 2;

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    STATIC_X[i] = c * SPACING + OFFSET_X;
    STATIC_Y[i] = r * SPACING + OFFSET_Y;
  }
}

export default function TouchPartnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // 🖐️ RAW TOUCH CAPTURE
  const touchPoints = useSharedValue<{x: number, y: number, id: number}[]>([]);
  const intensity = useSharedValue(0);

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

  const handleTouchUpdate = (event: any) => {
    const nativeTouches = event.nativeEvent.touches;
    const pts = [];
    for (let i = 0; i < nativeTouches.length; i++) {
      pts.push({
        x: nativeTouches[i].locationX,
        y: nativeTouches[i].locationY,
        id: nativeTouches[i].identifier
      });
    }
    if (pts.length > touchPoints.value.length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      intensity.value = withTiming(1, { duration: 150 });
    }
    touchPoints.value = pts;
  };

  const handleTouchEnd = (event: any) => {
    const nativeTouches = event.nativeEvent.touches;
    if (nativeTouches.length === 0) {
      touchPoints.value = [];
      intensity.value = withTiming(0, { duration: 400 });
    } else {
      handleTouchUpdate(event);
    }
  };

  // 🌈 VISUAL THEME
  const bgColor = '#000000';
  const activeColor = theme.tint; // High-visibility Pink/Purple
  const inactivePin = '#111111';

  // 🧊 TACTILE RENDERING ENGINE
  const gridVisuals = useDerivedValue(() => {
    const pts = touchPoints.value;
    const curInt = intensity.value;
    const numPts = pts.length;
    
    const capPoints = [];
    const capColors = [];
    const stemPoints = [];
    const heatmapPoints = [];

    // Perspective focal center
    const cx_mid = SCREEN_WIDTH / 2;
    const cy_mid = SCREEN_HEIGHT / 2;

    // 1. Map heatmap glows (under fingers)
    for (let j = 0; j < numPts; j++) {
      heatmapPoints.push(vec(pts[j].x, pts[j].y));
    }

    // 2. Map high-density pins
    for (let i = 0; i < PIN_COUNT; i++) {
      const bx = STATIC_X[i];
      const by = STATIC_Y[i];
      
      let dep = 0;
      let ratio = 0;
      
      if (curInt > 0 && numPts > 0) {
        for (let j = 0; j < numPts; j++) {
          const t = pts[j];
          const dx = bx - t.x;
          const dy = by - t.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < MAX_DIST_SQ) {
            // TACTILE MATH: Accurate pressure falloff
            const dist = Math.sqrt(d2);
            const r = (1 - dist / MAX_DIST);
            const currentRatio = Math.pow(r, 1.2); // Smooth but focused
            if (currentRatio > ratio) ratio = currentRatio;
            
            // Higher depression for more accuracy
            const currentDep = currentRatio * 55 * curInt;
            if (currentDep > dep) dep = currentDep;
          }
        }
      }

      // Parallax shifts pins slightly towards edges
      const px = (bx - cx_mid) * 0.12;
      const py = (by - cy_mid) * 0.12;
      
      const topX = bx + px;
      const topY = by + py - (45 - dep);

      // Lines for cylinder bodies
      stemPoints.push(vec(bx, by), vec(topX, topY));
      // Point for tactile cap
      capPoints.push(vec(topX, topY));
      
      // COLOR: Only highlight exactly where the touch is
      const color = Skia.Color(ratio > 0.1 ? activeColor : inactivePin);
      capColors.push(color);
    }

    return { capPoints, capColors, stemPoints, heatmapPoints };
  });

  const sendTouch = async () => {
    if (isSending) return;
    setIsSending(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      updateTouchWidget("Touch sent!");
      await supabase.from('moments').insert([{
        user_id: userName, message: 'sent a touch', created_at: new Date().toISOString()
      }]);
      setTimeout(() => setIsSending(false), 1000);
    } catch (error) {
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
      
      <View 
        style={StyleSheet.absoluteFill}
        onTouchStart={handleTouchUpdate}
        onTouchMove={handleTouchUpdate}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { touchPoints.value = []; intensity.value = 0; }}
      >
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Rect x={0} y={0} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} color="#000000" />

          {/* Layer 1: Tactile Heatmap Glow */}
          <Points
            points={useDerivedValue(() => gridVisuals.value.heatmapPoints)}
            mode="points"
            color={activeColor}
            strokeWidth={120}
            strokeCap="round"
          >
            <BlurMask blur={40} style="normal" />
          </Points>

          {/* Layer 2: High-Density Stems */}
          <Points
            points={useDerivedValue(() => gridVisuals.value.stemPoints)}
            mode="lines"
            color="#080808"
            strokeWidth={1}
          />

          {/* Layer 3: Physical Tactile Pins */}
          <Group>
            <Points
              points={useDerivedValue(() => gridVisuals.value.capPoints)}
              colors={useDerivedValue(() => gridVisuals.value.capColors)}
              mode="points"
              strokeWidth={7} // Smaller, sharper pins for density
              strokeCap="round"
            />
            {/* Glossy area glow */}
            <Shadow dx={0} dy={0} blur={10} color={activeColor} />
          </Group>
        </Canvas>
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
          style={[styles.sendButton, { backgroundColor: activeColor }]}
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
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '900' }
});
