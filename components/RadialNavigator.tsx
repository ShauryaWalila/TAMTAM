import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Home, BookHeart, Map, Wallet, Heart, Settings, Coffee, PenTool, BrainCircuit, Utensils } from 'lucide-react-native';
import { StyleSheet, View, Text, Dimensions, DeviceEventEmitter, TouchableOpacity } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  runOnJS, 
  interpolate,
  withTiming,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';


const NAV_ITEMS = [
  { id: 'index', path: '/', label: 'US', icon: Home, color: '#FF2D55' },
  { id: 'journal', path: '/journal', label: 'JOURNAL', icon: BookHeart, color: '#AF52DE' },
  { id: 'study-hub', path: '/study-hub', label: 'STUDY', icon: BrainCircuit, color: '#5856D6' },
  { id: 'draw', path: '/draw', label: 'DRAW', icon: PenTool, color: '#FF9500' },
  { id: 'our-life', path: '/our-life', label: 'LIFE', icon: Map, color: '#34C759' },
  { id: 'diet', path: '/diet', label: 'DIET', icon: Utensils, color: '#FF2D55' },
  { id: 'finance', path: '/finance', label: 'FINANCE', icon: Wallet, color: '#FF9500' },
  { id: 'wishlist', path: '/wishlist', label: 'WISH', icon: Heart, color: '#5856D6' },
  { id: 'chill-zone', path: '/chill-zone', label: 'CHILL', icon: Coffee, color: '#5AC8FA' },
  { id: 'settings', path: '/settings', label: 'SETTINGS', icon: Settings, color: '#8E8E93' },
];

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ITEM_HEIGHT = 65; 
const MENU_PADDING = 20;
const MENU_HEIGHT = NAV_ITEMS.length * ITEM_HEIGHT + (MENU_PADDING * 2);
const SPRING_CONFIG = { damping: 20, stiffness: 150, mass: 0.5 };

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
  const [activeJSIdx, setActiveJSIdx] = useState(-1);

  const handleIndexChange = (idx: number) => {
    if (idx !== activeJSIdx) {
      setActiveJSIdx(idx);
      if (idx === -1) {
        setCurrentLabel('');
      } else {
        setCurrentLabel(NAV_ITEMS[idx].label);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  };

  const onFinalNavigate = (idx: number) => {
    if (idx === -1) return;
    const item = NAV_ITEMS[idx];
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push(item.path);
  };

  // 🖱️ MOVE
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
    .activateAfterLongPress(200)
    .onStart(() => {
      if (isDragging.value < 0.5) {
        expansion.value = withSpring(1, SPRING_CONFIG);
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      }
    })
    .onUpdate((e) => {
      if (expansion.value > 0.5 && isDragging.value < 0.5) {
        // Gesture translation is relative to the pill center. When expanded
        // the pill spans from -MENU_HEIGHT/2 to +MENU_HEIGHT/2 around that
        // center. Items sit inside MENU_PADDING margin.
        const menuLocalY = e.translationY + (MENU_HEIGHT / 2) - MENU_PADDING;
        const itemsHeight = NAV_ITEMS.length * ITEM_HEIGHT;

        // Hit-test: pointer must be within pill X-bounds AND within items'
        // Y-bounds. Outside either => not selecting (idx = -1).
        const PILL_HALF_WIDTH = 40; // 60px pill + 20px tolerance
        const insideX = Math.abs(e.translationX) <= PILL_HALF_WIDTH;
        const insideY = menuLocalY >= 0 && menuLocalY < itemsHeight;

        let nextIdx = -1;
        if (insideX && insideY) {
          nextIdx = Math.floor(menuLocalY / ITEM_HEIGHT);
          if (nextIdx < 0) nextIdx = 0;
          if (nextIdx >= NAV_ITEMS.length) nextIdx = NAV_ITEMS.length - 1;
        }

        if (nextIdx !== activeIdx.value) {
          activeIdx.value = nextIdx;
          runOnJS(handleIndexChange)(nextIdx);
        }
      }
    })
    .onEnd(() => {
      const finalIdx = activeIdx.value;
      activeIdx.value = -1;
      expansion.value = withSpring(0, SPRING_CONFIG);
      runOnJS(handleIndexChange)(-1);
      
      if (finalIdx !== -1 && isDragging.value < 0.5) {
        runOnJS(onFinalNavigate)(finalIdx);
      }
    });

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
    zIndex: 99999,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    height: withSpring(interpolate(expansion.value, [0, 1], [60, MENU_HEIGHT]), SPRING_CONFIG),
    width: 60,
    borderRadius: 30,
    marginTop: withSpring(interpolate(expansion.value, [0, 1], [0, -MENU_HEIGHT / 2 + 30]), SPRING_CONFIG),
  }));

  const labelContainerStyle = useAnimatedStyle(() => {
    const isLeft = posX.value < SCREEN_WIDTH / 2;
    const labelX = isLeft ? 75 : -115;
    
    const menuTopY = -MENU_HEIGHT / 2 + 30;
    const targetY = menuTopY + MENU_PADDING + (activeIdx.value * ITEM_HEIGHT) + (ITEM_HEIGHT / 2) - 25;
    
    return {
      opacity: withTiming(activeIdx.value === -1 ? 0 : 1, { duration: 100 }),
      transform: [
        { translateX: labelX }, 
        { translateY: withSpring(activeIdx.value === -1 ? 0 : targetY, SPRING_CONFIG) },
        { scale: withSpring(activeIdx.value === -1 ? 0.8 : 1) }
      ],
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.mainContainer, animatedContainerStyle]} pointerEvents="box-none">
        
        {/* 🏷️ THE FLOATING LABEL */}
        <Animated.View style={[styles.labelOverlay, labelContainerStyle, { backgroundColor: theme.card }]}>
          <Text style={[styles.labelText, { color: theme.text }]}>{currentLabel}</Text>
        </Animated.View>

        <GestureDetector gesture={Gesture.Race(dragGesture, navGesture)}>
          <Animated.View style={pillStyle}>
            <BlurView intensity={100} tint={colorScheme} style={styles.glass}>
              
              {/* 📋 MENU LIST (Hidden when closed) */}
              <Animated.View 
                style={[styles.menuList, useAnimatedStyle(() => ({
                  opacity: expansion.value < 0.2 ? 0 : withTiming(1, { duration: 150 }),
                }))]}
              >
                {NAV_ITEMS.map((item, index) => {
                  const itemColor = item.color;
                  const itemIconStyle = useAnimatedStyle(() => {
                    const isSelected = activeIdx.value === index;
                    return {
                      backgroundColor: isSelected ? itemColor : 'rgba(0,0,0,0)',
                      transform: [{ scale: withSpring(isSelected ? 1.3 : 1, SPRING_CONFIG) }],
                    };
                  });

                  return (
                    <View key={item.id} style={styles.itemWrapper}>
                      <Animated.View style={[styles.iconCircle, itemIconStyle]}>
                        <item.icon 
                          size={24} 
                          color={activeJSIdx === index ? 'white' : theme.text} 
                        />
                      </Animated.View>
                    </View>
                  );
                })}
              </Animated.View>

              {/* 💓 RESTING HEART (Top layer) */}
              <Animated.View 
                style={[styles.centerIcon, useAnimatedStyle(() => ({
                  opacity: withTiming(expansion.value > 0.2 ? 0 : 1),
                  transform: [{ scale: withTiming(expansion.value > 0.2 ? 0.5 : 1) }]
                }))]}
              >
                <Heart size={28} color={theme.tint} fill={theme.tint} />
              </Animated.View>

            </BlurView>
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { position: 'absolute', width: 60, height: 60 },
  glass: { flex: 1, borderRadius: 30, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(150,150,150,0.2)', justifyContent: 'center', alignItems: 'center' },
  centerIcon: { position: 'absolute', zIndex: 100 },
  menuList: { flex: 1, justifyContent: 'center', width: '100%', zIndex: 50, paddingVertical: MENU_PADDING },
  itemWrapper: { height: ITEM_HEIGHT, width: 60, justifyContent: 'center', alignItems: 'center' },
  iconCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  labelOverlay: { position: 'absolute', width: 100, paddingVertical: 10, borderRadius: 12, elevation: 20, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)', zIndex: 100000 },
  labelText: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
});
