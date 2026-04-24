import React, { useState } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { Text } from '@/components/Themed';
import * as Haptics from 'expo-haptics';

/**
 * 🖐️ WORKING MULTI-TOUCH DETECTION LOGIC (BACKUP)
 * This logic was verified to correctly detect 'whole hand' interaction 
 * and multiple fingers simultaneously in Expo Go.
 */

export default function MultiTouchBackup() {
  const [touches, setTouches] = useState<any[]>([]);

  const handleTouchUpdate = (event: any) => {
    const nativeTouches = event.nativeEvent.touches;
    const points = [];
    for (let i = 0; i < nativeTouches.length; i++) {
      const t = nativeTouches[i];
      points.push({
        x: t.locationX,
        y: t.locationY,
        id: t.identifier
      });
    }
    setTouches(points);
    
    // Trigger haptic on every new finger landing
    if (points.length > touches.length) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const clearTouches = () => {
    setTouches([]);
  };

  return (
    <View 
      style={styles.container} 
      onTouchStart={handleTouchUpdate}
      onTouchMove={handleTouchUpdate}
      onTouchEnd={handleTouchUpdate}
      onTouchCancel={clearTouches}
    >
      <View style={styles.centerInfo} pointerEvents="none">
        <Text style={styles.hugeText}>{touches.length}</Text>
        <Text style={styles.subText}>FINGERS DETECTED</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  centerInfo: { alignItems: 'center' },
  hugeText: { fontSize: 120, fontWeight: '900', color: '#000' },
  subText: { fontSize: 18, fontWeight: '800', color: '#8E8E93' },
});
