import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions, DeviceEventEmitter, Alert } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Send, Sparkles, BrainCircuit, Microscope, Lightbulb, RefreshCcw, User, Bot } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { askAIStudyBuddy, processInboxWithAI } from '@/lib/aiEngine';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'system';
  timestamp: Date;
}

export default function AIStudyBuddyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: "Hello Doc! I'm your AI Study Buddy. Ready to crush some MBBS topics today? 🩺", sender: 'ai', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    SecureStore.getItemAsync('user_name').then(name => {
      const uname = name?.toLowerCase() || '';
      setCurrentUser(uname);
      // 🔥 PROACTIVE ORGANIZER: Auto-process inbox on entry
      autoSyncInbox(uname);
    });
  }, []);

  const autoSyncInbox = async (user: string) => {
    const success = await processInboxWithAI(user);
    if (success) {
      const msg: Message = { 
        id: 'sync-' + Date.now(), 
        text: "I've just organized your Brain Dump into your Decks and Syllabus! 🧠✨", 
        sender: 'ai', 
        timestamp: new Date() 
      };
      setMessages(prev => [...prev, msg]);
      // Notify other screens to refresh data
      DeviceEventEmitter.emit('DATA_REFRESH');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), text: textToSend, sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const response = await askAIStudyBuddy(textToSend, currentUser);
    
    const aiMsg: Message = { id: (Date.now() + 1).toString(), text: response, sender: 'ai', timestamp: new Date() };
    setMessages(prev => [...prev, aiMsg]);
    setLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const manualSync = async () => {
    setLoading(true);
    await autoSyncInbox(currentUser);
    setLoading(false);
  };

  const QUICK_ACTIONS = [
    { label: 'Mnemonic', icon: <Lightbulb size={16} color="#AF52DE" />, prompt: "Generate a funny mnemonic for the topics I'm currently studying." },
    { label: 'Quiz Me', icon: <Microscope size={16} color="#FF9500" />, prompt: "Give me a high-yield clinical vignette based on my syllabus progress." },
    { label: 'ELIS', icon: <BrainCircuit size={16} color="#34C759" />, prompt: "Explain the most difficult part of my current syllabus like I'm 5." },
  ];

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>Study Buddy</Text>
          <View style={styles.statusRow}><View style={styles.onlineDot} /><Text style={styles.subtitle}>Autonomous Organizer Active</Text></View>
        </View>
        <TouchableOpacity onPress={manualSync} disabled={loading} style={[styles.syncBtn, { backgroundColor: theme.tint + '15' }]}>
          {loading ? <ActivityIndicator size="small" color={theme.tint} /> : <RefreshCcw size={20} color={theme.tint} />}
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {messages.map((msg) => (
          <MotiView key={msg.id} from={{ opacity: 0, translateY: 10, scale: 0.95 }} animate={{ opacity: 1, translateY: 0, scale: 1 }} style={[styles.msgWrapper, msg.sender === 'user' ? styles.userWrapper : styles.aiWrapper]}>
            <View style={[styles.avatar, { backgroundColor: msg.sender === 'user' ? theme.tint : '#AF52DE' }]}>
              {msg.sender === 'user' ? <User size={14} color="#fff" /> : <Bot size={14} color="#fff" />}
            </View>
            <View style={[styles.bubble, msg.sender === 'user' ? [styles.userBubble, { backgroundColor: theme.tint }] : [styles.aiBubble, { backgroundColor: theme.card }]]}>
              <Text style={[styles.msgText, { color: msg.sender === 'user' ? '#fff' : theme.text }]}>{msg.text}</Text>
            </View>
          </MotiView>
        ))}
        {loading && !messages.some(m => m.id.startsWith('sync-')) && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.aiWrapper}>
            <View style={[styles.avatar, { backgroundColor: '#AF52DE' }]}><Bot size={14} color="#fff" /></View>
            <View style={[styles.bubble, styles.aiBubble, { backgroundColor: theme.card, paddingVertical: 12 }]}><ActivityIndicator size="small" color="#AF52DE" /></View>
          </MotiView>
        )}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={10}>
        <View style={[styles.inputWrapper, { paddingBottom: insets.bottom + 10, backgroundColor: theme.background }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickActions} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
            {QUICK_ACTIONS.map((action, i) => (
              <TouchableOpacity key={i} onPress={() => handleSend(action.prompt)} style={[styles.actionChip, { backgroundColor: theme.card }]}>
                {action.icon}
                <Text style={styles.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          <View style={styles.inputRow}>
            <TextInput style={[styles.input, { backgroundColor: theme.card, color: theme.text }]} placeholder="Ask anything..." placeholderTextColor={theme.tabIconDefault} value={input} onChangeText={setInput} multiline />
            <TouchableOpacity onPress={() => handleSend()} disabled={!input.trim() || loading} style={[styles.sendBtn, { backgroundColor: theme.tint, opacity: !input.trim() || loading ? 0.5 : 1 }]}><Send size={20} color="#fff" /></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '900' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34C759' },
  subtitle: { fontSize: 11, color: '#888', fontWeight: '700' },
  syncBtn: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  chatArea: { flex: 1 },
  msgWrapper: { flexDirection: 'row', marginBottom: 20, maxWidth: '85%', gap: 10 },
  userWrapper: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  aiWrapper: { alignSelf: 'flex-start' },
  avatar: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  bubble: { padding: 15, borderRadius: 20, elevation: 1 },
  userBubble: { borderTopRightRadius: 4 },
  aiBubble: { borderTopLeftRadius: 4 },
  msgText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  inputWrapper: { paddingVertical: 15, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  quickActions: { marginBottom: 15 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  actionLabel: { fontSize: 12, fontWeight: '800', color: '#666' },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 12, fontSize: 15, maxHeight: 100 },
  sendBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' }
});
