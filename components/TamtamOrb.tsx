import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, Dimensions, DeviceEventEmitter } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  runOnJS, 
  interpolate,
  useDerivedValue,
  withTiming,
  Extrapolate
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Home, BookHeart, Map, Wallet, Heart, Settings, PenTool } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { MotiView, AnimatePresence } from 'moti';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const NAV_ITEMS = [
  { id: 'index', path: '/', label: 'US', icon: Home, color: '#FF2D55' },
  { id: 'journal', path: '/journal', label: 'JOURNAL', icon: BookHeart, color: '#AF52DE' },
  { id: 'draw', path: '/draw', label: 'DRAW', icon: PenTool, color: '#FF9500' },
  { id: 'our-life', path: '/our-life', label: 'LIFE', icon: Map, color: '#34C759' },
  { id: 'finance', path: '/finance', label: 'FINANCE', icon: Wallet, color: '#5856D6' },
  { id: 'wishlist', path: '/wishlist', label: 'WISH', icon: Heart, color: '#FF2D55' },
  { id: 'settings', path: '/settings', label: 'SETTINGS', icon: Settings, color: '#8E8E93' },
];

const ITEM_SIZE = 55;
const TOTAL_MENU_HEIGHT = NAV_ITEMS.length * ITEM_SIZE;
const SPRING_CONFIG = { damping: 15, stiffness: 150, mass: 0.6 };

export default function TamtamOrb() {
  const router = useRouter();
  const pathname = usePathname();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  // 📍 SHARED POSITION
  const orbX = useSharedValue(12);
  const orbY = useSharedValue(SCREEN_HEIGHT / 2 - 30);
  
  // 🎢 GESTURE STATE
  const expansion = useSharedValue(0);
  const activeIdx = useSharedValue(-1);
  const dragActive = useSharedValue(0);
  const lastTap = useSharedValue(0);
  
  // JS state for labels (AnimatePresence needs this)
  const [currentLabel, setCurrentLabel] = useState('');

  const updateUI = (idx: number) => {
    if (idx === -1) {
      setCurrentLabel('');
    } else {
      setCurrentLabel(NAV_ITEMS[idx].label);
      Haptics.selectionAsync();
    }
  };

  const onNavigate = (idx: number) => {
    if (idx === -1) return;
    const item = NAV_ITEMS[idx];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (pathname === item.path && item.id === 'our-life') DeviceEventEmitter.emit('our-life-tab-press');
    else router.push(item.path);
  };

  // 🖱️ RELOCATE (Double Tap + Hold)
  const dragGesture = Gesture.Pan()
    .onBegin(() => {
      const now = Date.now();
      if (now - lastTap.value < 350) {
        dragActive.value = withSpring(1, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      }
      lastTap.value = now;
    })
    .onUpdate((e) => {
      if (dragActive.value > 0.5) {
        orbX.value = e.absoluteX - 30;
        orbY.value = e.absoluteY - 30;
      }
    })
    .onEnd(() => {
      if (dragActive.value > 0.5) {
        dragActive.value = withSpring(0, SPRING_CONFIG);
        const snapX = orbX.value > SCREEN_WIDTH / 2 ? SCREEN_WIDTH - 72 : 12;
        orbX.value = withSpring(snapX, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    });

  // 🚀 NAVIGATE (Long Press + Vertical Swipe)
  const navGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      if (dragActive.value < 0.5) {
        expansion.value = withSpring(1, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    })
    .onUpdate((e) => {
      if (expansion.value > 0.1 && dragActive.value < 0.5) {
        // Calculate index based on the center of the menu
        const menuCenterY = 0; 
        const relativeY = e.translationY;
        const totalHalf = TOTAL_MENU_HEIGHT / 2;
        
        // Find which item we are on (-165 to 165 range for 6 items)
        const normalizedY = relativeY + totalHalf;
        const idx = Math.floor(normalizedY / ITEM_SIZE);
        
        const distToOrb = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
        const isTooFarHorizontal = Math.abs(e.translationX) > 120;
        const isTooFarVertical = normalizedY < -20 || normalizedY > TOTAL_MENU_HEIGHT + 20;

        if (isTooFarHorizontal || isTooFarVertical || distToOrb < 25) {
          if (activeIdx.value !== -1) {
            activeIdx.value = -1;
            runOnJS(updateUI)(-1);
          }
        } else {
          const clampedIdx = Math.max(0, Math.min(NAV_ITEMS.length - 1, idx));
          if (clampedIdx !== activeIdx.value) {
            activeIdx.value = clampedIdx;
            runOnJS(updateUI)(clampedIdx);
          }
        }
      }
    })
    .onEnd(() => {
      const finalIdx = activeIdx.value;
      // RESET INSTANTLY
      activeIdx.value = -1;
      expansion.value = withSpring(0, SPRING_CONFIG);
      runOnJS(updateUI)(-1);
      
      if (finalIdx !== -1 && dragActive.value < 0.5) {
        runOnJS(onNavigate)(finalIdx);
      }
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: orbX.value },
      { translateY: orbY.value },
      { scale: withSpring(dragActive.value ? 1.15 : 1, SPRING_CONFIG) }
    ],
    zIndex: 10000,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    height: withSpring(interpolate(expansion.value, [0, 1], [60, TOTAL_MENU_HEIGHT + 20]), SPRING_CONFIG),
    width: 60,
    borderRadius: 30,
    marginTop: withSpring(interpolate(expansion.value, [0, 1], [0, -TOTAL_MENU_HEIGHT / 2 + 20]), SPRING_CONFIG),
    backgroundColor: dragActive.value ? theme.tint + '30' : 'transparent',
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.container, containerStyle]}>
        <GestureDetector gesture={Gesture.Race(dragGesture, navGesture)}>
          <Animated.View style={pillStyle}>
            <BlurView intensity={100} tint={colorScheme} style={styles.blur}>
              
              {/* 💓 RESTING HEART */}
              <Animated.View style={[styles.heartIcon, useAnimatedStyle(() => ({
                opacity: withTiming(expansion.value > 0.2 ? 0 : 1),
                transform: [{ scale: withTiming(expansion.value > 0.2 ? 0 : 1) }]
              }))]}>
                <Heart size={26} color={theme.tint} fill={theme.tint} />
              </Animated.View>

              {/* 📋 MENU ICONS */}
              <Animated.View style={[styles.menu, useAnimatedStyle(() => ({
                opacity: withTiming(expansion.value > 0.3 ? 1 : 0),
              }))]}>
                {NAV_ITEMS.map((item, index) => {
                  const itemStyle = useAnimatedStyle(() => {
                    const isSelected = activeIdx.value === index;
                    return {
                      backgroundColor: isSelected ? item.color : 'transparent',
                      transform: [{ scale: withSpring(isSelected ? 1.25 : 1, SPRING_CONFIG) }],
                    };
                  });

                  return (
                    <View key={item.id} style={styles.itemWrapper}>
                      <Animated.View style={[styles.iconBox, itemStyle]}>
                        <item.icon 
                          size={22} 
                          color={useDerivedValue(() => activeIdx.value === index ? 'white' : theme.text).value} 
                        />
                      </Animated.View>

                      {/* 🏷️ LABELS (Rendered relative to orb edge) */}
                      <AnimatePresence>
                        {currentLabel === item.label && (
                          <MotiView 
                            from={{ opacity: 0, scale: 0.8, translateX: orbX.value < SCREEN_WIDTH / 2 ? -10 : 10 }}
                            animate={{ opacity: 1, scale: 1, translateX: 0 }}
                            exit={{ opacity: 0, scale: 0.8, translateX: orbX.value < SCREEN_WIDTH / 2 ? -10 : 10 }}
                            style={[
                              styles.labelPopup, 
                              { 
                                backgroundColor: theme.card,
                                left: orbX.value < SCREEN_WIDTH / 2 ? 70 : -130 
                              }
                            ]}
                          >
                            <Text style={[styles.labelText, { color: theme.text }]} numberOfLines={1}>{item.label}</Text>
                          </MotiView>
                        )}
                      </AnimatePresence>
                    </View>
                  );
                })}
              </Animated.View>

            </BlurView>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute' },
  blur: { flex: 1, borderRadius: 30, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(150,150,150,0.2)', justifyContent: 'center', alignItems: 'center' },
  heartIcon: { position: 'absolute', zIndex: 1 },
  menu: { flex: 1, justifyContent: 'center', width: '100%', gap: 4, zIndex: 2 },
  itemWrapper: { height: ITEM_SIZE, width: 60, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  iconBox: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  labelPopup: { position: 'absolute', width: 120, paddingHorizontal: 15, paddingVertical: 10, borderRadius: 15, elevation: 15, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, alignItems: 'center', justifyContent: 'center' },
  labelText: { fontSize: 13, fontWeight: '900', letterSpacing: 1.2 },
});
