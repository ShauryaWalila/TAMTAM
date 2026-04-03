import React from 'react';
import { StyleSheet, View, Text, ScrollView, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import TamtamOrb from '@/components/TamtamOrb';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

export default function TestDockScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* 🔮 THE NEW GESTURAL ORB */}
      <TamtamOrb />

      <ScrollView contentContainerStyle={{ padding: 25, paddingTop: insets.top + 20 }}>
        <Text style={[styles.title, { color: theme.text }]}>Gestural Orb</Text>
        
        <View style={styles.instructionCard}>
          <Text style={[styles.instructionTitle, { color: theme.tint }]}>How to use:</Text>
          <Text style={[styles.instructionText, { color: theme.text }]}>
            1. <Text style={{fontWeight: '900'}}>Navigate</Text>: Hold the Heart and <Text style={{fontWeight: '900'}}>Swipe UP/DOWN</Text>. Labels will slide out!
          </Text>
          <Text style={[styles.instructionText, { color: theme.text, marginTop: 10 }]}>
            2. <Text style={{fontWeight: '900'}}>Move Menu</Text>: Double-Tap the Heart and <Text style={{fontWeight: '900'}}>Hold/Drag</Text> to relocate it. It snaps to edges!
          </Text>
        </View>

        <View style={styles.sampleContent}>
          <View style={[styles.box, { backgroundColor: theme.card }]} />
          <View style={[styles.box, { backgroundColor: theme.card }]} />
          <View style={[styles.box, { backgroundColor: theme.card }]} />
          <View style={[styles.box, { backgroundColor: theme.card }]} />
          <View style={[styles.box, { backgroundColor: theme.card }]} />
        </View>

        <View style={styles.mockFab}>
          <LinearGradient colors={[theme.tint, theme.secondary]} style={styles.fabGradient}>
            <Text style={styles.fabText}>SEND</Text>
          </LinearGradient>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 32, fontWeight: '900', marginBottom: 20, marginLeft: 10 },
  instructionCard: { padding: 20, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.1)', marginBottom: 30 },
  instructionTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  instructionText: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  sampleContent: { gap: 20 },
  box: { width: '100%', height: 150, borderRadius: 24 },
  mockFab: { position: 'absolute', bottom: 40, right: 20, elevation: 10 },
  fabGradient: { paddingHorizontal: 30, paddingVertical: 15, borderRadius: 30 },
  fabText: { color: 'white', fontWeight: '900', fontSize: 16 }
});
