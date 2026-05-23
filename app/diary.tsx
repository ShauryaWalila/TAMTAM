import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, ScrollView, Dimensions, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ImageBackground, Modal } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus, X, Save, Trash2, Heart, Moon, Sun, Cloud, Calendar as CalIcon, Smile, Check } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { updateTamtamWidget } from '@/lib/widget';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Image } from 'react-native';
import StickerPicker from '@/components/StickerPicker';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MOODS = [
  { icon: <Heart size={20} color="#FF2D55" />, label: 'Loved', value: 'loved' },
  { icon: <Sun size={20} color="#FFCC00" />, label: 'Happy', value: 'happy' },
  { icon: <Cloud size={20} color="#8E8E93" />, label: 'Pensive', value: 'pensive' },
  { icon: <Moon size={20} color="#5856D6" />, label: 'Quiet', value: 'quiet' },
];

export default function DiaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  
  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [currentEntry, setCurrentEntry] = useState<any>(null);
  const [content, setContent] = useState('');
  const [selectedMood, setSelectedMood] = useState('happy');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<any>(null);
  const editingIdRef = useRef<string | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);

  useEffect(() => {
    loadUserAndEntries();
  }, []);

  const loadUserAndEntries = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    if (user) {
      setUsername(user.toLowerCase());
      fetchEntries(user.toLowerCase());
    }
  };

  const fetchEntries = async (user: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_diary')
      .select('*')
      .eq('user_id', user)
      .order('created_at', { ascending: false });
    
    if (data) setEntries(data);
    setLoading(false);
  };

  // Auto-saves the current entry. Insert on first save (returns id), update
  // subsequently. Debounced via runAutoSave below.
  const persistEntry = async () => {
    const hasContent = content.trim().length > 0;
    const hasStickers = attachments.length > 0;
    if (!hasContent && !hasStickers) return;
    const payload: any = {
      user_id: username,
      content: content.trim(),
      mood: selectedMood,
      attachments: JSON.stringify(attachments),
      updated_at: new Date().toISOString(),
    };
    const editingId = editingIdRef.current;
    try {
      if (editingId) {
        await supabase.from('user_diary').update(payload).eq('id', editingId);
      } else {
        const { data, error } = await supabase.from('user_diary').insert([payload]).select().single();
        if (!error && data?.id) editingIdRef.current = data.id;
      }
      setSavedAt(new Date());
      updateTamtamWidget(`Mood: ${selectedMood} - ${content.substring(0, 20)}...`);
    } catch {}
  };

  const runAutoSave = () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => { persistEntry(); }, 800);
  };

  const closeEditor = async () => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    await persistEntry();
    setIsEditing(false);
    setContent('');
    setCurrentEntry(null);
    editingIdRef.current = null;
    setSavedAt(null);
    fetchEntries(username);
  };

  const deleteEntry = async (id: string) => {
    Alert.alert('Delete Entry?', 'This thought will be gone forever.', [
      { text: 'Keep it' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('user_diary').delete().eq('id', id);
        if (!error) {
          fetchEntries(username);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }}
    ]);
  };

  const openEditor = (entry: any = null) => {
    setCurrentEntry(entry);
    setContent(entry ? entry.content : '');
    setSelectedMood(entry ? entry.mood : 'happy');
    // Normalise attachments — may be stored as JSON string or array.
    let initialAtts: string[] = [];
    if (entry?.attachments) {
      try {
        initialAtts = typeof entry.attachments === 'string' ? JSON.parse(entry.attachments) : entry.attachments;
        if (!Array.isArray(initialAtts)) initialAtts = [];
      } catch { initialAtts = []; }
    }
    setAttachments(initialAtts);
    editingIdRef.current = entry ? entry.id : null;
    setSavedAt(null);
    setShowStickerPicker(false);
    setIsEditing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Trigger auto-save whenever content / mood / stickers change.
  useEffect(() => {
    if (!isEditing) return;
    if (!content.trim() && attachments.length === 0) return;
    runAutoSave();
  }, [content, selectedMood, attachments, isEditing]);

  const parseAttachments = (raw: any): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  };

  if (loading && !isEditing) {
    return <View style={[styles.container, styles.centered]}><ActivityIndicator color="#C4A484" /></View>;
  }

  return (
    <View style={[styles.container, { backgroundColor: '#FDF5E6' }]}>
      {/* DIARY COVER / HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={28} color="#5D4037" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.diaryTitle}>Dear Diary</Text>
          <Text style={styles.diaryOwner}>{username === 'love' ? 'Supriya\'s' : 'Pratishth\'s'} Secret Space</Text>
        </View>
        <TouchableOpacity onPress={() => openEditor()} style={styles.addBtn}>
          <Plus size={24} color="#FDF5E6" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {entries.length === 0 ? (
          <View style={styles.emptyState}>
            <Heart size={40} color="#C4A484" opacity={0.3} />
            <Text style={styles.emptyText}>No entries yet. Start writing your heart out...</Text>
          </View>
        ) : (
          entries.map((entry, index) => (
            <MotiView 
              key={entry.id}
              from={{ opacity: 0, translateY: 20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ delay: index * 100 }}
              style={styles.entryCard}
            >
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => openEditor(entry)}
                onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); deleteEntry(entry.id); }}
                delayLongPress={450}
              >
                <View style={styles.entryHeader}>
                  <View style={styles.dateBadge}>
                    <Text style={styles.dateDay}>{format(new Date(entry.created_at), 'dd')}</Text>
                    <Text style={styles.dateMonth}>{format(new Date(entry.created_at), 'MMM').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 15 }}>
                    <Text style={styles.entryMood}>Feeling {entry.mood}</Text>
                    <Text style={styles.entryTime}>{format(new Date(entry.created_at), 'hh:mm a')}</Text>
                  </View>
                </View>
                <View style={styles.lining}>
                  {!!entry.content && <Text style={styles.entryContent} numberOfLines={4}>{entry.content}</Text>}
                  {(() => {
                    const atts = parseAttachments(entry.attachments);
                    if (atts.length === 0) return null;
                    return (
                      <View style={styles.cardStickerStrip}>
                        {atts.slice(0, 6).map((uri, i) => (
                          <Image key={uri + i} source={{ uri }} style={styles.cardStickerImg} resizeMode="contain" />
                        ))}
                      </View>
                    );
                  })()}
                </View>
              </TouchableOpacity>
            </MotiView>
          ))
        )}
      </ScrollView>

      {/* EDITOR MODAL */}
      <Modal visible={isEditing} animationType="slide" transparent>
        <View style={styles.modalContainer}>
          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.editorPaper}>
            <View style={styles.editorHeader}>
              <TouchableOpacity onPress={closeEditor}><X size={24} color="#5D4037" /></TouchableOpacity>
              <Text style={styles.editorTitle}>{currentEntry ? 'Editing Memory' : 'New Thought'}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#C4A484', letterSpacing: 0.5 }}>
                  {savedAt ? `SAVED ${format(savedAt, 'HH:mm')}` : 'AUTOSAVE'}
                </Text>
                <TouchableOpacity onPress={() => setShowStickerPicker(true)}>
                  <Smile size={22} color="#5D4037" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.moodPicker}>
              {MOODS.map(m => (
                <TouchableOpacity
                  key={m.value}
                  onPress={() => setSelectedMood(m.value)}
                  style={[styles.moodItem, selectedMood === m.value && styles.moodSelected]}
                >
                  {m.icon}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.paperContent}>
              <View style={styles.redMargin} />
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingRight: 20 }} keyboardShouldPersistTaps="handled">
                <TextInput
                  style={styles.diaryInput}
                  multiline
                  placeholder="Write here..."
                  placeholderTextColor="#A0A0A0"
                  value={content}
                  onChangeText={setContent}
                  autoFocus
                />
                {attachments.length > 0 && (
                  <View style={styles.stickerStrip}>
                    {attachments.map((uri, i) => (
                      <TouchableOpacity
                        key={uri + i}
                        onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAttachments(a => a.filter((_, idx) => idx !== i)); }}
                        delayLongPress={350}
                        style={styles.stickerWrap}
                      >
                        <Image source={{ uri }} style={styles.stickerImg} resizeMode="contain" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      <StickerPicker
        visible={showStickerPicker}
        onClose={() => setShowStickerPicker(false)}
        onPicked={(uri) => { setAttachments(a => [...a, uri]); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingBottom: 20,
    backgroundColor: '#FDF5E6',
    borderBottomWidth: 1,
    borderBottomColor: '#EED9C4',
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  headerTitleContainer: { flex: 1, alignItems: 'center' },
  diaryTitle: { fontSize: 28, fontWeight: '900', color: '#5D4037', letterSpacing: -1 },
  diaryOwner: { fontSize: 10, fontWeight: '800', color: '#C4A484', textTransform: 'uppercase', letterSpacing: 2, marginTop: -4 },
  addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#5D4037', justifyContent: 'center', alignItems: 'center', elevation: 4 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  entryCard: { 
    backgroundColor: 'white', 
    borderRadius: 15, 
    padding: 20, 
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#5D4037',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  dateBadge: { width: 45, height: 50, backgroundColor: '#FDF5E6', borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EED9C4' },
  dateDay: { fontSize: 18, fontWeight: '900', color: '#5D4037' },
  dateMonth: { fontSize: 9, fontWeight: '800', color: '#C4A484' },
  entryMood: { fontSize: 14, fontWeight: '700', color: '#5D4037' },
  entryTime: { fontSize: 11, color: '#C4A484', marginTop: 2 },
  lining: { borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 15 },
  entryContent: { fontSize: 15, lineHeight: 24, color: '#5D4037', fontStyle: 'italic' },
  emptyState: { alignItems: 'center', marginTop: SCREEN_HEIGHT * 0.2, gap: 15 },
  emptyText: { textAlign: 'center', color: '#C4A484', fontSize: 14, width: '70%', lineHeight: 22 },
  modalContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  editorPaper: { backgroundColor: 'white', height: SCREEN_HEIGHT * 0.8, borderRadius: 25, overflow: 'hidden', elevation: 10 },
  editorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  editorTitle: { fontSize: 18, fontWeight: '800', color: '#5D4037' },
  moodPicker: { flexDirection: 'row', justifyContent: 'center', gap: 20, padding: 15, backgroundColor: '#FAFAFA' },
  moodItem: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', elevation: 1 },
  moodSelected: { borderWidth: 2, borderColor: '#C4A484' },
  paperContent: { flex: 1, flexDirection: 'row' },
  redMargin: { width: 2, height: '100%', backgroundColor: '#FFBABA', marginLeft: 40, marginRight: 15 },
  diaryInput: { paddingVertical: 20, paddingRight: 20, fontSize: 18, lineHeight: 28, color: '#5D4037', textAlignVertical: 'top', fontStyle: 'italic', minHeight: 240 },
  stickerStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 14, paddingBottom: 30, paddingRight: 10 },
  stickerWrap: { width: 88, height: 88, borderRadius: 14, overflow: 'hidden', backgroundColor: 'rgba(196,164,132,0.08)' },
  stickerImg: { width: '100%', height: '100%' },
  cardStickerStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  cardStickerImg: { width: 48, height: 48, borderRadius: 10 },
});
