import React, { useState, useCallback, useRef } from 'react';
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
import { Home, BookHeart, Map, Wallet, Heart, Settings, Coffee } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { MotiView, AnimatePresence } from 'moti';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const NAV_ITEMS = [
  { id: 'index', path: '/', label: 'US', icon: Home, color: '#FF2D55' },
  { id: 'journal', path: '/journal', label: 'JOURNAL', icon: BookHeart, color: '#AF52DE' },
  { id: 'our-life', path: '/our-life', label: 'LIFE', icon: Map, color: '#34C759' },
  { id: 'finance', path: '/finance', label: 'FINANCE', icon: Wallet, color: '#FF9500' },
  { id: 'wishlist', path: '/wishlist', label: 'WISH', icon: Heart, color: '#5856D6' },
  { id: 'chill-zone', path: '/chill-zone', label: 'CHILL', icon: Coffee, color: '#5AC8FA' },
  { id: 'settings', path: '/settings', label: 'SETTINGS', icon: Settings, color: '#8E8E93' },
];

const ITEM_HEIGHT = 60;
const MENU_HEIGHT = NAV_ITEMS.length * ITEM_HEIGHT;
const SPRING_CONFIG = { damping: 18, stiffness: 120, mass: 0.8 };

export default function RadialNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  // 📍 POSITIONING
  const posX = useSharedValue(15);
  const posY = useSharedValue(SCREEN_HEIGHT / 2 - 30);
  
  // 🎢 STATE
  const expansion = useSharedValue(0);
  const activeIdx = useSharedValue(-1);
  const isDragging = useSharedValue(0);
  const lastTap = useSharedValue(0);
  
  const [currentLabel, setCurrentLabel] = useState('');

  // ⚡ JS UPDATE
  const updateLabel = (idx: number) => {
    if (idx === -1) {
      setCurrentLabel('');
    } else {
      setCurrentLabel(NAV_ITEMS[idx].label);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
  };

  const onFinalNavigate = (idx: number) => {
    if (idx === -1) return;
    const item = NAV_ITEMS[idx];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (pathname === item.path && item.id === 'our-life') DeviceEventEmitter.emit('our-life-tab-press');
    else router.push(item.path);
  };

  // 🖱️ MOVE (Double Tap + Hold)
  const dragGesture = Gesture.Pan()
    .onBegin(() => {
      const now = Date.now();
      if (now - lastTap.value < 350) {
        isDragging.value = withSpring(1, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      }
      lastTap.value = now;
    })
    .onUpdate((e) => {
      if (isDragging.value > 0.5) {
        posX.value = e.absoluteX - 30;
        posY.value = e.absoluteY - 30;
      }
    })
    .onEnd(() => {
      if (isDragging.value > 0.5) {
        isDragging.value = withSpring(0, SPRING_CONFIG);
        const snapX = posX.value > SCREEN_WIDTH / 2 ? SCREEN_WIDTH - 75 : 15;
        posX.value = withSpring(snapX, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    });

  // 🚀 NAVIGATE
  const navGesture = Gesture.Pan()
    .activateAfterLongPress(250)
    .onStart(() => {
      if (isDragging.value < 0.5) {
        expansion.value = withSpring(1, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      }
    })
    .onUpdate((e) => {
      if (expansion.value > 0.5 && isDragging.value < 0.5) {
        const menuTop = -MENU_HEIGHT / 2 + 30;
        const normalizedY = e.translationY - menuTop;
        const rawIdx = Math.floor(normalizedY / ITEM_HEIGHT);
        
        const distToOrb = Math.sqrt(e.translationX**2 + e.translationY**2);
        const isFarX = Math.abs(e.translationX) > 120;
        const isOutOfBoundsY = normalizedY < -40 || normalizedY > MENU_HEIGHT + 40;

        if (isFarX || isOutOfBoundsY || distToOrb < 25) {
          if (activeIdx.value !== -1) {
            activeIdx.value = -1;
            runOnJS(updateLabel)(-1);
          }
        } else {
          const idx = Math.max(0, Math.min(NAV_ITEMS.length - 1, rawIdx));
          if (idx !== activeIdx.value) {
            activeIdx.value = idx;
            runOnJS(updateLabel)(idx);
          }
        }
      }
    })
    .onEnd(() => {
      const finalIdx = activeIdx.value;
      activeIdx.value = -1;
      expansion.value = withSpring(0, SPRING_CONFIG);
      runOnJS(updateLabel)(-1);
      
      if (finalIdx !== -1 && isDragging.value < 0.5) {
        runOnJS(onFinalNavigate)(finalIdx);
      }
    });

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value },
      { translateY: posY.value },
      { scale: withSpring(isDragging.value ? 1.15 : 1, SPRING_CONFIG) }
    ],
    zIndex: 99999,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    height: withSpring(interpolate(expansion.value, [0, 1], [60, MENU_HEIGHT + 20]), SPRING_CONFIG),
    width: 60,
    borderRadius: 30,
    marginTop: withSpring(interpolate(expansion.value, [0, 1], [0, -MENU_HEIGHT / 2 + 30]), SPRING_CONFIG),
    backgroundColor: isDragging.value ? theme.tint + '30' : 'transparent',
  }));

  const labelContainerStyle = useAnimatedStyle(() => {
    const isLeft = posX.value < SCREEN_WIDTH / 2;
    const labelOffset = 100; 
    const targetY = interpolate(activeIdx.value, [-1, 0, NAV_ITEMS.length - 1], [0, -MENU_HEIGHT / 2 + ITEM_HEIGHT / 2 - 45, MENU_HEIGHT / 2 - ITEM_HEIGHT / 2 - 75]);
    
    return {
      opacity: withTiming(activeIdx.value === -1 ? 0 : 1, { duration: 100 }),
      transform: [
        { translateX: isLeft ? labelOffset : -labelOffset }, 
        { translateY: withSpring(targetY, SPRING_CONFIG) },
        { scale: withSpring(activeIdx.value === -1 ? 0.8 : 1) }
      ],
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.mainContainer, animatedContainerStyle]}>
        
        {/* 🏷️ THE FLOATING LABEL */}
        <Animated.View style={[styles.labelOverlay, labelContainerStyle, { backgroundColor: theme.card }]}>
          <Text style={[styles.labelText, { color: theme.text }]}>{currentLabel}</Text>
        </Animated.View>

        <GestureDetector gesture={Gesture.Race(dragGesture, navGesture)}>
          <Animated.View style={pillStyle}>
            <BlurView intensity={100} tint={colorScheme} style={styles.glass}>
              
              {/* 💓 RESTING HEART */}
              <Animated.View style={[styles.centerIcon, useAnimatedStyle(() => ({
                opacity: withTiming(expansion.value > 0.2 ? 0 : 1),
                transform: [{ scale: withTiming(expansion.value > 0.2 ? 0 : 1) }]
              }))]}>
                <Heart size={28} color={theme.tint} fill={theme.tint} />
              </Animated.View>

              {/* 📋 MENU LIST */}
              <Animated.View style={[styles.menuList, useAnimatedStyle(() => ({
                opacity: withTiming(expansion.value > 0.2 ? 1 : 0),
              }))]}>
                {NAV_ITEMS.map((item, index) => {
                  const iconStyle = useAnimatedStyle(() => {
                    const isSelected = activeIdx.value === index;
                    return {
                      backgroundColor: isSelected ? item.color : 'transparent',
                      transform: [{ scale: withSpring(isSelected ? 1.25 : 1, SPRING_CONFIG) }],
                    };
                  });

                  return (
                    <View key={item.id} style={styles.itemWrapper}>
                      <Animated.View style={[styles.iconCircle, iconStyle]}>
                        <item.icon 
                          size={24} 
                          color={useDerivedValue(() => activeIdx.value === index ? 'white' : theme.text).value} 
                        />
                      </Animated.View>
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
  mainContainer: { position: 'absolute', justifyContent: 'center', alignItems: 'center' },
  glass: { flex: 1, borderRadius: 30, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(150,150,150,0.2)', justifyContent: 'center', alignItems: 'center' },
  centerIcon: { position: 'absolute', zIndex: 1 },
  menuList: { flex: 1, justifyContent: 'center', width: '100%', gap: 5, zIndex: 2 },
  itemWrapper: { height: ITEM_HEIGHT, width: 60, justifyContent: 'center', alignItems: 'center' },
  iconCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  labelOverlay: { position: 'absolute', width: 120, paddingVertical: 12, borderRadius: 18, elevation: 20, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)', zIndex: 100000 },
  labelText: { fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
});
