import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Rocket, Heart, Zap } from 'lucide-react-native';

export default function ModalScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Rocket color={theme.tint} size={48} style={styles.icon} />
        <Text style={[styles.title, { color: theme.text }]}>TAMTAM</Text>
        <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Productivity at its peak</Text>
        
        <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
        
        <View style={styles.feature}>
          <Zap color={theme.secondary} size={24} />
          <Text style={[styles.featureText, { color: theme.text }]}>Fast & Responsive</Text>
        </View>
        <View style={styles.feature}>
          <Heart color={theme.tint} size={24} />
          <Text style={[styles.featureText, { color: theme.text }]}>Modern & Vibrant Design</Text>
        </View>

        <Text style={[styles.description, { color: theme.tabIconDefault }]}>
          TAMTAM is built with the latest React Native and Expo technologies to give you the best experience in tracking your goals.
        </Text>
      </View>

      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    padding: 30,
    borderRadius: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  icon: {
    marginBottom: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '100%',
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
    gap: 12,
  },
  featureText: {
    fontSize: 18,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
});
