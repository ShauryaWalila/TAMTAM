import React from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { Home, BookHeart, Map, Wallet, Heart, Settings, Sparkles } from 'lucide-react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const DOCK_ITEMS = [
  { id: 'index', label: 'US', icon: Home, color: '#FF2D55' },
  { id: 'journal', label: 'JOURNAL', icon: BookHeart, color: '#AF52DE' },
  { id: 'our-life', label: 'LIFE', icon: Map, color: '#34C759' },
  { id: 'finance', label: 'FINANCE', icon: Wallet, color: '#FF9500' },
  { id: 'wishlist', label: 'WISH', icon: Heart, color: '#5856D6' },
  { id: 'settings', label: 'SETTINGS', icon: Settings, color: '#8E8E93' },
];

export default function SideDockPreview() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const handlePress = (label: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    console.log(`Navigate to: ${label}`);
  };

  return (
    <MotiView 
      from={{ opacity: 0, translateX: -50 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'spring', damping: 20, delay: 500 }}
      style={styles.container}
    >
      <BlurView intensity={80} tint={colorScheme} style={styles.dock}>
        <View style={styles.topIndicator}>
          <Sparkles size={12} color={theme.tint} />
        </View>
        
        {DOCK_ITEMS.map((item) => (
          <TouchableOpacity 
            key={item.id} 
            onPress={() => handlePress(item.label)}
            activeOpacity={0.7}
            style={styles.dockItem}
          >
            <item.icon size={22} color={theme.text} />
            <View style={[styles.activeDot, { backgroundColor: item.color, opacity: item.id === 'index' ? 1 : 0 }]} />
          </TouchableOpacity>
        ))}

        <View style={styles.bottomHandle} />
      </BlurView>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    top: (SCREEN_HEIGHT / 2) - 180, // Centered vertically
    zIndex: 9999,
  },
  dock: {
    paddingVertical: 20,
    paddingHorizontal: 8,
    borderRadius: 30,
    alignItems: 'center',
    gap: 15,
    borderWidth: 1,
    borderColor: 'rgba(150,150,150,0.1)',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  dockItem: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  activeDot: {
    position: 'absolute',
    right: -4,
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  topIndicator: {
    marginBottom: 5,
    opacity: 0.5,
  },
  bottomHandle: {
    width: 15,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.2)',
    marginTop: 5,
  }
});
