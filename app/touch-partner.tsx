import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Send, Sparkles } from 'lucide-react-native';
import { useRouter, Stack } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { updateTouchWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Canvas, Skia, Points, vec } from '@shopify/react-native-skia';
import Animated, { useSharedValue, useDerivedValue, withTiming, runOnJS } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ⚙️ ENGINE CONSTANTS
const SPACING = 40; 
const COLS = Math.floor(SCREEN_WIDTH / SPACING) + 1;
const ROWS = Math.floor(SCREEN_HEIGHT / SPACING) + 1;
const PIN_COUNT = ROWS * COLS;
const MAX_DIST = 100;
const MAX_DIST_SQ = MAX_DIST * MAX_DIST;

// 🧊 STATIC GRID CACHE
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
  
  // 🖐️ LAYER 1: THE TOUCH LOGIC (Verified Stable)
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
      intensity.value = withTiming(0, { duration: 300 });
    } else {
      handleTouchUpdate(event);
    }
  };

  // 🧊 LAYER 2: THE RENDERING GRID (Unpolished but Working)
  const gridData = useDerivedValue(() => {
    const pts = touchPoints.value;
    const curInt = intensity.value;
    const numPts = pts.length;
    
    const stems = [];
    const caps = [];
    const centerX = SCREEN_WIDTH / 2;
    const centerY = SCREEN_HEIGHT / 2;

    for (let i = 0; i < PIN_COUNT; i++) {
      const bx = STATIC_X[i];
      const by = STATIC_Y[i];
      
      let dep = 0;
      if (curInt > 0 && numPts > 0) {
        for (let j = 0; j < numPts; j++) {
          const t = pts[j];
          const d2 = (bx - t.x)**2 + (by - t.y)**2;
          if (d2 < MAX_DIST_SQ) {
            const d = (1 - Math.sqrt(d2) / MAX_DIST) * 35 * curInt;
            if (d > dep) dep = d;
          }
        }
      }

      const tx = bx + (bx - centerX) * 0.08;
      const ty = by + (by - centerY) * 0.08 - (40 - dep);

      stems.push(vec(bx, by), vec(tx, ty));
      caps.push(vec(tx, ty));
    }
    return { stems, caps };
  });

  const sendTouch = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      updateTouchWidget("Touch sent!");
      await supabase.from('moments').insert([{
        user_id: userName,
        message: 'sent a touch',
        created_at: new Date().toISOString()
      }]);
      setTimeout(() => setIsSending(false), 1000);
    } catch (error) {
      setIsSending(false);
    }
  };

  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#000' : '#FFF';
  const stemColor = isDark ? '#333' : '#CCC';
  const capColor = isDark ? '#AAA' : '#888';

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }} />
      
      {/* TOUCH CAPTURE LAYER */}
      <View 
        style={StyleSheet.absoluteFill}
        onTouchStart={handleTouchUpdate}
        onTouchMove={handleTouchUpdate}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => { touchPoints.value = []; intensity.value = 0; }}
      >
        {/* RENDERING LAYER */}
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Points
            points={useDerivedValue(() => gridData.value.stems)}
            mode="lines"
            color={stemColor}
            strokeWidth={2}
          />
          <Points
            points={useDerivedValue(() => gridData.value.caps)}
            mode="points"
            color={capColor}
            strokeWidth={8}
            strokeCap="round"
          />
        </Canvas>
      </View>

      {/* HEADER / FOOTER OVERLAYS */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeHeaderBtn}>
          <X size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Touch Partner</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={sendTouch} 
          disabled={isSending} 
          style={[styles.sendButton, { backgroundColor: theme.tint, shadowColor: theme.tint }]}
        >
          <MotiView animate={{ scale: isSending ? 0.95 : 1 }}>
            <View style={styles.sendButtonContent}>
              {isSending ? <Sparkles size={24} color="white" /> : <Send size={24} color="white" />}
              <Text style={styles.sendButtonText}>{isSending ? 'Sending...' : `Send Touch`}</Text>
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
  closeHeaderBtn: { width: 44, height: 44, justifyContent: 'center', backgroundColor: 'rgba(150,150,150,0.1)', borderRadius: 22, alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 15, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 15 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '800' }
});
