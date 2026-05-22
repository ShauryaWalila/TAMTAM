import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions, DeviceEventEmitter, Alert, Pressable, Modal } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Send, Sparkles, BrainCircuit, Microscope, Lightbulb, RefreshCcw, User, Bot, Swords, Trophy, Stethoscope, Info, CheckCircle2, XCircle, Database, Globe, WifiOff, Mic, Volume2, VolumeX, Square, Menu, Plus, Trash2, MessageSquare } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Audio } from 'expo-av';
import { askAIStudyBuddy, startRevisionBattle, evaluateBattleReasoning, getHybridContext, transcribeAudio, speak, stopSpeaking, summariseChat, extractFlashcard, getDailySuggestions, processBrainDumpToFlashcards } from '@/lib/aiEngine';
import { createChat, listChats, loadMessages, appendMessage, deleteChat, autoTitleFromFirstUserMessage, ChatSummary } from '@/lib/studyChats';
import { addMemory, getBuddySettings, setBuddySetting, upsertChatSummary } from '@/lib/studyMemories';
import { db, generateUUID } from '@/lib/db';
import { format } from 'date-fns';
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
  const params = useLocalSearchParams<{ resume?: string }>();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isBattleActive, setIsBattleActive] = useState(false);
  const [currentBattle, setCurrentBattle] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState('');
  const [isOnline, setIsOnline] = useState(true);

  // Multi-chat state. Each chat is a persistent SQLite row; the buddy resumes
  // the most recent one on every screen open so the user never loses context.
  const [chatId, setChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickingMsg, setPickingMsg] = useState<Message | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [buddySettings, setBuddySettingsState] = useState({
    autoSummary: true,
    autoFlashcards: true,
    proactiveSuggestions: true,
    flashcardDeckId: '',
  });

  // Voice State
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // TTS is OFF by default. User opts in via the volume button in the header.
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const micScale = useSharedValue(1);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const name = (await SecureStore.getItemAsync('user_name'))?.toLowerCase() || 'doc';
      if (!mounted) return;
      setCurrentUser(name);
      SecureStore.getItemAsync('study_tts_enabled').then(v => setTtsEnabled(v === '1'));
      // Load existing chats. Resume the most recent or seed a new one.
      const all = listChats(name);
      setChats(all);
      const s = getBuddySettings();
      setBuddySettingsState(s);
      if (s.proactiveSuggestions) setSuggestions(getDailySuggestions(name));

      // Restore the last chat the user was on (persists across process kills).
      // If the screen was opened with ?resume=<id> (e.g. from an anatomy
      // diagram), prefer that one.
      const resumeId = (params?.resume ? String(params.resume) : null);
      const lastId = resumeId || await SecureStore.getItemAsync('study_last_chat_id');
      const matched = lastId ? all.find(c => c.id === lastId) : null;
      if (matched) {
        openChat(matched.id);
      } else if (all.length > 0) {
        openChat(all[0].id);
      } else {
        startNewChat(name);
      }
    })();
    const unsub = NetInfo.addEventListener(state => setIsOnline(!!state.isConnected));
    return () => { mounted = false; unsub(); stopSpeaking(); };
  }, []);

  const refreshChatList = useCallback(() => {
    if (!currentUser) return;
    setChats(listChats(currentUser));
  }, [currentUser]);

  const openChat = (id: string) => {
    // Auto-summarise the chat we're leaving (if user enabled it).
    const leaving = chatId;
    if (leaving && leaving !== id && buddySettings.autoSummary) {
      summariseChat(leaving).then(sum => {
        if (sum) upsertChatSummary(leaving, sum.topic, sum.takeaways);
      });
    }
    const stored = loadMessages(id);
    if (stored.length === 0) {
      setMessages([{
        id: 'seed-' + id,
        text: 'Welcome back, Doc. Your knowledge base is on. Ask anything — past chats and your study notes feed every answer. 🧠',
        sender: 'ai',
        timestamp: new Date(),
      }]);
    } else {
      setMessages(stored.map(m => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        data: m.data,
        timestamp: new Date(m.created_at),
      })));
    }
    setChatId(id);
    SecureStore.setItemAsync('study_last_chat_id', id).catch(() => {});
    setIsBattleActive(false);
    setCurrentBattle(null);
    setDrawerOpen(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
  };

  const startNewChat = (userOverride?: string) => {
    const owner = userOverride || currentUser || 'doc';
    const newId = createChat('New Chat', owner);
    setChats(listChats(owner));
    setChatId(newId);
    SecureStore.setItemAsync('study_last_chat_id', newId).catch(() => {});
    setMessages([{
      id: 'seed-' + newId,
      text: 'Fresh chat started. The knowledge base from your past sessions stays loaded — ask anything. 🩺',
      sender: 'ai',
      timestamp: new Date(),
    }]);
    setIsBattleActive(false);
    setCurrentBattle(null);
    setDrawerOpen(false);
  };

  const handlePinMemory = (msg: Message) => {
    if (!currentUser) return;
    addMemory('pinned_answer', msg.text, currentUser, { chatId: chatId || undefined, messageId: msg.id });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Pinned', "Saved as long-term memory. Future answers will recall it.");
    setPickingMsg(null);
  };

  const ensureBuddyDeck = (): string => {
    if (buddySettings.flashcardDeckId) {
      const exists = db.getFirstSync(`SELECT id FROM study_decks WHERE id = ?`, [buddySettings.flashcardDeckId]) as any;
      if (exists) return buddySettings.flashcardDeckId;
    }
    const existing = db.getFirstSync(
      `SELECT id FROM study_decks WHERE user_id = ? AND title = 'Med Buddy' LIMIT 1`,
      [currentUser]
    ) as any;
    if (existing?.id) {
      setBuddySetting('study_flashcard_deck_id', existing.id);
      setBuddySettingsState(s => ({ ...s, flashcardDeckId: existing.id }));
      return existing.id;
    }
    const newId = generateUUID();
    db.runSync(
      `INSERT INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [newId, 'Med Buddy', 'Cards auto-generated from chats with the buddy.', '#AF52DE', currentUser]
    );
    setBuddySetting('study_flashcard_deck_id', newId);
    setBuddySettingsState(s => ({ ...s, flashcardDeckId: newId }));
    return newId;
  };

  const handleMakeFlashcard = async (msg: Message) => {
    setPickingMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const card = await extractFlashcard(msg.text);
    if (!card) { Alert.alert('Could not extract', 'The answer was too short or the AI couldn’t make a card.'); return; }
    const deckId = ensureBuddyDeck();
    const id = generateUUID();
    db.runSync(
      `INSERT INTO study_cards (id, deck_id, front_content, back_content, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      [id, deckId, card.front, card.back]
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Flashcard added', `Q: ${card.front}\nA: ${card.back}`);
  };

  const handleDeleteChat = (id: string) => {
    Alert.alert('Delete chat?', 'This conversation will be gone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteChat(id);
          const remaining = listChats(currentUser);
          setChats(remaining);
          if (chatId === id) {
            if (remaining.length > 0) openChat(remaining[0].id);
            else startNewChat();
          }
        },
      },
    ]);
  };

  const maybeSpeak = (text: string) => {
    if (!ttsEnabled) return;
    speak(text, () => setIsSpeaking(false));
    setIsSpeaking(true);
  };

  const toggleTts = async () => {
    const next = !ttsEnabled;
    setTtsEnabled(next);
    await SecureStore.setItemAsync('study_tts_enabled', next ? '1' : '0');
    if (!next) { stopSpeaking(); setIsSpeaking(false); }
    Haptics.selectionAsync();
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;
    const activeChatId = chatId;
    if (!activeChatId) return;

    const userMsg: Message = { id: Date.now().toString(), text: textToSend, sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    appendMessage(activeChatId, 'user', textToSend);
    setInput('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const context = await getHybridContext(textToSend, currentUser);
    if (context) {
      setMessages(prev => [...prev, { id: 'ctx-' + Date.now(), text: 'Analyzing...', sender: 'context', data: context, timestamp: new Date() }]);
      appendMessage(activeChatId, 'context', 'Analyzing...', context);
    }

    if (isBattleActive && currentBattle) {
      const evalRes = await evaluateBattleReasoning(textToSend, currentBattle.correct_answer, currentBattle.case);
      const msg: Message = { id: Date.now().toString(), text: evalRes.feedback, sender: 'battle', data: evalRes, timestamp: new Date() };
      setMessages(prev => [...prev, msg]);
      appendMessage(activeChatId, 'battle', evalRes.feedback, evalRes);
      maybeSpeak(evalRes.feedback);
      setIsBattleActive(false); setCurrentBattle(null);
    } else {
      // Extract history for context (last 10 messages — fresh from state).
      const history = messages.slice(-10).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant' as 'user' | 'assistant',
        content: m.text
      }));

      const response = await askAIStudyBuddy(textToSend, currentUser, history);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: response, sender: 'ai', timestamp: new Date() }]);
      appendMessage(activeChatId, 'ai', response);
      maybeSpeak(response);
    }
    autoTitleFromFirstUserMessage(activeChatId);
    refreshChatList();
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
    if (!chatId) return;
    setLoading(true);
    const battle = await startRevisionBattle(currentUser, 'vignette');
    if (battle) {
      setCurrentBattle(battle); setIsBattleActive(true);
      setMessages(prev => [...prev, { id: 'battle-' + Date.now(), text: battle.case, sender: 'ai', timestamp: new Date() }]);
      appendMessage(chatId, 'ai', battle.case, { kind: 'battle-case' });
      maybeSpeak(battle.case);
      refreshChatList();
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
          <Text style={styles.title} numberOfLines={1}>{chats.find(c => c.id === chatId)?.title || 'Med Buddy'}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.onlineDot, { backgroundColor: isOnline ? '#34C759' : '#FF9500' }]} />
            <Text style={styles.subtitle}>{isOnline ? 'Voice & Semantic Active' : 'Offline Mode'}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={toggleTts} onLongPress={() => { stopSpeaking(); setIsSpeaking(false); }} style={styles.backBtn}>
          {ttsEnabled ? <Volume2 size={20} color={isSpeaking ? theme.tint : theme.text} /> : <VolumeX size={20} color="#888" />}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} style={[styles.backBtn, { marginLeft: 8 }]}>
          <Sparkles size={18} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setDrawerOpen(true)} style={[styles.backBtn, { marginLeft: 8 }]}>
          <Menu size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={{ padding: 20, paddingBottom: 220 }}>
        {buddySettings.proactiveSuggestions && suggestions.length > 0 && (
          <View style={[styles.suggestionsBanner, { backgroundColor: theme.tint + '15', borderColor: theme.tint + '40' }]}>
            <Text style={[styles.suggestionsTitle, { color: theme.tint }]}>BUDDY NUDGE</Text>
            {suggestions.map((s, i) => (
              <Text key={i} style={[styles.suggestionLine, { color: theme.text }]}>• {s}</Text>
            ))}
          </View>
        )}
        {messages.map((msg) => {
          const canPick = msg.sender === 'ai' || msg.sender === 'battle';
          return (
            <MotiView key={msg.id} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} style={[styles.msgWrapper, msg.sender === 'user' ? styles.userWrapper : styles.aiWrapper]}>
              {msg.sender !== 'user' && msg.sender !== 'context' && <View style={[styles.avatar, { backgroundColor: msg.sender === 'battle' ? '#FF3B30' : '#AF52DE' }]}><Bot size={14} color="#fff" /></View>}
              <Pressable
                onLongPress={canPick ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setPickingMsg(msg); } : undefined}
                delayLongPress={350}
                style={[styles.bubble, msg.sender === 'user' ? [styles.userBubble, { backgroundColor: theme.tint }] : (msg.sender === 'context' ? styles.contextBubble : [styles.aiBubble, { backgroundColor: theme.card }])]}>
                {msg.sender === 'battle' ? (
                  <View style={styles.battleCard}>
                    <View style={styles.battleHeader}><Trophy size={18} color="#FFD700" /><Text style={styles.battleTitle}>Reasoning</Text><Text style={styles.battleScore}>{msg.data.score}%</Text></View>
                    <Text style={styles.battleFeedback}>{msg.text}</Text>
                  </View>
                ) : (msg.sender === 'context' ? (
                  <View style={styles.ragBox}><Text style={styles.ragTitle}>CONTEXT FOUND</Text><Text style={styles.ragText} numberOfLines={2}>{msg.data}</Text></View>
                ) : <Text style={[styles.msgText, { color: msg.sender === 'user' ? '#fff' : theme.text }]}>{msg.text}</Text>)}
              </Pressable>
            </MotiView>
          );
        })}
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

      {/* Long-press action sheet — pin a memory or generate a flashcard */}
      <Modal visible={!!pickingMsg} transparent animationType="fade" onRequestClose={() => setPickingMsg(null)}>
        <Pressable style={styles.pickerScrim} onPress={() => setPickingMsg(null)}>
          <Pressable style={[styles.pickerCard, { backgroundColor: theme.background }]} onPress={() => {}}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>What about this answer?</Text>
            <Text style={[styles.pickerPreview, { color: theme.tabIconDefault }]} numberOfLines={3}>{pickingMsg?.text}</Text>
            <TouchableOpacity onPress={() => pickingMsg && handlePinMemory(pickingMsg)} style={[styles.pickerBtn, { backgroundColor: theme.tint }]}>
              <Sparkles size={16} color="#fff" />
              <Text style={styles.pickerBtnText}>Pin as long-term memory</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pickingMsg && handleMakeFlashcard(pickingMsg)} style={[styles.pickerBtn, { backgroundColor: '#AF52DE' }]}>
              <BrainCircuit size={16} color="#fff" />
              <Text style={styles.pickerBtnText}>Save as Flashcard</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPickingMsg(null)} style={styles.pickerCancel}>
              <Text style={{ color: theme.tabIconDefault, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Buddy settings */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.pickerScrim} onPress={() => setSettingsOpen(false)}>
          <Pressable style={[styles.pickerCard, { backgroundColor: theme.background, maxWidth: 360 }]} onPress={() => {}}>
            <Text style={[styles.pickerTitle, { color: theme.text }]}>Buddy Settings</Text>
            {[
              { key: 'study_auto_summary', label: 'Auto-summarise chats on switch', stateKey: 'autoSummary' as const },
              { key: 'study_auto_flashcards', label: 'Auto flashcards from brain dump', stateKey: 'autoFlashcards' as const },
              { key: 'study_proactive', label: 'Daily revision nudges', stateKey: 'proactiveSuggestions' as const },
              { key: 'study_tts_enabled', label: 'Text-to-speech replies', stateKey: 'ttsEnabled' as const },
            ].map(opt => {
              const isOn = opt.stateKey === 'ttsEnabled' ? ttsEnabled : (buddySettings as any)[opt.stateKey];
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => {
                    const next = !isOn;
                    setBuddySetting(opt.key, next ? '1' : '0');
                    if (opt.stateKey === 'ttsEnabled') { setTtsEnabled(next); if (!next) { stopSpeaking(); setIsSpeaking(false); } }
                    else setBuddySettingsState(s => ({ ...s, [opt.stateKey]: next }));
                    if (opt.stateKey === 'proactiveSuggestions') setSuggestions(next ? getDailySuggestions(currentUser) : []);
                    Haptics.selectionAsync();
                  }}
                  style={[styles.toggleRow, { borderColor: theme.tabIconDefault + '30' }]}
                >
                  <Text style={{ color: theme.text, flex: 1, fontWeight: '600' }}>{opt.label}</Text>
                  <View style={[styles.toggleSwitch, { backgroundColor: isOn ? theme.tint : theme.tabIconDefault + '40' }]}>
                    <View style={[styles.toggleKnob, { transform: [{ translateX: isOn ? 18 : 0 }] }]} />
                  </View>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => { setSettingsOpen(false); router.push('/study-hub/memories'); }}
              style={[styles.pickerBtn, { backgroundColor: '#AF52DE', marginTop: 14 }]}
            >
              <Sparkles size={16} color="#fff" />
              <Text style={styles.pickerBtnText}>Manage Long-Term Memories</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                setSettingsOpen(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const deckId = ensureBuddyDeck();
                const n = await processBrainDumpToFlashcards(currentUser, deckId);
                Alert.alert(n > 0 ? 'Brain dumps processed' : 'Nothing to process', n > 0 ? `Created ${n} new flashcard(s) in the Med Buddy deck.` : 'No unprocessed brain dumps found.');
              }}
              style={[styles.pickerBtn, { backgroundColor: '#FF9500' }]}
            >
              <BrainCircuit size={16} color="#fff" />
              <Text style={styles.pickerBtnText}>Turn Brain Dumps → Flashcards</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSettingsOpen(false)} style={[styles.pickerBtn, { backgroundColor: theme.tint, marginTop: 10 }]}>
              <Text style={styles.pickerBtnText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Chats drawer — slides in from the right with the full chat history */}
      <Modal visible={drawerOpen} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={() => setDrawerOpen(false)}>
        <Pressable style={styles.drawerScrim} onPress={() => setDrawerOpen(false)}>
          <Pressable style={[styles.drawer, { backgroundColor: theme.background, paddingTop: insets.top + 16 }]} onPress={() => {}}>
            <View style={styles.drawerHeader}>
              <Text style={[styles.drawerTitle, { color: theme.text }]}>Your Chats</Text>
              <TouchableOpacity onPress={() => setDrawerOpen(false)}><XCircle size={22} color={theme.tabIconDefault} /></TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => startNewChat()} style={[styles.newChatBtn, { backgroundColor: theme.tint }]}>
              <Plus size={18} color="#fff" />
              <Text style={styles.newChatText}>New Chat</Text>
            </TouchableOpacity>
            <ScrollView style={{ flex: 1, marginTop: 12 }} contentContainerStyle={{ paddingBottom: 30 }}>
              {chats.length === 0 ? (
                <Text style={{ color: theme.tabIconDefault, fontSize: 13, padding: 12 }}>No saved chats yet.</Text>
              ) : chats.map(c => {
                const isActive = c.id === chatId;
                return (
                  <View key={c.id} style={[styles.chatRow, { backgroundColor: isActive ? theme.tint + '15' : 'transparent' }]}>
                    <TouchableOpacity onPress={() => openChat(c.id)} style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <MessageSquare size={14} color={isActive ? theme.tint : theme.tabIconDefault} />
                        <Text style={[styles.chatRowTitle, { color: theme.text }]} numberOfLines={1}>{c.title}</Text>
                      </View>
                      {!!c.last_preview && <Text style={[styles.chatRowPreview, { color: theme.tabIconDefault }]} numberOfLines={1}>{c.last_preview}</Text>}
                      <Text style={[styles.chatRowMeta, { color: theme.tabIconDefault }]}>{c.message_count} msg · {format(new Date(c.updated_at), 'd MMM, HH:mm')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteChat(c.id)} style={styles.chatDeleteBtn}>
                      <Trash2 size={16} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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
  battleFeedback: { fontSize: 14, lineHeight: 20, color: '#333' },
  drawerScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', flexDirection: 'row', justifyContent: 'flex-end' },
  drawer: { width: SCREEN_WIDTH * 0.82, paddingHorizontal: 18, borderTopLeftRadius: 24, borderBottomLeftRadius: 24, elevation: 12 },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  drawerTitle: { fontSize: 20, fontWeight: '900' },
  newChatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14 },
  newChatText: { color: '#fff', fontWeight: '900', fontSize: 14, letterSpacing: 0.4 },
  chatRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14, marginBottom: 6 },
  chatRowTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  chatRowPreview: { fontSize: 12, marginTop: 2, marginLeft: 22 },
  chatRowMeta: { fontSize: 10, marginTop: 2, marginLeft: 22, fontWeight: '700', letterSpacing: 0.4 },
  chatDeleteBtn: { padding: 8 },
  suggestionsBanner: { borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 18, gap: 4 },
  suggestionsTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 4 },
  suggestionLine: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  pickerScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  pickerCard: { width: '100%', maxWidth: 340, borderRadius: 24, padding: 22, gap: 10 },
  pickerTitle: { fontSize: 18, fontWeight: '900' },
  pickerPreview: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14 },
  pickerBtnText: { color: '#fff', fontWeight: '800' },
  pickerCancel: { alignItems: 'center', paddingVertical: 10 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, padding: 4, justifyContent: 'center' },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
});
