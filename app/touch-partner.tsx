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

// ⚙️ HIGH-STABILITY PERFORMANCE CONFIG
const SPACING = 28; // Balanced density to prevent memory crashes
const COLS = Math.floor(SCREEN_WIDTH / SPACING) + 1;
const ROWS = Math.floor(SCREEN_HEIGHT / SPACING) + 1;
const PIN_COUNT = ROWS * COLS;
const MAX_DIST = 100;
const MAX_DIST_SQ = MAX_DIST * MAX_DIST;

// Static grid coordinates stored in Typed Arrays for zero GC pressure
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
  
  // 🖐️ RAW TOUCH STATE
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

  // 🌈 COLOR CONFIG
  const isDark = colorScheme === 'dark';
  const bgColor = '#000000';
  const glowColor = theme.tint;

  // 🧊 RENDER ENGINE (OPTIMIZED TO PREVENT CRASHES)
  const gridVisuals = useDerivedValue(() => {
    const pts = touchPoints.value;
    const curInt = intensity.value;
    const numPts = pts.length;
    
    const capPoints = [];
    const capColors = [];
    const heatmapPoints = [];
    const stemPath = Skia.Path.Make();

    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT / 2;

    // 1. Generate Heatmap data (Glow points)
    for (let j = 0; j < numPts; j++) {
      heatmapPoints.push(vec(pts[j].x, pts[j].y));
    }

    // 2. Generate Grid data
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
            const currentRatio = (1 - Math.sqrt(d2) / MAX_DIST);
            if (currentRatio > ratio) ratio = currentRatio;
            const currentDep = currentRatio * 45 * curInt;
            if (currentDep > dep) dep = currentDep;
          }
        }
      }

      const topX = bx + (bx - centerX) * 0.12;
      const topY = by + (by - centerY) * 0.12 - (35 - dep);

      stemPath.moveTo(bx, by);
      stemPath.lineTo(topX, topY);
      capPoints.push(vec(topX, topY));
      
      // Fast color mapping
      const color = Skia.Color(ratio > 0.05 ? glowColor : '#1A1A1A');
      capColors.push(color);
    }

    return { capPoints, capColors, stemPath, heatmapPoints };
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
          {/* Layer 0: Background */}
          <Rect x={0} y={0} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} color="#000000" />

          {/* Layer 1: Optimized Heatmap Glow */}
          <Points
            points={useDerivedValue(() => gridVisuals.value.heatmapPoints)}
            mode="points"
            color={glowColor}
            strokeWidth={140}
            strokeCap="round"
          >
            <BlurMask blur={40} style="normal" />
          </Points>

          {/* Layer 2: Stems */}
          <Path
            path={useDerivedValue(() => gridVisuals.value.stemPath)}
            style="stroke"
            strokeWidth={2}
            color="#0A0A0A"
          />

          {/* Layer 3: Vibrant Pins */}
          <Group>
            <Points
              points={useDerivedValue(() => gridVisuals.value.capPoints)}
              colors={useDerivedValue(() => gridVisuals.value.capColors)}
              mode="points"
              strokeWidth={12} 
              strokeCap="round"
            />
            <Shadow dx={0} dy={0} blur={10} color={glowColor} />
          </Group>
        </Canvas>
      </View>

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.titleText}>Touch Partner</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={sendTouch} 
          disabled={isSending} 
          style={[styles.sendButton, { backgroundColor: glowColor }]}
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
  titleText: { fontSize: 18, fontWeight: '900', color: '#FFF', textTransform: 'uppercase', letterSpacing: 1 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
