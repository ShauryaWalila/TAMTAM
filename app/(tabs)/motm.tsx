import React, { useState, useEffect } from 'react';
import { StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, View, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { MessageSquarePlus, Heart, Sparkles, Send, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { processSyncQueue } from '@/lib/syncEngine';
import { useRouter } from 'expo-router';
import ConfettiCannon from 'react-native-confetti-cannon';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function MOTMScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      const name = await SecureStore.getItemAsync('user_name');
      setCurrentUserName(name);
      if (name) {
        fetchCurrentMoment(name);
      }
    };
    init();
  }, []);

  const fetchCurrentMoment = async (name: string) => {
    const userId = name.toLowerCase();
    const momentId = userId === 'pratishth' ? 'de305d54-75b4-431b-adb2-eb6b9e546013' : 'ce305d54-75b4-431b-adb2-eb6b9e546014';
    
    try {
      // 1. Load from local first
      const data = db.getFirstSync(`SELECT message FROM moments WHERE id = ?`, [momentId]) as any;
      if (data) {
        setMessage(data.message);
      }

      // 2. Fetch from remote to update cache
      const { data: remoteData } = await supabase
        .from('moments')
        .select('message')
        .eq('id', momentId)
        .maybeSingle();
      
      if (remoteData) {
        setMessage(remoteData.message);
        db.runSync(`INSERT OR REPLACE INTO moments (id, created_at, message, user_id) VALUES (?, ?, ?, ?)`, 
          [momentId, new Date().toISOString(), remoteData.message, userId]);
      }
    } catch (e) {}
  };

  const handleSendMoment = async () => {
    if (!message.trim() || !currentUserName) return;

    setLoading(true);
    const userId = currentUserName.toLowerCase();
    const id = userId === 'pratishth' ? 'de305d54-75b4-431b-adb2-eb6b9e546013' : 'ce305d54-75b4-431b-adb2-eb6b9e546014';
    
    const payload = { 
      id,
      message: message.trim(), 
      user_id: userId,
      created_at: new Date().toISOString()
    };

    try {
      // 1. Save to local SQLite (Replace existing)
      db.runSync(`INSERT OR REPLACE INTO moments (id, created_at, message, user_id) VALUES (?, ?, ?, ?)`, 
        [payload.id, payload.created_at, payload.message, payload.user_id]);
      
      // 2. Queue for Sync Engine
      queueSyncOperation('moments', payload.id, 'INSERT', payload);
      processSyncQueue();

      // 3. Emit refresh
      DeviceEventEmitter.emit('refresh-dashboard');

      setShowConfetti(true);
      setTimeout(() => {
        setShowConfetti(false);
        router.replace('/(tabs)/settings');
      }, 3000);
      
    } catch (error: any) {
      console.warn('MOTM save error', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={{ flex: 1, paddingTop: insets.top }}>
      <TouchableOpacity 
        onPress={() => router.replace('/(tabs)/settings')} 
        style={[styles.closeButton, { backgroundColor: theme.card, top: insets.top + 10 }]}
      >
        <X color={theme.text} size={24} />
      </TouchableOpacity>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.content}>
          <MotiView 
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            style={styles.header}
          >
            <View style={[styles.iconCircle, { backgroundColor: theme.tint + '20' }]}>
              <MessageSquarePlus color={theme.tint} size={32} />
            </View>
            <Text style={[styles.title, { color: theme.text }]}>Message of the Moment</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Share a thought that stays on our home screen</Text>
          </MotiView>

          <View style={styles.section}>
            <View style={[styles.inputCard, { backgroundColor: theme.card }]}>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="What's on your mind?..."
                placeholderTextColor={theme.tabIconDefault}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={150}
              />
              <View style={styles.inputFooter}>
                <Text style={[styles.charCount, { color: theme.tabIconDefault }]}>{message.length}/150</Text>
                <Pressable 
                  onPress={handleSendMoment}
                  disabled={loading || !message.trim()}
                  style={[
                    styles.sendButton, 
                    { backgroundColor: theme.tint, opacity: (loading || !message.trim()) ? 0.6 : 1 }
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Text style={styles.sendButtonText}>Update Moment</Text>
                      <Send color="#FFF" size={18} />
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.moreSection}>
            <Text style={[styles.moreTitle, { color: theme.tabIconDefault }]}>Coming Soon</Text>
            <View style={styles.grid}>
              <View style={[styles.gridItem, { backgroundColor: theme.card, opacity: 0.5 }]}>
                <Heart color={theme.tabIconDefault} size={24} />
                <Text style={[styles.gridText, { color: theme.tabIconDefault }]}>Daily Prompt</Text>
              </View>
              <View style={[styles.gridItem, { backgroundColor: theme.card, opacity: 0.5 }]}>
                <Sparkles color={theme.tabIconDefault} size={24} />
                <Text style={[styles.gridText, { color: theme.tabIconDefault }]}>Secret Gift</Text>
              </View>
            </View>
          </View>
        </View>

        {showConfetti && (
          <ConfettiCannon
            count={200}
            origin={{ x: -10, y: 0 }}
            fadeOut={true}
            fallSpeed={3000}
          />
        )}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginVertical: 32,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  section: {
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  inputCard: {
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  input: {
    fontSize: 18,
    fontWeight: '500',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    paddingTop: 16,
  },
  charCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 16,
    gap: 10,
  },
  sendButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
  },
  moreSection: {
    marginTop: 40,
  },
  moreTitle: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
    marginLeft: 4,
  },
  grid: {
    flexDirection: 'row',
    gap: 16,
  },
  gridItem: {
    flex: 1,
    height: 100,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  gridText: {
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
