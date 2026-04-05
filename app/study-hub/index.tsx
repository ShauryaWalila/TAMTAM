import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, FlatList } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation } from '@/lib/db';
import * as SecureStore from 'expo-secure-store';
import { BookOpen, Plus, X, BrainCircuit, PenTool, LayoutDashboard, Clock, ChevronLeft } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import RadialNavigator from '@/components/RadialNavigator';
import { KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';

export default function StudyHubDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [decks, setDecks] = useState<any[]>([]);
  const [whiteboards, setWhiteboards] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');
  
  const [isDeckModalVisible, setIsDeckModalVisible] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newDeckDesc, setNewDeckDesc] = useState('');

  const [isWhiteboardModalVisible, setIsWhiteboardModalVisible] = useState(false);
  const [newWhiteboardTitle, setNewWhiteboardTitle] = useState('');

  // POMODORO & SYNC STATE
  const [isTimerRunning, setIsTimerStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [selectedDuration, setSelectedDuration] = useState(25);
  const [partnerSession, setPartnerSession] = useState<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    init();
    const subscription = supabase
      .channel('timer_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_study_sessions' }, () => fetchActiveSessions())
      .subscribe();
    
    return () => { subscription.unsubscribe(); };
  }, []);

  const fetchActiveSessions = async () => {
    const { data } = await supabase.from('active_study_sessions').select('*');
    if (data) {
      const mySession = data.find(s => s.user_id === currentUser);
      const herSession = data.find(s => s.user_id !== currentUser);

      if (mySession) {
        const elapsed = Math.floor((new Date().getTime() - new Date(mySession.start_time).getTime()) / 1000);
        const remaining = (mySession.duration_minutes * 60) - elapsed;
        if (remaining > 0) {
          setTimeLeft(remaining);
          setIsTimerStarted(true);
        } else {
          handleTimerComplete();
        }
      }

      if (herSession) {
        setPartnerSession(herSession);
      } else {
        setPartnerSession(null);
      }
    }
  };

  useEffect(() => {
    if (isTimerRunning && timeLeft > 0) {
      timerRef.current = setInterval(() => setTimeLeft(t => t - 1), 1000);
    } else if (timeLeft <= 0 && isTimerRunning) {
      handleTimerComplete();
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerRunning, timeLeft]);

  const handleTimerComplete = async () => {
    setIsTimerStarted(false);
    setTimeLeft(selectedDuration * 60);
    await supabase.from('active_study_sessions').delete().eq('user_id', currentUser);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("🎉 Session Complete!", "Great job focusing!");
    
    await supabase.from('focus_sessions').insert([{
      user_id: currentUser,
      duration_minutes: selectedDuration
    }]);
    fetchActiveSessions();
  };

  const toggleTimer = async () => {
    if (!isTimerRunning) {
      const { error } = await supabase.from('active_study_sessions').upsert({
        user_id: currentUser,
        start_time: new Date().toISOString(),
        duration_minutes: selectedDuration
      });
      if (!error) {
        setTimeLeft(selectedDuration * 60);
        setIsTimerStarted(true);
      }
    } else {
      Alert.alert("Stop Session?", "Progress won't be saved.", [
        { text: "Cancel" },
        { text: "Stop", style: 'destructive', onPress: async () => {
          await supabase.from('active_study_sessions').delete().eq('user_id', currentUser);
          setIsTimerStarted(false);
          setTimeLeft(selectedDuration * 60);
          fetchActiveSessions();
        }}
      ]);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(Math.max(0, seconds) / 60);
    const secs = Math.max(0, seconds) % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    if (name) {
      const u = name.toLowerCase();
      setCurrentUser(u);
      
      // Load from SQLite first
      refreshFromSQLite();
      
      // Background fetch
      fetchData(u);
      
      setTimeout(() => fetchActiveSessions(), 500);
    }
  };

  const refreshFromSQLite = () => {
    try {
      const d = db.getAllSync(`SELECT * FROM study_decks ORDER BY created_at DESC`) as any[];
      setDecks(d || []);
      
      const w = db.getAllSync(`SELECT * FROM study_whiteboards ORDER BY updated_at DESC`) as any[];
      setWhiteboards(w || []);
    } catch (e) {}
  };

  const fetchData = async (userId: string) => {
    try {
      const { data: deckData } = await supabase.from('study_decks').select('*, study_cards(count)').order('created_at', { ascending: false });
      if (deckData) {
        deckData.forEach(d => {
          db.runSync(`INSERT OR REPLACE INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
            [d.id, d.title, d.description, d.color, d.user_id, d.created_at]);
        });
      }

      const { data: boardData } = await supabase.from('study_whiteboards').select('*').order('updated_at', { ascending: false });
      if (boardData) {
        boardData.forEach(b => {
          db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, 
            [b.id, b.title, typeof b.canvas_data === 'string' ? b.canvas_data : JSON.stringify(b.canvas_data), b.updated_at]);
        });
      }
      refreshFromSQLite();
    } catch (e) {}
  };

  const createDeck = async () => {
    if (!newDeckTitle.trim()) return;
    const id = Math.random().toString(36).substr(2, 9);
    const payload = {
      id,
      title: newDeckTitle.trim(),
      description: newDeckDesc.trim(),
      user_id: currentUser,
      created_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO study_decks (id, title, description, user_id, created_at) VALUES (?, ?, ?, ?, ?)`, 
        [payload.id, payload.title, payload.description, payload.user_id, payload.created_at]);
      
      queueSyncOperation('study_decks', payload.id, 'INSERT', payload);

      setIsDeckModalVisible(false);
      setNewDeckTitle('');
      setNewDeckDesc('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshFromSQLite();
    } catch (e) {}
  };

  const createWhiteboard = async () => {
    if (!newWhiteboardTitle.trim()) return;
    const id = Math.random().toString(36).substr(2, 9);
    const payload = {
      id,
      title: newWhiteboardTitle.trim(),
      user_id: currentUser,
      updated_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO study_whiteboards (id, title, user_id, updated_at) VALUES (?, ?, ?, ?)`, 
        [payload.id, payload.title, payload.user_id, payload.updated_at]);
      
      queueSyncOperation('study_whiteboards', payload.id, 'INSERT', payload);

      setIsWhiteboardModalVisible(false);
      setNewWhiteboardTitle('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshFromSQLite();
      router.push(`/study-hub/whiteboard/${payload.id}`);
    } catch (e) {}
  };

  const deleteDeck = async (id: string) => {
    Alert.alert('Delete Deck?', 'This will permanently remove all cards inside.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        db.runSync(`DELETE FROM study_decks WHERE id = ?`, [id]);
        queueSyncOperation('study_decks', id, 'DELETE', {});
        refreshFromSQLite();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  const deleteWhiteboard = async (id: string) => {
    Alert.alert('Delete Board?', 'This will permanently remove this Med-Board.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        db.runSync(`DELETE FROM study_whiteboards WHERE id = ?`, [id]);
        queueSyncOperation('study_whiteboards', id, 'DELETE', {});
        refreshFromSQLite();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: 30 }}>
          <Text style={[styles.title, { color: theme.text }]}>Study Hub</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Exam Mode Activated 🧠</Text>
        </View>

        {/* PARTNER STATUS */}
        {partnerSession && (
          <MotiView 
            from={{ scale: 0.9, opacity: 0 }} 
            animate={{ scale: 1, opacity: 1 }} 
            style={[styles.partnerCard, { backgroundColor: '#FF2D55' }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.liveIndicator} />
              <Text style={styles.partnerText}>Partner is studying right now! ❤️</Text>
            </View>
          </MotiView>
        )}
        
        {/* FOCUS TIMER SECTION */}
        <View style={[styles.timerCard, { backgroundColor: theme.card }]}>
          <View style={styles.timerInfo}>
            <Clock size={32} color={isTimerRunning ? '#FF2D55' : theme.tint} />
            <View style={{ marginLeft: 15 }}>
              {!isTimerRunning ? (
                <View style={styles.durationRow}>
                  {[25, 45, 60, 90].map(d => (
                    <TouchableOpacity 
                      key={d} 
                      onPress={() => { setSelectedDuration(d); setTimeLeft(d * 60); }}
                      style={[styles.durationChip, selectedDuration === d && { backgroundColor: theme.tint }]}
                    >
                      <Text style={[styles.durationText, selectedDuration === d && { color: 'white' }]}>{d}m</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <Text style={styles.timerLabel}>STAY FOCUSED</Text>
              )}
              <Text style={[styles.timerValue, { color: theme.text }]}>{formatTime(timeLeft)}</Text>
            </View>
          </View>
          <TouchableOpacity 
            onPress={toggleTimer} 
            style={[styles.timerBtn, { backgroundColor: isTimerRunning ? '#FF3B30' : theme.tint }]}
          >
            <Text style={styles.timerBtnText}>{isTimerRunning ? 'PAUSE' : 'START'}</Text>
          </TouchableOpacity>
        </View>

        {/* DECKS SECTION */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <BookOpen color={theme.tint} size={24} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Flashcard Decks</Text>
          </View>
          <TouchableOpacity onPress={() => setIsDeckModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}>
            <Plus size={20} color={theme.tint} />
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          {decks.map(deck => (
            <TouchableOpacity 
              key={deck.id} 
              style={[styles.card, { backgroundColor: theme.card, borderTopColor: deck.color, borderTopWidth: 4 }]}
              onPress={() => router.push(`/study-hub/deck/${deck.id}`)}
              onLongPress={() => deleteDeck(deck.id)}
            >
              <Text style={[styles.cardTitle, { color: theme.text }]}>{deck.title}</Text>
              <Text style={[styles.cardSub, { color: theme.tabIconDefault }]} numberOfLines={2}>
                {deck.description || "No description"}
              </Text>
              <View style={styles.cardFooter}>
                <Text style={styles.cardStat}>{deck.study_cards?.[0]?.count || 0} Cards</Text>
              </View>
            </TouchableOpacity>
          ))}
          {decks.length === 0 && (
            <Text style={{ color: theme.tabIconDefault, fontStyle: 'italic', padding: 20 }}>No decks yet. Create one to start revising!</Text>
          )}
        </View>

        {/* WHITEBOARDS SECTION */}
        <View style={[styles.sectionHeader, { marginTop: 40 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PenTool color={theme.tint} size={24} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Med-Boards</Text>
          </View>
          <TouchableOpacity onPress={() => setIsWhiteboardModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}>
            <Plus size={20} color={theme.tint} />
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          {whiteboards.map(board => (
            <TouchableOpacity 
              key={board.id} 
              style={[styles.card, { backgroundColor: theme.card }]}
              onPress={() => router.push(`/study-hub/whiteboard/${board.id}`)}
              onLongPress={() => deleteWhiteboard(board.id)}
            >
              <View style={[styles.boardThumb, { backgroundColor: theme.tint + '10' }]}>
                <LayoutDashboard size={32} color={theme.tint} opacity={0.5} />
              </View>
              <Text style={[styles.cardTitle, { color: theme.text, marginTop: 10 }]}>{board.title}</Text>
            </TouchableOpacity>
          ))}
          {whiteboards.length === 0 && (
            <Text style={{ color: theme.tabIconDefault, fontStyle: 'italic', padding: 20 }}>No whiteboards created yet.</Text>
          )}
        </View>

      </ScrollView>

      {/* NEW DECK MODAL */}
      <Modal visible={isDeckModalVisible} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>New Study Deck</Text>
                  <TouchableOpacity onPress={() => setIsDeckModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
                </View>
                <TextInput 
                  style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} 
                  placeholder="Subject (e.g., Anatomy)" 
                  placeholderTextColor={theme.tabIconDefault}
                  value={newDeckTitle} 
                  onChangeText={setNewDeckTitle} 
                />
                <TextInput 
                  style={[styles.input, { backgroundColor: theme.background, color: theme.text, height: 100, textAlignVertical: 'top' }]} 
                  placeholder="Description" 
                  placeholderTextColor={theme.tabIconDefault}
                  multiline
                  value={newDeckDesc} 
                  onChangeText={setNewDeckDesc} 
                />
                <TouchableOpacity onPress={createDeck} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                  <Text style={styles.saveBtnText}>Create Deck</Text>
                </TouchableOpacity>
              </BlurView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* NEW WHITEBOARD MODAL */}
      <Modal visible={isWhiteboardModalVisible} transparent animationType="fade">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
              <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>New Med-Board</Text>
                  <TouchableOpacity onPress={() => setIsWhiteboardModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
                </View>
                <TextInput 
                  style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} 
                  placeholder="Board Name (e.g., Cardiac Cycle)" 
                  placeholderTextColor={theme.tabIconDefault}
                  value={newWhiteboardTitle} 
                  onChangeText={setNewWhiteboardTitle} 
                />
                <TouchableOpacity onPress={createWhiteboard} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                  <Text style={styles.saveBtnText}>Create Board</Text>
                </TouchableOpacity>
              </BlurView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <RadialNavigator />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 16, fontWeight: '600' },
  scrollContent: { padding: 20, paddingBottom: 100 },
  timerCard: { padding: 25, borderRadius: 32, marginBottom: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', elevation: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  timerInfo: { flexDirection: 'row', alignItems: 'center' },
  timerLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1 },
  timerValue: { fontSize: 32, fontWeight: '900', fontFamily: 'SpaceMono' },
  timerBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 15 },
  timerBtnText: { color: 'white', fontWeight: '900', fontSize: 14 },
  durationRow: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  durationChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(150,150,150,0.1)' },
  durationText: { fontSize: 10, fontWeight: '800' },
  partnerCard: { padding: 15, borderRadius: 20, marginBottom: 20 },
  partnerText: { color: 'white', fontWeight: '900', fontSize: 14 },
  liveIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'white' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  addBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15 },
  card: { width: '47%', padding: 20, borderRadius: 24, elevation: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 5 },
  cardSub: { fontSize: 12, fontWeight: '500', opacity: 0.8 },
  cardFooter: { marginTop: 15, flexDirection: 'row', justifyContent: 'space-between' },
  cardStat: { fontSize: 12, fontWeight: '900', color: '#888' },
  boardThumb: { width: '100%', height: 100, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { padding: 30, borderTopLeftRadius: 40, borderTopRightRadius: 40, gap: 15 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  input: { padding: 20, borderRadius: 20, fontSize: 16, fontWeight: '600' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
