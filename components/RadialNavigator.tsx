import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Pressable, DeviceEventEmitter } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  runOnJS, 
  useDerivedValue,
  interpolate,
  Extrapolate
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Home, BookHeart, Map, Wallet, Settings, X, Palette, Heart } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { AnimatePresence, MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DIAL_RADIUS = 110;
const ICON_SIZE = 24;

const NAV_ITEMS = [
  { id: 'index', path: '/', label: 'US', icon: Home, color: '#FF2D55' },
  { id: 'journal', path: '/journal', label: 'JOURNAL', icon: BookHeart, color: '#AF52DE' },
  { id: 'our-life', path: '/our-life', label: 'LIFE', icon: Map, color: '#34C759' },
  { id: 'finance', path: '/finance', label: 'FINANCE', icon: Wallet, color: '#FF9500' },
  { id: 'draw', path: '/draw', label: 'DRAW', icon: Palette, color: '#5856D6' },
  { id: 'settings', path: '/settings', label: 'SETTINGS', color: '#8E8E93', icon: Settings },
];

export default function RadialNavigator() {
  const router = useRouter();
  const pathname = usePathname();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [isInCancelZone, setIsInCancelZone] = useState(false);
  const [activeLabel, setActiveLabel] = useState('US');
  
  const rotation = useSharedValue(0);
  const activeIndex = useSharedValue(0);
  const lastHapticIndex = useRef(0);
  const startRotation = useSharedValue(0);

  const ANGLE_STEP = (2 * Math.PI) / NAV_ITEMS.length;

  useEffect(() => {
    const showSub = DeviceEventEmitter.addListener('show-navigator', () => setIsVisible(true));
    const hideSub = DeviceEventEmitter.addListener('hide-navigator', () => setIsVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    const idx = NAV_ITEMS.findIndex(item => item.path === pathname || (item.path === '/' && pathname === '/index'));
    if (idx !== -1) {
      const targetRot = -idx * ANGLE_STEP;
      rotation.value = targetRot;
      activeIndex.value = idx;
      setActiveLabel(NAV_ITEMS[idx].label);
    }
  }, [pathname]);

  const triggerHaptic = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActiveLabel(NAV_ITEMS[index].label);
  };

  const handleFinalNavigate = (idx: number) => {
    if (isInCancelZone) {
      setIsOpen(false);
      setIsInCancelZone(false);
      return;
    }
    const item = NAV_ITEMS[idx];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (pathname === item.path && item.id === 'our-life') {
      DeviceEventEmitter.emit('our-life-tab-press');
    } else {
      router.push(item.path);
    }
    setIsOpen(false);
  };

  useDerivedValue(() => {
    const rawIndex = -rotation.value / ANGLE_STEP;
    const normalizedIndex = ((Math.round(rawIndex) % NAV_ITEMS.length) + NAV_ITEMS.length) % NAV_ITEMS.length;
    
    if (normalizedIndex !== lastHapticIndex.current && isOpen && !isInCancelZone) {
      lastHapticIndex.current = normalizedIndex;
      runOnJS(triggerHaptic)(normalizedIndex);
    }
    activeIndex.value = normalizedIndex;
  });

  const gesture = Gesture.Pan()
    .onBegin(() => {
      runOnJS(setIsOpen)(true);
      runOnJS(setIsInCancelZone)(false);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
      startRotation.value = rotation.value;
    })
    .onUpdate((e) => {
      const dist = Math.sqrt(e.translationX ** 2 + e.translationY ** 2);
      const inZone = dist < 45;
      if (inZone !== isInCancelZone) {
        runOnJS(setIsInCancelZone)(inZone);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
      }

      if (!inZone) {
        const sensitivity = (SCREEN_WIDTH / 2.5) / (Math.PI);
        rotation.value = startRotation.value + (e.translationX / sensitivity);
      }
    })
    .onEnd(() => {
      const targetIndex = ((Math.round(-rotation.value / ANGLE_STEP) % NAV_ITEMS.length) + NAV_ITEMS.length) % NAV_ITEMS.length;
      rotation.value = withSpring(-targetIndex * ANGLE_STEP, { damping: 25, stiffness: 200 });
      runOnJS(handleFinalNavigate)(targetIndex);
    });

  const containerStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isOpen ? 1 : 0, { duration: 200 }),
    transform: [
      { scale: withSpring(isOpen ? 1 : 0.8) },
      { translateY: withSpring(isOpen ? 0 : 50) }
    ],
  }));

  const mainBtnStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(isOpen ? 1.2 : isVisible ? 1 : 0) }
    ],
    opacity: withTiming(isVisible || isOpen ? 1 : 0),
    backgroundColor: isOpen ? (isInCancelZone ? '#FF3B30' : '#333') : theme.tint,
    borderWidth: withTiming(isOpen ? 4 : 0),
    borderColor: withTiming(isOpen ? (isInCancelZone ? '#FF3B30' : theme.tint) : 'transparent'),
  }));

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <AnimatePresence>
        {isOpen && (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={styles.backdrop}
          />
        )}
      </AnimatePresence>

      <View style={[styles.centerAnchor, { bottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <Animated.View style={[styles.dialContainer, containerStyle]} pointerEvents="none">
          {NAV_ITEMS.map((item, index) => {
            const itemStyle = useAnimatedStyle(() => {
              const angle = rotation.value + index * ANGLE_STEP - Math.PI / 2;
              const x = Math.cos(angle) * DIAL_RADIUS;
              const y = Math.sin(angle) * DIAL_RADIUS;
              
              const isSelected = activeIndex.value === index && !isInCancelZone;
              const scale = isSelected ? 1.5 : 0.7;
              
              const opac = interpolate(
                Math.abs(activeIndex.value - index),
                [0, 1, 2],
                [1, 0.4, 0.1],
                Extrapolate.CLAMP
              );

              return {
                transform: [
                  { translateX: x },
                  { translateY: y },
                  { scale: withSpring(scale) }
                ],
                opacity: withTiming(isInCancelZone ? 0.2 : opac),
                backgroundColor: item.color,
              };
            });

            return (
              <Animated.View key={item.id} style={[styles.navItem, itemStyle]}>
                <item.icon size={ICON_SIZE} color="white" />
              </Animated.View>
            );
          })}

          <View style={styles.centerLabelContainer}>
            <AnimatePresence mode="wait">
              <MotiView 
                key={isInCancelZone ? 'cancel' : activeLabel}
                from={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'timing', duration: 150 }}
                style={styles.labelWrapper}
              >
                <Text style={[styles.label, { color: isInCancelZone ? '#FF3B30' : theme.text }]}>
                  {isInCancelZone ? 'CANCEL' : activeLabel}
                </Text>
              </MotiView>
            </AnimatePresence>
          </View>
        </Animated.View>

        <GestureDetector gesture={gesture}>
          <View style={styles.mainBtnWrapper}>
            <Animated.View style={[styles.mainBtn, mainBtnStyle]}>
              {isInCancelZone ? <X size={28} color="white" /> : <Heart size={28} color="white" fill={isOpen ? "transparent" : "white"} />}
            </Animated.View>
          </View>
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', bottom: 0, left: 0, right: 0, height: SCREEN_HEIGHT, zIndex: 9999 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  centerAnchor: { position: 'absolute', left: SCREEN_WIDTH / 2 - 35, width: 70, height: 70, alignItems: 'center', justifyContent: 'center' },
  dialContainer: { position: 'absolute', bottom: 0, width: 300, height: 300, alignItems: 'center', justifyContent: 'center' },
  navItem: { position: 'absolute', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8 },
  centerLabelContainer: { position: 'absolute', top: 130, height: 40, width: '100%', justifyContent: 'center', alignItems: 'center', zIndex: 0 },
  labelWrapper: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '900', letterSpacing: 4, textShadowColor: 'rgba(0,0,0,0.2)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3, textAlign: 'center' },
  mainBtnWrapper: { width: 70, height: 70, borderRadius: 35, justifyContent: 'center', alignItems: 'center' },
  mainBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 15, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12 },
});
