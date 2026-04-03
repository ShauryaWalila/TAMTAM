import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, FlatList, Dimensions, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Coffee, Plus, X, CheckCircle2, Circle, Vote, ListTodo, Smile, BarChart3, Trash2, Sparkles, ChevronRight, MessageCircleHeart, Heart, Send, Ghost, RefreshCw, PlusCircle, MinusCircle } from 'lucide-react-native';
import { View as ThemedView } from '@/components/Themed';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');
const CARD_SIZE = (width - 60) / 2;

const ITEM_TYPES = [
  { id: 'checklist', label: 'To-Do', icon: CheckCircle2, color: '#34C759' },
  { id: 'poll', label: 'Poll', icon: Vote, color: '#FF9500' },
  { id: 'roulette', label: 'Spin', icon: RefreshCw, color: '#5856D6' },
  { id: 'list', label: 'List', icon: ListTodo, color: '#5AC8FA' },
  { id: 'tracker', label: 'Goal', icon: BarChart3, color: '#FF2D55' },
  { id: 'mood', label: 'Mood', icon: Smile, color: '#AF52DE' },
];

const MOODS = ['😊', '🥰', '😴', '😤', '🥺', '🤯', '🍕', '🍷'];

export default function ChillZoneScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [categories, setCategories] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');

  // Modals
  const [selectedCategory, setSelectedCategory] = useState<any | null>(null);
  const [isItemModalVisible, setIsItemModalVisible] = useState(false);
  
  // New Item State
  const [newItemType, setNewItemType] = useState('checklist');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemGoal, setNewItemGoal] = useState('10'); 
  const [newItemOptions, setNewItemOptions] = useState<string[]>(['', '']);

  // Shared Edit State (Inline for lists)
  const [inlineInput, setInlineInput] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    init();
    const catSub = supabase.channel('chill_cats').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_categories' }, fetchCategories).subscribe();
    const itemSub = supabase.channel('chill_items').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_items' }, fetchItems).subscribe();
    
    return () => {
      supabase.removeChannel(catSub);
      supabase.removeChannel(itemSub);
    };
  }, []);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    if (name) setCurrentUserId(name);
    await Promise.all([fetchCategories(), fetchItems()]);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('chill_categories').select('*').order('created_at', { ascending: true });
    if (data) setCategories(data);
  };

  const fetchItems = async () => {
    const { data } = await supabase.from('chill_items').select('*').order('created_at', { ascending: false });
    if (data) setItems(data);
  };

  const addItem = async () => {
    if (!newItemTitle.trim() || !selectedCategory) return;
    
    let content: any = {};
    if (newItemType === 'mood') content = { mood: '😊', last_updated: new Date().toISOString() };
    else if (newItemType === 'tracker') content = { current: 0, goal: parseInt(newItemGoal) || 10 };
    else {
      // Checklist, Poll, List, and Roulette all use the 'options' structure for collaboration
      content = { 
        options: newItemOptions
          .filter(o => o.trim() !== '')
          .map(o => ({ 
            text: o.trim(), 
            completed: false, 
            votes: [] 
          })) 
      };
    }

    const { error } = await supabase.from('chill_items').insert([{
      category_id: selectedCategory.id,
      type: newItemType,
      title: newItemTitle.trim(),
      content,
      created_by: currentUserId
    }]);

    if (!error) {
      setIsItemModalVisible(false);
      setNewItemTitle('');
      setNewItemOptions(['', '']);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const addOptionToExistingItem = async (itemId: string, currentContent: any) => {
    const text = inlineInput[itemId];
    if (!text?.trim()) return;

    const newOptions = [...(currentContent.options || []), { text: text.trim(), completed: false, votes: [] }];
    const newContent = { ...currentContent, options: newOptions };

    const { error } = await supabase.from('chill_items').update({ content: newContent }).eq('id', itemId);
    if (!error) {
      setInlineInput({ ...inlineInput, [itemId]: '' });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const toggleOptionCheck = async (itemId: string, currentContent: any, optIdx: number) => {
    const newOptions = [...currentContent.options];
    newOptions[optIdx].completed = !newOptions[optIdx].completed;
    const newContent = { ...currentContent, options: newOptions };

    await supabase.from('chill_items').update({ content: newContent }).eq('id', itemId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeOption = async (itemId: string, currentContent: any, optIdx: number) => {
    const newOptions = currentContent.options.filter((_: any, i: number) => i !== optIdx);
    const newContent = { ...currentContent, options: newOptions };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', itemId);
  };

  const updateMood = async (item: any, mood: string) => {
    const newContent = { mood, last_updated: new Date().toISOString() };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', item.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const incrementTracker = async (item: any) => {
    const newContent = { ...item.content, current: Math.min(item.content.goal, item.content.current + 1) };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const spinRoulette = (item: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const options = item.content.options;
    if (!options || options.length === 0) {
      Alert.alert("Empty Wheel!", "Add some options first! ✨");
      return;
    }
    const winner = options[Math.floor(Math.random() * options.length)];
    Alert.alert("The Wheel Decided! 🎡", `Let's go with: ${winner.text}`);
  };

  const sendHug = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Virtual Hug Sent! 🤗", "Your partner will feel the love.");
  };

  if (loading) {
    return <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={theme.tint} /></ThemedView>;
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>Chill Zone</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Shared alignment & decisions ✨</Text>
          </View>
          <MessageCircleHeart color={theme.tint} size={32} />
        </View>

        <View style={styles.categoryGrid}>
          {categories.map((cat) => (
            <TouchableOpacity 
              key={cat.id} 
              onPress={() => setSelectedCategory(cat)}
              style={[styles.catCard, { width: CARD_SIZE, height: CARD_SIZE }]}
            >
              {cat.image_url ? (
                <Image source={{ uri: cat.image_url }} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: cat.color + '20' }]} />
              )}
              <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
              
              <View style={styles.catOverlay}>
                <View style={[styles.catIconBox, { backgroundColor: cat.color }]}>
                  <Coffee size={20} color="white" />
                </View>
                <View>
                  <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                  <Text style={styles.itemCount}>
                    {items.filter(i => i.category_id === cat.id).length} shared items
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* 📋 DETAIL MODAL */}
      <Modal visible={!!selectedCategory} animationType="slide">
        <ThemedView style={{ flex: 1 }}>
          <View style={[styles.modalHeaderFixed, { paddingTop: insets.top + 10, backgroundColor: selectedCategory?.bg_color || theme.background }]}>
            <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.closeBtn}><X size={24} color={theme.text} /></TouchableOpacity>
            <Text style={[styles.modalTitle, { color: theme.text }]}>{selectedCategory?.name}</Text>
            <TouchableOpacity onPress={() => setIsItemModalVisible(true)} style={[styles.addBtn, { backgroundColor: selectedCategory?.color || theme.tint }]}><Plus size={20} color="white" /></TouchableOpacity>
          </View>

          <FlatList 
            data={items.filter(i => i.category_id === selectedCategory?.id)}
            keyExtractor={i => i.id}
            contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
            renderItem={({item}) => (
              <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={[styles.itemCard, { backgroundColor: theme.card, borderLeftColor: selectedCategory?.color, borderLeftWidth: 5 }]}>
                
                <View style={styles.itemHeader}>
                  <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
                  <TouchableOpacity onPress={async () => await supabase.from('chill_items').delete().eq('id', item.id)}><Trash2 size={16} color="#FF3B30" opacity={0.4} /></TouchableOpacity>
                </View>

                {/* 📊 TRACKER */}
                {item.type === 'tracker' && (
                  <View style={styles.trackerContainer}>
                    <View style={[styles.progressBar, { backgroundColor: theme.background }]}>
                      <MotiView 
                        animate={{ width: `${(item.content.current / item.content.goal) * 100}%` }}
                        style={[styles.progressFill, { backgroundColor: selectedCategory?.color }]} 
                      />
                    </View>
                    <View style={styles.trackerFooter}>
                      <Text style={[styles.trackerText, { color: theme.text }]}>{item.content.current} / {item.content.goal} reached</Text>
                      <TouchableOpacity onPress={() => incrementTracker(item)} style={[styles.plusOne, { backgroundColor: selectedCategory?.color }]}><Plus size={16} color="white" /></TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* 🎭 MOOD CHECK */}
                {item.type === 'mood' && (
                  <View style={styles.moodContainer}>
                    <View style={styles.moodDisplay}>
                      <Text style={styles.currentMood}>{item.content.mood}</Text>
                      <View>
                        <Text style={[styles.moodLabel, { color: theme.text }]}>{item.created_by.toUpperCase()}'S MOOD</Text>
                        <Text style={[styles.moodTime, { color: theme.tabIconDefault }]}>Synced in real-time</Text>
                      </View>
                    </View>
                    <View style={styles.moodActions}>
                      {item.created_by === currentUserId ? (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.moodGrid}>
                          {MOODS.map(m => (
                            <TouchableOpacity key={m} onPress={() => updateMood(item, m)} style={[styles.moodBtn, item.content.mood === m && { backgroundColor: selectedCategory?.color + '20' }]}><Text style={{fontSize: 20}}>{m}</Text></TouchableOpacity>
                          ))}
                        </ScrollView>
                      ) : (
                        <TouchableOpacity onPress={sendHug} style={[styles.hugBtn, { backgroundColor: selectedCategory?.color }]}>
                          <Heart size={18} color="white" fill="white" />
                          <Text style={styles.hugBtnText}>Send Virtual Hug</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}

                {/* 📋 COLLABORATIVE LISTS (Checklist, Poll, List, Roulette) */}
                {(item.type === 'checklist' || item.type === 'poll' || item.type === 'list' || item.type === 'roulette') && (
                  <View style={styles.collabContainer}>
                    <View style={styles.optionList}>
                      {item.content.options?.map((opt: any, idx: number) => (
                        <View key={idx} style={[styles.optionItem, { backgroundColor: theme.background }]}>
                          {item.type === 'checklist' ? (
                            <TouchableOpacity onPress={() => toggleOptionCheck(item.id, item.content, idx)} style={styles.checkOptionRow}>
                              {opt.completed ? <CheckCircle2 size={20} color={selectedCategory?.color} /> : <Circle size={20} color={theme.tabIconDefault} />}
                              <Text style={[styles.optionText, { color: theme.text, textDecorationLine: opt.completed ? 'line-through' : 'none', opacity: opt.completed ? 0.5 : 1 }]}>{opt.text}</Text>
                            </TouchableOpacity>
                          ) : (
                            <Text style={[styles.optionText, { color: theme.text }]}>{opt.text}</Text>
                          )}
                          <TouchableOpacity onPress={() => removeOption(item.id, item.content, idx)} style={styles.removeOpt}><X size={14} color={theme.tabIconDefault} /></TouchableOpacity>
                        </View>
                      ))}
                    </View>
                    
                    {/* Inline Quick Add (Shared) */}
                    <View style={[styles.inlineAddRow, { borderTopColor: theme.tabIconDefault + '20' }]}>
                      <TextInput 
                        style={[styles.inlineInput, { color: theme.text }]}
                        placeholder={`Add to shared ${item.type}...`}
                        placeholderTextColor={theme.tabIconDefault}
                        value={inlineInput[item.id] || ''}
                        onChangeText={(v) => setInlineInput({ ...inlineInput, [item.id]: v })}
                      />
                      <TouchableOpacity onPress={() => addOptionToExistingItem(item.id, item.content)} style={[styles.inlineAddBtn, { backgroundColor: selectedCategory?.color }]}>
                        <Plus size={16} color="white" />
                      </TouchableOpacity>
                    </View>

                    {item.type === 'roulette' && item.content.options?.length > 0 && (
                      <TouchableOpacity onPress={() => spinRoulette(item)} style={[styles.spinBtn, { backgroundColor: selectedCategory?.color, marginTop: 15 }]}>
                        <RefreshCw size={18} color="white" />
                        <Text style={styles.spinText}>SPIN TO DECIDE</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <Text style={[styles.itemAuthor, { color: theme.tabIconDefault }]}>CREATED BY {item.created_by.toUpperCase()}</Text>
              </MotiView>
            )}
          />
        </ThemedView>

        {/* ➕ ADD ITEM MODAL */}
        <Modal visible={isItemModalVisible} animationType="fade" transparent>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={100} tint={colorScheme} style={styles.itemModalContent}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>New shared goal</Text>
                  <TouchableOpacity onPress={() => setIsItemModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
                </View>

                <View style={styles.typePicker}>
                  {ITEM_TYPES.map(t => (
                    <TouchableOpacity key={t.id} onPress={() => setNewItemType(t.id)} style={[styles.typeChip, newItemType === t.id && { backgroundColor: selectedCategory?.color + '20', borderColor: selectedCategory?.color, borderWidth: 1 }]}>
                      <t.icon size={18} color={newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault} />
                      <Text style={[styles.typeText, { color: newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]} placeholder="What is this about?" placeholderTextColor={theme.tabIconDefault} value={newItemTitle} onChangeText={setNewItemTitle} />

                {newItemType === 'tracker' && (
                  <TextInput style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]} placeholder="Target number (e.g. 10)" keyboardType="numeric" value={newItemGoal} onChangeText={setNewItemGoal} />
                )}

                {(newItemType !== 'mood' && newItemType !== 'tracker') && (
                  <View style={{ gap: 8 }}>
                    {newItemOptions.map((opt, idx) => (
                      <TextInput key={idx} style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background, height: 44 }]} placeholder={`Option ${idx+1}`} placeholderTextColor={theme.tabIconDefault} value={opt} onChangeText={(v) => { const n = [...newItemOptions]; n[idx] = v; setNewItemOptions(n); }} />
                    ))}
                    <TouchableOpacity onPress={() => setNewItemOptions([...newItemOptions, ''])}><Text style={{ color: selectedCategory?.color, fontWeight: '900' }}>+ Add Option</Text></TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity onPress={addItem} style={[styles.saveBtn, { backgroundColor: selectedCategory?.color }]}>
                  <Text style={styles.saveBtnText}>Create for both of us</Text>
                </TouchableOpacity>
              </BlurView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 44, fontWeight: '900', letterSpacing: -2 },
  subtitle: { fontSize: 18, fontWeight: '600', marginTop: -5 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, justifyContent: 'space-between' },
  catCard: { borderRadius: 32, overflow: 'hidden', elevation: 5 },
  catOverlay: { flex: 1, padding: 20, justifyContent: 'space-between' },
  catIconBox: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  catName: { fontSize: 18, fontWeight: '900', color: 'white' },
  itemCount: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  modalHeaderFixed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  closeBtn: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  addBtn: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  itemCard: { padding: 25, borderRadius: 30, marginBottom: 15, elevation: 2 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  itemTitle: { fontSize: 20, fontWeight: '800' },
  trackerContainer: { gap: 12 },
  progressBar: { height: 12, borderRadius: 6, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 6 },
  trackerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trackerText: { fontSize: 14, fontWeight: '700' },
  plusOne: { width: 32, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  moodContainer: { gap: 15 },
  moodDisplay: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  currentMood: { fontSize: 44 },
  moodLabel: { fontSize: 12, fontWeight: '900' },
  moodTime: { fontSize: 10, fontWeight: '600' },
  moodGrid: { gap: 10, paddingVertical: 10 },
  moodBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.05)' },
  hugBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 15, borderRadius: 18 },
  hugBtnText: { color: 'white', fontWeight: '900', fontSize: 14 },
  collabContainer: { gap: 10 },
  optionList: { gap: 8 },
  optionItem: { padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checkOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  optionText: { fontSize: 14, fontWeight: '600' },
  removeOpt: { padding: 5 },
  inlineAddRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 15, paddingTop: 15, borderTopWidth: 1 },
  inlineInput: { flex: 1, fontSize: 14, fontWeight: '600', height: 40 },
  inlineAddBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  spinBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 30, paddingVertical: 15, borderRadius: 20, alignSelf: 'center' },
  spinText: { color: 'white', fontWeight: '900' },
  itemAuthor: { fontSize: 9, fontWeight: '900', marginTop: 25, letterSpacing: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  itemModalContent: { borderRadius: 35, padding: 30, gap: 20, overflow: 'hidden' },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 18, backgroundColor: 'rgba(150,150,150,0.1)' },
  typeText: { fontSize: 12, fontWeight: '900' },
  modalInput: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10, elevation: 5 },
  saveBtnText: { color: 'white', fontWeight: '900', fontSize: 17 }
});
