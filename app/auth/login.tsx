import React, { useState } from 'react';
import { StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, Alert, View, Dimensions } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Heart, Sparkles, ArrowRight } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { initialFullSync } from '@/lib/syncEngine';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [name, setName] = useState('');
  const router = useRouter();

  const handleLogin = async () => {
    if (!name.trim()) {
      Alert.alert('Wait!', 'Please enter your name to enter our world ❤️');
      return;
    }

    const lowerName = name.trim().toLowerCase();
    // Logic for our shared world
    if (lowerName === 'pratishth' || lowerName === 'love' || lowerName === 'supriya') { 
      try {
        // Standardize Supriya to 'love' for database consistency
        const userId = lowerName === 'supriya' ? 'love' : lowerName;
        await SecureStore.setItemAsync('user_name', userId);
        
        // Trigger initial sync and clear old data
        initialFullSync(true);
        
        router.replace('/(tabs)');
      } catch (e) {
        Alert.alert('Error', 'Something went wrong while saving your session.');
      }
    } else {
      Alert.alert('Access Denied', 'This app is only for the two of us! Check your name spelling.');
    }
  };

  return (
    <ThemedView style={{ flex: 1 }}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <MotiView 
          from={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 1500 }}
          style={styles.header}
        >
          {/* ✨ STATIC HEART REPLACEMENT */}
          <View style={styles.heartIconWrapper}>
            <Heart size={80} color={theme.tint} fill={theme.tint} />
          </View>
          
          <Text style={[styles.title, { color: theme.text }]}>TAMTAM</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Our Private Space</Text>
        </MotiView>

        <MotiView 
          from={{ opacity: 0, translateY: 50 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ delay: 500 }}
          style={styles.inputSection}
        >
          <View style={[styles.inputContainer, { backgroundColor: theme.card }]}>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              placeholder="What is your name?"
              placeholderTextColor={theme.tabIconDefault}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>

          <Pressable onPress={handleLogin} style={styles.buttonWrapper}>
            <LinearGradient
              colors={[theme.tint, theme.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.button}
            >
              <Text style={styles.buttonText}>Enter Our World!</Text>
              <ArrowRight color="#FFF" size={20} />
            </LinearGradient>
          </Pressable>
        </MotiView>

        <View style={styles.footer}>
          <View style={[styles.footerLine, { backgroundColor: theme.tabIconDefault }]} />
          <View style={styles.footerContent}>
            <Heart color={theme.tint} size={16} fill={theme.tint} />
            <Text style={[styles.footerText, { color: theme.tabIconDefault }]}>Just the two of us</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  heartIconWrapper: {
    marginBottom: 20,
    // Add a soft glow effect
    shadowColor: '#FF2D55',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
  },
  title: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -2,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  inputSection: {
    width: '100%',
  },
  inputContainer: {
    height: 64,
    borderRadius: 20,
    paddingHorizontal: 20,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: 20,
  },
  input: {
    fontSize: 18,
    fontWeight: '600',
  },
  buttonWrapper: {
    shadowColor: '#AF52DE',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 8,
  },
  button: {
    height: 64,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  footer: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerLine: {
    width: 100,
    height: 1,
    opacity: 0.2,
    marginBottom: 15,
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
