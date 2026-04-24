import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions, DeviceEventEmitter, Alert, Pressable } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Send, Sparkles, BrainCircuit, Microscope, Lightbulb, RefreshCcw, User, Bot, Swords, Trophy, Stethoscope, Info, CheckCircle2, XCircle, Database, Globe, WifiOff, Mic, Volume2, VolumeX, Square } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Audio } from 'expo-av';
import { askAIStudyBuddy, startRevisionBattle, evaluateBattleReasoning, getHybridContext, transcribeAudio, speak, stopSpeaking } from '@/lib/aiEngine';
import NetInfo from '@react-native-community/netinfo';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai' | 'system' | 'battle' | 'context';
  data?: any;
  timestamp: Date;
}

export default function AIStudyBuddyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: "Hello Doc! Ready for a clinical battle today? I can now listen to you and speak back. 🎙️", sender: 'ai', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isBattleActive, setIsBattleActive] = useState(false);
  const [currentBattle, setCurrentBattle] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState('');
  const [isOnline, setIsOnline] = useState(true);

  // Voice State
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const micScale = useSharedValue(1);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    SecureStore.getItemAsync('user_name').then(name => setCurrentUser(name?.toLowerCase() || 'doc'));
    const unsub = NetInfo.addEventListener(state => setIsOnline(!!state.isConnected));
    return () => { unsub(); stopSpeaking(); };
  }, []);

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), text: textToSend, sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const context = await getHybridContext(textToSend, currentUser);
    if (context) setMessages(prev => [...prev, { id: 'ctx-' + Date.now(), text: "Analyzing...", sender: 'context', data: context, timestamp: new Date() }]);

    if (isBattleActive && currentBattle) {
      const evalRes = await evaluateBattleReasoning(textToSend, currentBattle.correct_answer, currentBattle.case);
      const msg: Message = { id: Date.now().toString(), text: evalRes.feedback, sender: 'battle', data: evalRes, timestamp: new Date() };
      setMessages(prev => [...prev, msg]);
      speak(evalRes.feedback, () => setIsSpeaking(false)); setIsSpeaking(true);
      setIsBattleActive(false); setCurrentBattle(null);
    } else {
      // Extract history for context (last 10 messages)
      const history = messages.slice(-10).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
        content: m.text
      }));

      const response = await askAIStudyBuddy(textToSend, currentUser, history);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response, sender: 'ai', timestamp: new Date() }]);
      speak(response, () => setIsSpeaking(false)); setIsSpeaking(true);
    }
    setLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (perm.status !== 'granted') return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(recording); setIsRecording(true);
      micScale.value = withRepeat(withSequence(withTiming(1.2), withTiming(1)), -1, true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) { Alert.alert('Mic Error', 'Could not start recording'); }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    micScale.value = withSpring(1);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    if (uri) {
      setLoading(true);
      try {
        const text = await transcribeAudio(uri);
        if (text) handleSend(text);
      } catch (e) { Alert.alert('Transcription Error', 'Try again, doc.'); }
      setLoading(false);
    }
  };

  const triggerBattle = async () => {
    setLoading(true);
    const battle = await startRevisionBattle(currentUser, 'vignette');
    if (battle) {
      setCurrentBattle(battle); setIsBattleActive(true);
      setMessages(prev => [...prev, { id: 'battle-' + Date.now(), text: battle.case, sender: 'ai', timestamp: new Date() }]);
      speak(battle.case, () => setIsSpeaking(false)); setIsSpeaking(true);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
  };

  const micStyle = useAnimatedStyle(() => ({ transform: [{ scale: micScale.value }] }));

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>Med Buddy</Text>
          <View style={styles.statusRow}>
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#34C759' : '#FF9500' }]} />
            <Text style={styles.subtitle}>{isOnline ? 'Voice & Semantic Active' : 'Offline Mode'}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => { stopSpeaking(); setIsSpeaking(false); }} style={styles.backBtn}>
          {isSpeaking ? <Volume2 size={20} color={theme.tint} /> : <VolumeX size={20} color="#888" />}
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={{ padding: 20, paddingBottom: 220 }}>
        {messages.map((msg) => (
          <MotiView key={msg.id} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} style={[styles.msgWrapper, msg.sender === 'user' ? styles.userWrapper : styles.aiWrapper]}>
            {msg.sender !== 'user' && msg.sender !== 'context' && <View style={[styles.avatar, { backgroundColor: msg.sender === 'battle' ? '#FF3B30' : '#AF52DE' }]}><Bot size={14} color="#fff" /></View>}
            <View style={[styles.bubble, msg.sender === 'user' ? [styles.userBubble, { backgroundColor: theme.tint }] : (msg.sender === 'context' ? styles.contextBubble : [styles.aiBubble, { backgroundColor: theme.card }])]}>
              {msg.sender === 'battle' ? (
                <View style={styles.battleCard}>
                  <View style={styles.battleHeader}><Trophy size={18} color="#FFD700" /><Text style={styles.battleTitle}>Reasoning</Text><Text style={styles.battleScore}>{msg.data.score}%</Text></View>
                  <Text style={styles.battleFeedback}>{msg.text}</Text>
                </View>
              ) : (msg.sender === 'context' ? (
                <View style={styles.ragBox}><Text style={styles.ragTitle}>CONTEXT FOUND</Text><Text style={styles.ragText} numberOfLines={2}>{msg.data}</Text></View>
              ) : <Text style={[styles.msgText, { color: msg.sender === 'user' ? '#fff' : theme.text }]}>{msg.text}</Text>)}
            </View>
          </MotiView>
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.footer}>
        <View style={[styles.inputWrapper, { paddingBottom: insets.bottom + 10, backgroundColor: theme.background }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickActions} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
            {[{ label: 'Clinical Battle', icon: <Swords size={16} color="#FF3B30" />, action: triggerBattle }, { label: 'Mnemonic', icon: <Lightbulb size={16} color="#AF52DE" />, action: () => handleSend("Give me a clinical mnemonic.") }].map((a, i) => (
              <TouchableOpacity key={i} onPress={a.action} style={[styles.actionChip, { backgroundColor: theme.card }]}>{a.icon}<Text style={styles.actionLabel}>{a.label}</Text></TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.inputRow}>
            <TouchableOpacity onPress={isRecording ? stopRecording : startRecording} style={[styles.micBtn, { backgroundColor: isRecording ? '#FF3B30' : theme.card }]}>
              <Animated.View style={micStyle}>{isRecording ? <Square size={20} color="#fff" /> : <Mic size={20} color={theme.tint} />}</Animated.View>
            </TouchableOpacity>
            <TextInput style={[styles.input, { backgroundColor: theme.card, color: theme.text }]} placeholder={isRecording ? "Listening, doc..." : "Ask or record a note..."} value={input} onChangeText={setInput} multiline />
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
  backBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '900' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  onlineDot: { width: 8, height: 8, borderRadius: 4 },
  subtitle: { fontSize: 11, color: '#888', fontWeight: '800' },
  chatArea: { flex: 1 },
  msgWrapper: { flexDirection: 'row', marginBottom: 20, maxWidth: '88%', gap: 12 },
  userWrapper: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  aiWrapper: { alignSelf: 'flex-start' },
  avatar: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  bubble: { padding: 16, borderRadius: 24, elevation: 1 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4 },
  contextBubble: { backgroundColor: 'transparent', padding: 0 },
  msgText: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  inputWrapper: { paddingVertical: 20, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  quickActions: { marginBottom: 16 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 22 },
  actionLabel: { fontSize: 13, fontWeight: '800', color: '#555' },
  inputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  micBtn: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', borderWeight: 1, borderColor: 'rgba(0,0,0,0.05)' },
  input: { flex: 1, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 14, fontSize: 16, maxHeight: 120 },
  sendBtn: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center' },
  ragBox: { backgroundColor: 'rgba(175, 82, 222, 0.08)', padding: 10, borderRadius: 15, borderLeftWidth: 3, borderLeftColor: '#AF52DE' },
  ragTitle: { fontSize: 9, fontWeight: '900', color: '#AF52DE' },
  ragText: { fontSize: 11, color: '#666', fontStyle: 'italic' },
  battleCard: { width: '100%', gap: 8 },
  battleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  battleTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#FF3B30' },
  battleScore: { fontSize: 18, fontWeight: '900', color: '#34C759' },
  battleFeedback: { fontSize: 14, lineHeight: 20, color: '#333' }
});
