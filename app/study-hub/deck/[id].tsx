import React, { useEffect, useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Alert, Dimensions, Image } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { ChevronLeft, Plus, X, Brain, CheckCircle2, AlertCircle, Sparkles, Image as ImageIcon } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { MotiView, AnimatePresence } from 'moti';
import { addDays } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 🧠 SUPERMEMO-2 SRS ALGORITHM
const calculateSRS = (rating: 'hard' | 'good' | 'easy', currentInterval: number, currentEase: number) => {
  let newInterval = 1;
  let newEase = currentEase;

  if (rating === 'hard') {
    newInterval = 1;
    newEase = Math.max(1.3, currentEase - 0.2);
  } else if (rating === 'good') {
    newInterval = currentInterval === 0 ? 1 : Math.ceil(currentInterval * currentEase);
  } else if (rating === 'easy') {
    newInterval = currentInterval === 0 ? 4 : Math.ceil(currentInterval * currentEase * 1.3);
    newEase = currentEase + 0.1;
  }

  return {
    nextReview: addDays(new Date(), newInterval),
    interval: newInterval,
    ease: newEase
  };
};

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [deck, setDeck] = useState<any>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [isReviewing, setIsReviewing] = useState(false);
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  useEffect(() => {
    fetchDeckData();
  }, [id]);

  const fetchDeckData = async () => {
    const { data: deckData } = await supabase.from('study_decks').select('*').eq('id', id).single();
    if (deckData) setDeck(deckData);

    const { data: cardData } = await supabase.from('study_cards').select('*').eq('deck_id', id).order('next_review', { ascending: true });
    if (cardData) setCards(cardData);
  };

  const dueCards = useMemo(() => {
    return cards.filter(c => new Date(c.next_review) <= new Date());
  }, [cards]);

  const addCard = async () => {
    if (!front.trim() || !back.trim()) return;
    const { error } = await supabase.from('study_cards').insert([{
      deck_id: id,
      front_content: front.trim(),
      back_content: back.trim(),
    }]);

    if (!error) {
      setFront(''); setBack('');
      setIsAddModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchDeckData();
    }
  };

  const handleReview = async (rating: 'hard' | 'good' | 'easy') => {
    const card = dueCards[currentCardIdx];
    const { nextReview, interval, ease } = calculateSRS(rating, card.interval_days, card.ease_factor);

    await supabase.from('study_cards').update({
      next_review: nextReview.toISOString(),
      interval_days: interval,
      ease_factor: ease,
      review_count: (card.review_count || 0) + 1
    }).eq('id', card.id);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    if (currentCardIdx < dueCards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentCardIdx(prev => prev + 1), 300);
    } else {
      Alert.alert("🎉 Daily Goal Met!", "You've finished all due cards for this deck!");
      setIsReviewing(false);
      fetchDeckData();
    }
  };

  if (!deck) return null;

  return (
    <ThemedView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={28} color={theme.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[styles.title, { color: theme.text }]}>{deck.title}</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{cards.length} Total Cards</Text>
        </View>
        <TouchableOpacity onPress={() => setIsAddModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint }]}>
          <Plus size={24} color="white" />
        </TouchableOpacity>
      </View>

      {!isReviewing ? (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* STATS CARD */}
          <View style={[styles.statsCard, { backgroundColor: theme.card }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: theme.tint }]}>{dueCards.length}</Text>
              <Text style={styles.statLabel}>Due Now</Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: theme.background }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: '#34C759' }]}>{cards.length - dueCards.length}</Text>
              <Text style={styles.statLabel}>Learned</Text>
            </View>
          </View>

          {dueCards.length > 0 ? (
            <TouchableOpacity 
              style={[styles.startBtn, { backgroundColor: theme.tint }]}
              onPress={() => { setIsReviewing(true); setCurrentCardIdx(0); setIsFlipped(false); }}
            >
              <Brain size={24} color="white" />
              <Text style={styles.startBtnText}>START DAILY REVIEW</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyState}>
              <CheckCircle2 size={48} color="#34C759" opacity={0.5} />
              <Text style={[styles.emptyText, { color: theme.tabIconDefault }]}>You're all caught up for today!</Text>
            </View>
          )}

          <Text style={[styles.sectionTitle, { color: theme.text }]}>All Cards</Text>
          {cards.map(card => (
            <View key={card.id} style={[styles.cardItem, { backgroundColor: theme.card }]}>
              <Text style={[styles.cardFront, { color: theme.text }]} numberOfLines={1}>{card.front_content}</Text>
              <Text style={[styles.cardNext, { color: theme.tabIconDefault }]}>Next: {new Date(card.next_review).toLocaleDateString()}</Text>
            </View>
          ))}
        </ScrollView>
      ) : (
        /* REVIEW ENGINE */
        <View style={styles.reviewContainer}>
          <View style={styles.progressHeader}>
            <Text style={{ color: theme.tabIconDefault, fontWeight: '800' }}>CARD {currentCardIdx + 1} OF {dueCards.length}</Text>
            <TouchableOpacity onPress={() => setIsReviewing(false)}><X size={20} color={theme.tabIconDefault} /></TouchableOpacity>
          </View>

          <TouchableOpacity 
            activeOpacity={1} 
            onPress={() => { setIsFlipped(!isFlipped); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={styles.flashcardWrapper}
          >
            <MotiView 
              animate={{ rotateY: isFlipped ? '180deg' : '0deg' }}
              transition={{ type: 'spring', damping: 15 }}
              style={[styles.flashcard, { backgroundColor: theme.card }]}
            >
              {!isFlipped ? (
                <View style={styles.cardSide}>
                  <Brain size={40} color={theme.tint} opacity={0.2} style={{ marginBottom: 20 }} />
                  <Text style={[styles.cardMainText, { color: theme.text }]}>{dueCards[currentCardIdx].front_content}</Text>
                  <Text style={styles.tapToFlip}>Tap to flip</Text>
                </View>
              ) : (
                <View style={[styles.cardSide, { transform: [{ rotateY: '180deg' }] }]}>
                  <Sparkles size={40} color="#FFCC00" opacity={0.2} style={{ marginBottom: 20 }} />
                  <Text style={[styles.cardMainText, { color: theme.text }]}>{dueCards[currentCardIdx].back_content}</Text>
                  <Text style={styles.tapToFlip}>Tap to hide answer</Text>
                </View>
              )}
            </MotiView>
          </TouchableOpacity>

          <AnimatePresence>
            {isFlipped && (
              <MotiView 
                from={{ opacity: 0, translateY: 50 }} 
                animate={{ opacity: 1, translateY: 0 }}
                style={styles.srsActions}
              >
                <TouchableOpacity onPress={() => handleReview('hard')} style={[styles.srsBtn, { backgroundColor: '#FF3B30' }]}>
                  <Text style={styles.srsBtnText}>HARD</Text>
                  <Text style={styles.srsBtnSub}>1m</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleReview('good')} style={[styles.srsBtn, { backgroundColor: theme.tint }]}>
                  <Text style={styles.srsBtnText}>GOOD</Text>
                  <Text style={styles.srsBtnSub}>1d</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleReview('easy')} style={[styles.srsBtn, { backgroundColor: '#34C759' }]}>
                  <Text style={styles.srsBtnText}>EASY</Text>
                  <Text style={styles.srsBtnSub}>4d</Text>
                </TouchableOpacity>
              </MotiView>
            )}
          </AnimatePresence>
        </View>
      )}

      {/* ADD CARD MODAL */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>New Cue Card</Text>
              <TouchableOpacity onPress={() => setIsAddModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>FRONT (Question / Prompt)</Text>
              <TextInput 
                style={[styles.input, { backgroundColor: theme.background, color: theme.text, height: 120 }]} 
                placeholder="e.g. Branches of the Celiac Trunk?"
                placeholderTextColor={theme.tabIconDefault}
                multiline
                value={front}
                onChangeText={setFront}
              />
              <Text style={[styles.inputLabel, { marginTop: 20 }]}>BACK (Answer / Explanation)</Text>
              <TextInput 
                style={[styles.input, { backgroundColor: theme.background, color: theme.text, height: 120 }]} 
                placeholder="e.g. Left Gastric, Splenic, Common Hepatic"
                placeholderTextColor={theme.tabIconDefault}
                multiline
                value={back}
                onChangeText={setBack}
              />
              <TouchableOpacity onPress={addCard} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                <Text style={styles.saveBtnText}>Save Card</Text>
              </TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '900' },
  subtitle: { fontSize: 14, fontWeight: '600' },
  addBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 5 },
  scrollContent: { padding: 20, paddingBottom: 100 },
  statsCard: { flexDirection: 'row', padding: 25, borderRadius: 32, marginBottom: 25, alignItems: 'center' },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 32, fontWeight: '900' },
  statLabel: { fontSize: 12, fontWeight: '800', color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  statDivider: { width: 1, height: 40, opacity: 0.1 },
  startBtn: { height: 70, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 40, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, elevation: 5 },
  startBtnText: { color: 'white', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  emptyState: { alignItems: 'center', padding: 40, gap: 15 },
  emptyText: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  sectionTitle: { fontSize: 20, fontWeight: '800', marginBottom: 15 },
  cardItem: { padding: 20, borderRadius: 20, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardFront: { fontSize: 16, fontWeight: '700', flex: 1 },
  cardNext: { fontSize: 12, fontWeight: '600', marginLeft: 10 },
  reviewContainer: { flex: 1, padding: 20 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  flashcardWrapper: { flex: 1, marginBottom: 30 },
  flashcard: { flex: 1, borderRadius: 40, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, elevation: 5 },
  cardSide: { flex: 1, padding: 40, justifyContent: 'center', alignItems: 'center' },
  cardMainText: { fontSize: 28, fontWeight: '800', textAlign: 'center', lineHeight: 38 },
  tapToFlip: { position: 'absolute', bottom: 30, fontSize: 12, fontWeight: '800', color: '#888', textTransform: 'uppercase', letterSpacing: 2 },
  srsActions: { flexDirection: 'row', gap: 10, height: 80 },
  srsBtn: { flex: 1, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  srsBtnText: { color: 'white', fontSize: 16, fontWeight: '900' },
  srsBtnSub: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { height: '80%', padding: 30, borderTopLeftRadius: 40, borderTopRightRadius: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  inputLabel: { fontSize: 12, fontWeight: '900', color: '#888', marginBottom: 8, letterSpacing: 1 },
  input: { padding: 20, borderRadius: 24, fontSize: 16, fontWeight: '600', textAlignVertical: 'top' },
  saveBtn: { height: 65, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginTop: 30 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
