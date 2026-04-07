import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Dimensions, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Plus, X, BookOpen, Clock, BrainCircuit, Trash2, Edit3, Save, Layers, Search, CheckCircle2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, Layout, FadeIn, FadeOut } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text, View as ThemedView } from '@/components/Themed';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// --- Helper: Reanimated Slider for Smooth Scrolling ---
const VerticalSlider = ({ total, currentIndex, onIndexChange, theme }: any) => {
  const sliderHeight = 200;
  const knobY = useSharedValue(0);
  useEffect(() => { knobY.value = withSpring((currentIndex / Math.max(1, total - 1)) * sliderHeight); }, [currentIndex]);
  return (
    <View style={styles.sliderContainer}>
      <View style={[styles.sliderTrack, { backgroundColor: theme.tabIconDefault + '20' }]}>
        <Animated.View style={[styles.sliderKnob, { backgroundColor: theme.tint, transform: [{ translateY: knobY }] }]} />
      </View>
    </View>
  );
};

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];

  const [deck, setDeck] = useState<any>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search UI State
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [isModalVisible, setIsAddModalVisible] = useState(false);
  const [editingCard, setEditingCard] = useState<any>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [frontImage, setFrontImage] = useState<string | null>(null);

  // Review State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  useEffect(() => { fetchDeckData(); }, [id]);

  const fetchDeckData = async () => {
    try {
      const localDeck = db.getFirstSync(`SELECT * FROM study_decks WHERE id = ?`, [id as string]);
      if (localDeck) setDeck(localDeck);
      const localCards = db.getAllSync(`SELECT * FROM study_cards WHERE deck_id = ? ORDER BY created_at ASC`, [id as string]);
      setCards(localCards || []);
    } catch (e) {} finally { setLoading(false); }
  };

  const filteredCards = useMemo(() => {
    if (!searchQuery.trim()) return cards;
    const q = searchQuery.toLowerCase();
    return cards.filter(c => c.front_content?.toLowerCase().includes(q) || c.back_content?.toLowerCase().includes(q));
  }, [cards, searchQuery]);

  const saveCard = () => {
    if (!front.trim() || !back.trim()) return;
    const cardId = editingCard ? editingCard.id : generateUUID();
    const now = new Date().toISOString();
    const payload = { id: cardId, deck_id: id, front_content: front, back_content: back, front_image_url: frontImage, updated_at: now, created_at: editingCard?.created_at || now };
    
    try {
      if (editingCard) {
        db.runSync(`UPDATE study_cards SET front_content = ?, back_content = ?, front_image_url = ? WHERE id = ?`, [front, back, frontImage, cardId]);
        queueSyncOperation('study_cards', cardId, 'UPDATE', payload);
      } else {
        db.runSync(`INSERT INTO study_cards (id, deck_id, front_content, back_content, front_image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [cardId, id, front, back, frontImage, now]);
        queueSyncOperation('study_cards', cardId, 'INSERT', payload);
      }
      setIsAddModalVisible(false); setEditingCard(null); setFront(''); setBack(''); setFrontImage(null);
      fetchDeckData(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) { Alert.alert("Error", "Failed to save card"); }
  };

  const deleteCard = (cardId: string) => {
    Alert.alert("Delete Card?", "This action cannot be undone.", [
      { text: "Cancel" },
      { text: "Delete", style: 'destructive', onPress: () => {
        db.runSync(`DELETE FROM study_cards WHERE id = ?`, [cardId]);
        queueSyncOperation('study_cards', cardId, 'DELETE', {});
        fetchDeckData(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.5 });
    if (!result.canceled) setFrontImage(result.assets[0].uri);
  };

  const handleReviewResult = (result: 'correct' | 'incorrect' | 'skip') => {
    const card = cards[currentIndex];
    const update = { last_result: result, updated_at: new Date().toISOString() };
    if (result === 'correct') (update as any).correct_count = (card.correct_count || 0) + 1;
    if (result === 'incorrect') (update as any).incorrect_count = (card.incorrect_count || 0) + 1;
    if (result === 'skip') (update as any).skip_count = (card.skip_count || 0) + 1;

    db.runSync(`UPDATE study_cards SET last_result = ?, correct_count = correct_count + ?, incorrect_count = incorrect_count + ?, skip_count = skip_count + ? WHERE id = ?`, 
      [result, result === 'correct' ? 1 : 0, result === 'incorrect' ? 1 : 0, result === 'skip' ? 1 : 0, card.id]);
    queueSyncOperation('study_cards', card.id, 'UPDATE', update);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < cards.length - 1) { setCurrentIndex(c => c + 1); setIsFlipped(false); }
    else { Alert.alert("Deck Complete!", "You've reviewed all cards."); setCurrentIndex(0); setIsFlipped(false); }
    fetchDeckData();
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator color={theme.tint} /></View>;

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{deck?.title || "Deck"}</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{cards.length} Cards</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => { setIsSearchVisible(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={styles.headerBtn}><Search size={20} color={theme.text} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setIsAddModalVisible(true)} style={[styles.headerBtn, { backgroundColor: theme.tint }]}><Plus size={20} color="#fff" /></TouchableOpacity>
          </View>
        </View>

        <AnimatePresence>
          {isSearchVisible && (
            <MotiView 
              from={{ opacity: 0, height: 0, marginTop: 0 }} 
              animate={{ opacity: 1, height: 46, marginTop: 10 }} 
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              style={[styles.searchBar, { backgroundColor: theme.card }]}
            >
              <Search size={18} color={theme.tabIconDefault} />
              <TextInput 
                style={[styles.searchInput, { color: theme.text }]} 
                placeholder="Search card content..." 
                placeholderTextColor={theme.tabIconDefault}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              <TouchableOpacity onPress={() => { setIsSearchVisible(false); setSearchQuery(''); }} style={styles.closeSearch}><X size={18} color={theme.text} /></TouchableOpacity>
            </MotiView>
          )}
        </AnimatePresence>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* REVIEW SECTION (If cards exist and not searching) */}
        {!searchQuery && cards.length > 0 && (
          <View style={styles.reviewSection}>
            <View style={styles.reviewHeader}>
              <View style={styles.reviewStats}>
                <View style={[styles.statBadge, { backgroundColor: '#34C75920' }]}><Text style={{ color: '#34C759', fontWeight: '800', fontSize: 10 }}>{cards[currentIndex]?.correct_count || 0} Correct</Text></View>
                <View style={[styles.statBadge, { backgroundColor: '#FF3B3020' }]}><Text style={{ color: '#FF3B30', fontWeight: '800', fontSize: 10 }}>{cards[currentIndex]?.incorrect_count || 0} Wrong</Text></View>
              </View>
              <Text style={styles.counter}>{currentIndex + 1} / {cards.length}</Text>
            </View>

            <TouchableOpacity activeOpacity={0.9} onPress={() => { setIsFlipped(!isFlipped); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} style={[styles.flashcard, { backgroundColor: theme.card }]}>
              <MotiView animate={{ rotateY: isFlipped ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: 300 }} style={styles.cardContent}>
                {!isFlipped ? (
                  <View style={styles.cardFace}>
                    <Text style={[styles.cardLabel, { color: theme.tabIconDefault }]}>QUESTION</Text>
                    <Text style={[styles.cardText, { color: theme.text }]}>{cards[currentIndex]?.front_content}</Text>
                  </View>
                ) : (
                  <View style={[styles.cardFace, { transform: [{ rotateY: '180deg' }] }]}>
                    <Text style={[styles.cardLabel, { color: theme.tint }]}>ANSWER</Text>
                    <Text style={[styles.cardText, { color: theme.text }]}>{cards[currentIndex]?.back_content}</Text>
                  </View>
                )}
              </MotiView>
            </TouchableOpacity>

            <View style={styles.actionRow}>
              <TouchableOpacity onPress={() => handleReviewResult('incorrect')} style={[styles.reviewBtn, { backgroundColor: '#FF3B30' }]}><X size={24} color="#fff" /></TouchableOpacity>
              <TouchableOpacity onPress={() => handleReviewResult('skip')} style={[styles.reviewBtn, { backgroundColor: theme.tabIconDefault }]}><Clock size={24} color="#fff" /></TouchableOpacity>
              <TouchableOpacity onPress={() => handleReviewResult('correct')} style={[styles.reviewBtn, { backgroundColor: '#34C759' }]}><CheckCircle2 size={24} color="#fff" /></TouchableOpacity>
            </View>
          </View>
        )}

        {/* LIST SECTION (Filtered) */}
        <View style={styles.listHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{searchQuery ? 'Search Results' : 'All Cards'}</Text>
        </View>

        {filteredCards.map((card, idx) => (
          <TouchableOpacity 
            key={card.id} 
            onPress={() => { setEditingCard(card); setFront(card.front_content); setBack(card.back_content); setFrontImage(card.front_image_url); setIsAddModalVisible(true); }}
            style={[styles.cardListItem, { backgroundColor: theme.card }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemFront, { color: theme.text }]} numberOfLines={1}>{card.front_content}</Text>
              <Text style={[styles.itemBack, { color: theme.tabIconDefault }]} numberOfLines={1}>{card.back_content}</Text>
            </View>
            <TouchableOpacity onPress={() => deleteCard(card.id)} style={styles.itemDelete}><Trash2 size={18} color="#FF3B30" opacity={0.5} /></TouchableOpacity>
          </TouchableOpacity>
        ))}

        {filteredCards.length === 0 && (
          <View style={styles.empty}><Layers size={40} color={theme.tabIconDefault} opacity={0.2} /><Text style={styles.emptyText}>No cards found</Text></View>
        )}
      </ScrollView>

      {/* ADD/EDIT MODAL */}
      <Modal visible={isModalVisible} transparent animationType="slide">
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}><View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
            <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={styles.mHeader}><Text style={[styles.mTitle, { color: theme.text }]}>{editingCard ? 'Edit Card' : 'New Card'}</Text><TouchableOpacity onPress={() => setIsAddModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Question..." value={front} onChangeText={setFront} multiline numberOfLines={3} />
              <TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Answer..." value={back} onChangeText={setBack} multiline numberOfLines={3} />
              <TouchableOpacity onPress={saveCard} style={[styles.saveBtn, { backgroundColor: theme.tint }]}><Text style={styles.saveBtnText}>Save Card</Text></TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View></TouchableWithoutFeedback>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontWeight: '700' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderRadius: 14, overflow: 'hidden' },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, fontWeight: '600' },
  closeSearch: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20, paddingBottom: 100 },
  reviewSection: { marginBottom: 30 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  reviewStats: { flexDirection: 'row', gap: 8 },
  statBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  counter: { fontSize: 12, fontWeight: '800', color: '#888' },
  flashcard: { height: 220, borderRadius: 30, padding: 25, elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20 },
  cardContent: { flex: 1 },
  cardFace: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  cardLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 15 },
  cardText: { fontSize: 20, fontWeight: '700', textAlign: 'center', lineHeight: 28 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 20 },
  reviewBtn: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  listHeader: { marginBottom: 15 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  cardListItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 18, marginBottom: 10, elevation: 2 },
  itemFront: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  itemBack: { fontSize: 13, fontWeight: '500' },
  itemDelete: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center', marginTop: 40 },
  emptyText: { fontSize: 14, color: '#888', fontWeight: '600', marginTop: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { padding: 30, borderTopLeftRadius: 40, borderTopRightRadius: 40, gap: 20 },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mTitle: { fontSize: 22, fontWeight: '900' },
  input: { padding: 20, borderRadius: 20, fontSize: 16, fontWeight: '600' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
