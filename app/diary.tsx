import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, TextInput, ScrollView, Dimensions, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ImageBackground, Modal } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus, X, Save, Trash2, Heart, Moon, Sun, Cloud, Calendar as CalIcon } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

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

  const saveEntry = async () => {
    if (!content.trim()) return;
    
    const payload = {
      user_id: username,
      content: content.trim(),
      mood: selectedMood,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (currentEntry) {
      const { error: err } = await supabase.from('user_diary').update(payload).eq('id', currentEntry.id);
      error = err;
    } else {
      const { error: err } = await supabase.from('user_diary').insert([payload]);
      error = err;
    }

    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsEditing(false);
      setContent('');
      setCurrentEntry(null);
      fetchEntries(username);
    } else {
      Alert.alert('Error', 'Could not save your thoughts.');
    }
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
    setIsEditing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              <TouchableOpacity activeOpacity={0.7} onPress={() => openEditor(entry)}>
                <View style={styles.entryHeader}>
                  <View style={styles.dateBadge}>
                    <Text style={styles.dateDay}>{format(new Date(entry.created_at), 'dd')}</Text>
                    <Text style={styles.dateMonth}>{format(new Date(entry.created_at), 'MMM').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 15 }}>
                    <Text style={styles.entryMood}>Feeling {entry.mood}</Text>
                    <Text style={styles.entryTime}>{format(new Date(entry.created_at), 'hh:mm a')}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteEntry(entry.id)}>
                    <Trash2 size={18} color="#C4A484" opacity={0.5} />
                  </TouchableOpacity>
                </View>
                <View style={styles.lining}>
                  <Text style={styles.entryContent} numberOfLines={4}>{entry.content}</Text>
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
              <TouchableOpacity onPress={() => setIsEditing(false)}><X size={24} color="#5D4037" /></TouchableOpacity>
              <Text style={styles.editorTitle}>{currentEntry ? 'Editing Memory' : 'New Thought'}</Text>
              <TouchableOpacity onPress={saveEntry}><Save size={24} color="#5D4037" /></TouchableOpacity>
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
              <TextInput
                style={styles.diaryInput}
                multiline
                placeholder="Write here..."
                placeholderTextColor="#A0A0A0"
                value={content}
                onChangeText={setContent}
                autoFocus
              />
            </View>
          </View>
        </View>
      </Modal>
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
  diaryInput: { flex: 1, paddingVertical: 20, paddingRight: 20, fontSize: 18, lineHeight: 28, color: '#5D4037', textAlignVertical: 'top', fontStyle: 'italic' }
});
