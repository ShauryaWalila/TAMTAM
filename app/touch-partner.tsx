import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, Alert } from 'react-native';
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
import { Canvas, Path, Skia, RadialGradient, vec } from '@shopify/react-native-skia';
import Animated, { useSharedValue, useDerivedValue, withSpring, runOnJS, withTiming } from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const PIN_RADIUS = 5;
const SPACING = 24;
const COLS = Math.floor(SCREEN_WIDTH / SPACING) + 2;
const ROWS = Math.floor(SCREEN_HEIGHT / SPACING) + 2;
const OFFSET_X = (SCREEN_WIDTH - (COLS - 1) * SPACING) / 2;
const OFFSET_Y = (SCREEN_HEIGHT - (ROWS - 1) * SPACING) / 2;
const MAX_DIST = 100;

interface TouchPoint {
  x: number;
  y: number;
  id: number;
}

export default function TouchPartnerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [userName, setUserName] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSending, setIsSending] = useState(false);

  const isDark = colorScheme === 'dark';
  const bgColor = isDark ? '#0A0A0A' : '#F0F0F5';
  const stemColor = isDark ? '#1F1F1F' : '#D1D1D6';
  const capColor = isDark ? '#3A3A3C' : '#FFFFFF';
  const glowColor = theme.tint;

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    if (user) {
      setUserName(user.toLowerCase());
      setPartnerName(user.toLowerCase() === 'love' ? 'pratishth' : 'love');
    }
  };

  // --- Multi-Touch State ---
  const activeTouches = useSharedValue<TouchPoint[]>([]);
  const touchIntensity = useSharedValue(0);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleTouch = (event: any) => {
    'worklet';
    const touches = event.nativeEvent?.touches || [];
    const points: TouchPoint[] = [];
    
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      points.push({ x: touch.locationX, y: touch.locationY, id: i });
    }

    if (points.length > 0 && activeTouches.value.length === 0) {
      touchIntensity.value = withTiming(1, { duration: 150 });
      runOnJS(triggerHaptic)();
    } else if (points.length === 0 && activeTouches.value.length > 0) {
      touchIntensity.value = withTiming(0, { duration: 400 });
    }

    activeTouches.value = points;
  };

  // --- 3D Grid Paths ---
  const stemsPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const touches = activeTouches.value;
    const intensity = touchIntensity.value;
    
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cx = c * SPACING + OFFSET_X;
        const cy = r * SPACING + OFFSET_Y;
        
        let maxDepression = 0;
        
        // Check all active touches for depression
        for (const t of touches) {
          const dist = Math.hypot(cx - t.x, cy - t.y);
          if (dist < MAX_DIST) {
            const dep = Math.pow(1 - dist / MAX_DIST, 2) * 35 * intensity;
            if (dep > maxDepression) maxDepression = dep;
          }
        }
        
        const dx = cx - SCREEN_WIDTH / 2;
        const dy = cy - SCREEN_HEIGHT / 2;
        const height = 40 - maxDepression;
        const topX = cx + dx * 0.08;
        const topY = cy + dy * 0.08 - height;
        
        p.moveTo(cx, cy);
        p.lineTo(topX, topY);
      }
    }
    return p;
  });

  const capsPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const touches = activeTouches.value;
    const intensity = touchIntensity.value;
    
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cx = c * SPACING + OFFSET_X;
        const cy = r * SPACING + OFFSET_Y;
        
        let maxDepression = 0;
        for (const t of touches) {
          const dist = Math.hypot(cx - t.x, cy - t.y);
          if (dist < MAX_DIST) {
            const dep = Math.pow(1 - dist / MAX_DIST, 2) * 35 * intensity;
            if (dep > maxDepression) maxDepression = dep;
          }
        }
        
        const dx = cx - SCREEN_WIDTH / 2;
        const dy = cy - SCREEN_HEIGHT / 2;
        const height = 40 - maxDepression;
        const topX = cx + dx * 0.08;
        const topY = cy + dy * 0.08 - height;
        
        p.addCircle(topX, topY, PIN_RADIUS);
      }
    }
    return p;
  });

  // Use the first touch for the glow effect
  const mainTouchX = useDerivedValue(() => activeTouches.value[0]?.x ?? -1000);
  const mainTouchY = useDerivedValue(() => activeTouches.value[0]?.y ?? -1000);
  const gradientCenter = useDerivedValue(() => vec(mainTouchX.value, mainTouchY.value));
  const gradientRadius = useDerivedValue(() => Math.max(MAX_DIST * touchIntensity.value, 0.1));

  const sendTouch = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      updateTouchWidget("Touch sent!");
      const { error } = await supabase.from('moments').insert([{
        user_id: userName,
        message: 'sent a touch',
        created_at: new Date().toISOString()
      }]);
      if (error) throw error;
      setTimeout(() => {
        setIsSending(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        Alert.alert('Sent', 'Your touch was delivered!');
      }, 1000);
    } catch (error) {
      console.error(error);
      setIsSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      
      <Canvas style={StyleSheet.absoluteFill} onTouch={handleTouch}>
        <Path path={stemsPath} color={stemColor} style="stroke" strokeWidth={PIN_RADIUS * 2} strokeCap="round" />
        <Path path={capsPath}>
          <RadialGradient c={gradientCenter} r={gradientRadius} colors={[glowColor, glowColor, capColor]} positions={[0, 0.5, 1]} />
        </Path>
      </Canvas>

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeHeaderBtn}>
          <X size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Touch Partner</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.instructionBox} pointerEvents="none">
        <Text style={styles.instructionText}>Touch with multiple fingers</Text>
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity activeOpacity={0.8} onPress={sendTouch} disabled={isSending} style={[styles.sendButton, { backgroundColor: theme.tint, shadowColor: theme.tint }]}>
          <MotiView animate={{ scale: isSending ? 0.95 : 1 }}>
            <View style={styles.sendButtonContent}>
              {isSending ? <Sparkles size={24} color="white" /> : <Send size={24} color="white" />}
              <Text style={styles.sendButtonText}>{isSending ? 'Sending...' : `Send Touch to ${partnerName === 'love' ? 'Supriya' : 'Pratishth'}`}</Text>
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
  instructionBox: { position: 'absolute', top: 120, width: '100%', alignItems: 'center', zIndex: 5 },
  instructionText: { fontSize: 14, fontWeight: '600', color: '#8E8E93', letterSpacing: 1, textTransform: 'uppercase', backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, overflow: 'hidden' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  sendButton: { width: SCREEN_WIDTH * 0.85, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 15, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 15 },
  sendButtonContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sendButtonText: { color: 'white', fontSize: 16, fontWeight: '800' }
});
