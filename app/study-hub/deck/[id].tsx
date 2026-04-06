import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, TextInput, Modal, Alert, Dimensions, Image, Pressable, Platform, ActivityIndicator } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { ChevronLeft, Plus, X, Brain, CheckCircle2, AlertCircle, Sparkles, Image as ImageIcon, Flame, History, Trophy, Rotate3d, Check, Ghost, Palette, Trash2, Repeat, FastForward } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  withTiming, 
  interpolate, 
  Extrapolate,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { addDays, format, isAfter, startOfDay } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;
const SKIP_THRESHOLD = SCREEN_HEIGHT * 0.15;

const RAINBOW = ['#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#8E8E93', '#000000'];

const calculateSRS = (result: 'correct' | 'incorrect', difficulty: 'hard' | 'good' | 'easy', currentInterval: number, currentEase: number) => {
  let newInterval = 1;
  let newEase = currentEase;
  if (result === 'incorrect') {
    newInterval = 1;
    newEase = Math.max(1.3, currentEase - 0.2);
  } else {
    if (currentInterval === 0) {
      newInterval = difficulty === 'easy' ? 4 : 1;
    } else {
      newInterval = Math.ceil(currentInterval * currentEase);
    }
    if (difficulty === 'easy') newEase += 0.1;
    if (difficulty === 'hard') newEase -= 0.1;
  }
  return { nextReview: addDays(new Date(), newInterval), interval: newInterval, ease: Math.max(1.3, newEase) };
};

export default function DeckDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [frontImg, setFrontImg] = useState<string | null>(null);
  const [backImg, setBackImg] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [reviewMode, setReviewMode] = useState<'due' | 'all'>('due');

  // Reanimated Shared Values
  const flipRotation = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const cardScale = useSharedValue(1);
  const cardOpacity = useSharedValue(1);
  const progressWidth = useSharedValue(0);
  const scrollOffset = useSharedValue(0);
  const maxScroll = useSharedValue(0);

  const onLayoutContent = (event: any) => {
    const { height } = event.nativeEvent.layout;
    if (height <= 0) return;
    const containerHeight = SCREEN_HEIGHT * 0.5;
    maxScroll.value = Math.max(0, height - containerHeight + 60); 
  };

  const scrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -scrollOffset.value }]
  }));

  const sliderHandleStyle = useAnimatedStyle(() => {
    const trackHeight = 200;
    const handleHeight = 60;
    const range = trackHeight - handleHeight;
    const pos = maxScroll.value > 0 ? (scrollOffset.value / maxScroll.value) * range : 0;
    return {
      transform: [{ translateY: pos }],
      opacity: maxScroll.value > 0 ? 1 : 0.3
    };
  });

  const sliderGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (maxScroll.value <= 0) return;
      const trackHeight = 200;
      const handleHeight = 60;
      const range = trackHeight - handleHeight;
      // Map touch position relative to track height
      let pos = e.y - (handleHeight / 2);
      pos = Math.max(0, Math.min(range, pos));
      scrollOffset.value = (pos / range) * maxScroll.value;
    });

  useEffect(() => { fetchDeckData(); }, [id]);

  const refreshFromSQLite = () => {
    try {
      const d = db.getFirstSync(`SELECT * FROM study_decks WHERE id = ?`, [id as string]) as any;
      if (d) setDeck(d);
      const c = db.getAllSync(`SELECT * FROM study_cards WHERE deck_id = ? ORDER BY next_review ASC`, [id as string]) as any[];
      if (c) {
        setCards(c.map(card => ({ ...card, options: card.options ? JSON.parse(card.options) : [] })));
      }
    } catch (e) {}
  };

  const fetchDeckData = async () => {
    refreshFromSQLite();
    try {
      const { data: deckData } = await supabase.from('study_decks').select('*').eq('id', id).single();
      if (deckData) {
        setDeck(deckData);
        db.runSync(`INSERT OR REPLACE INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
          [deckData.id, deckData.title, deckData.description, deckData.color, deckData.user_id, deckData.created_at]);
      }
      const { data: cardData } = await supabase.from('study_cards').select('*').eq('deck_id', id).order('next_review', { ascending: true });
      if (cardData) {
        cardData.forEach(c => {
          db.runSync(`INSERT OR REPLACE INTO study_cards (id, deck_id, front_content, back_content, front_image_url, back_image_url, options, custom_color, difficulty, correct_count, incorrect_count, skip_count, next_review, interval_days, ease_factor, review_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [c.id, c.deck_id, c.front_content, c.back_content, c.front_image_url, c.back_image_url, JSON.stringify(c.options || []), c.custom_color, c.difficulty, c.correct_count, c.incorrect_count, c.skip_count, c.next_review, c.interval_days, c.ease_factor, c.review_count, c.created_at]);
        });
      }
      refreshFromSQLite();
    } catch (e) {}
  };

  const dueCards = useMemo(() => {
    const today = startOfDay(new Date());
    return cards.filter(c => !isAfter(startOfDay(new Date(c.next_review)), today));
  }, [cards]);

  const cardsToReview = useMemo(() => reviewMode === 'due' ? dueCards : cards, [reviewMode, dueCards, cards]);

  const progressBarStyle = useAnimatedStyle(() => ({ width: `${progressWidth.value}%` }));
  const frontAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ rotateY: `${flipRotation.value}deg` }], backfaceVisibility: 'hidden' }));
  const backAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ rotateY: `${flipRotation.value + 180}deg` }], backfaceVisibility: 'hidden', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }));
  
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: cardScale.value },
      { rotate: `${interpolate(translateX.value, [-SCREEN_WIDTH, SCREEN_WIDTH], [-10, 10])}deg` }
    ],
    opacity: cardOpacity.value,
  }));

  const leftHintStyle = useAnimatedStyle(() => ({ opacity: withTiming(translateX.value < -50 ? 0.8 : 0), backgroundColor: '#FF3B30' }));
  const rightHintStyle = useAnimatedStyle(() => ({ opacity: withTiming(translateX.value > 50 ? 0.8 : 0), backgroundColor: '#34C759' }));
  const topHintStyle = useAnimatedStyle(() => ({ opacity: withTiming(translateY.value < -50 ? 0.8 : 0), backgroundColor: '#8E8E93' }));

  useEffect(() => {
    if (cardsToReview.length > 0) {
      const targetWidth = ((currentCardIdx + 1) / cardsToReview.length) * 100;
      progressWidth.value = withSpring(targetWidth, { damping: 20 });
    } else {
      progressWidth.value = 0;
    }
    scrollOffset.value = 0;
  }, [currentCardIdx, cardsToReview.length]);

  const pickImage = async (side: 'front' | 'back') => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.6 });
    if (!res.canceled) {
      if (side === 'front') setFrontImg(res.assets[0].uri);
      else setBackImg(res.assets[0].uri);
    }
  };

  const addCard = async () => {
    if (!front.trim() || !back.trim()) return;
    const cardId = generateUUID();
    const payload = { id: cardId, deck_id: id as string, front_content: front.trim(), back_content: back.trim(), front_image_url: frontImg, back_image_url: backImg, options: options.filter(o => o.trim() !== ''), custom_color: customColor, difficulty: null, next_review: new Date().toISOString(), interval_days: 0, ease_factor: 2.5, review_count: 0, created_at: new Date().toISOString() };
    try {
      db.runSync(`INSERT INTO study_cards (id, deck_id, front_content, back_content, front_image_url, back_image_url, options, custom_color, difficulty, next_review, interval_days, ease_factor, review_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.deck_id, payload.front_content, payload.back_content, payload.front_image_url, payload.back_image_url, JSON.stringify(payload.options), payload.custom_color, payload.difficulty, payload.next_review, payload.interval_days, payload.ease_factor, payload.review_count, payload.created_at]);
      queueSyncOperation('study_cards', payload.id, 'INSERT', payload);
      setFront(''); setBack(''); setFrontImg(null); setBackImg(null); setOptions([]); setCustomColor(null);
      setIsAddModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshFromSQLite();
    } catch (e) {}
  };

  const setDifficultyFirstTime = (rating: 'hard' | 'good' | 'easy') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const card = cardsToReview[currentCardIdx];
    try {
      db.runSync(`UPDATE study_cards SET difficulty = ? WHERE id = ?`, [rating, card.id]);
      setCards(prev => prev.map(c => c.id === card.id ? { ...c, difficulty: rating } : c));
      queueSyncOperation('study_cards', card.id, 'UPDATE', { difficulty: rating });
    } catch (e) {}
  };

  const finalizeReview = (result: 'correct' | 'incorrect' | 'skip') => {
    const card = cardsToReview[currentCardIdx];
    if (result === 'skip') {
      const newSkipCount = (card.skip_count || 0) + 1;
      try {
        db.runSync(`UPDATE study_cards SET skip_count = ? WHERE id = ?`, [newSkipCount, card.id]);
        queueSyncOperation('study_cards', card.id, 'UPDATE', { skip_count: newSkipCount });
      } catch (e) {}
      goToNextCard();
      return;
    }
    const finalDiff = card.difficulty || 'good';
    const { nextReview, interval, ease } = calculateSRS(result, finalDiff, card.interval_days, card.ease_factor);
    const updatedCount = (card.review_count || 0) + 1;
    const newCorrectCount = (card.correct_count || 0) + (result === 'correct' ? 1 : 0);
    const newIncorrectCount = (card.incorrect_count || 0) + (result === 'incorrect' ? 1 : 0);
    const nextReviewStr = nextReview.toISOString();
    try {
      db.runSync(`UPDATE study_cards SET next_review = ?, interval_days = ?, ease_factor = ?, review_count = ?, correct_count = ?, incorrect_count = ? WHERE id = ?`, [nextReviewStr, interval, ease, updatedCount, newCorrectCount, newIncorrectCount, card.id]);
      queueSyncOperation('study_cards', card.id, 'UPDATE', { next_review: nextReviewStr, interval_days: interval, ease_factor: ease, review_count: updatedCount, correct_count: newCorrectCount, incorrect_count: newIncorrectCount });
      goToNextCard();
    } catch (e) {}
  };

  const goToNextCard = () => {
    if (currentCardIdx < cardsToReview.length - 1) {
      translateX.value = 0; translateY.value = 0; cardScale.value = 1; flipRotation.value = 0;
      cardOpacity.value = 0; scrollOffset.value = 0;
      setIsFlipped(false); setSelectedOption(null); setCurrentCardIdx(prev => prev + 1);
      cardOpacity.value = withTiming(1, { duration: 200 });
    } else {
      Alert.alert("🎉 Done!", "You've finished your practice session!");
      setIsReviewing(false);
      refreshFromSQLite();
    }
  };

  const handleReview = (result: 'correct' | 'incorrect' | 'skip') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const destX = result === 'incorrect' ? -SCREEN_WIDTH * 1.5 : (result === 'correct' ? SCREEN_WIDTH * 1.5 : 0);
    const destY = result === 'skip' ? -SCREEN_HEIGHT * 1.5 : 0;
    const isSkip = result === 'skip';
    cardOpacity.value = withTiming(0, { duration: 250 });
    if (isSkip) {
      translateY.value = withTiming(destY, { duration: 250 }, (fin) => { if (fin) runOnJS(finalizeReview)(result); });
      translateX.value = withTiming(0, { duration: 250 });
    } else {
      translateX.value = withTiming(destX, { duration: 250 }, (fin) => { if (fin) runOnJS(finalizeReview)(result); });
      translateY.value = withTiming(0, { duration: 250 });
    }
  };

  const toggleFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsFlipped(!isFlipped);
    flipRotation.value = withSpring(isFlipped ? 0 : 180, { damping: 12, stiffness: 90 });
  };

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      // Horizontal swipe logic
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
        translateX.value = e.translationX;
        translateY.value = 0;
      } 
      // Vertical skip logic (Up)
      else if (e.translationY < 0) {
        translateX.value = 0;
        translateY.value = e.translationY;
      }
      cardScale.value = interpolate(Math.abs(e.translationX), [0, 200], [1, 0.95], Extrapolate.CLAMP);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD) {
        runOnJS(handleReview)(e.translationX > 0 ? 'correct' : 'incorrect');
      } else if (e.translationY < -SKIP_THRESHOLD) {
        runOnJS(handleReview)('skip');
      } else {
        cancelAnimation(translateX); cancelAnimation(translateY); cancelAnimation(cardScale); cancelAnimation(cardOpacity);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        cardScale.value = withSpring(1);
        cardOpacity.value = withTiming(1, { duration: 100 });
      }
    });

  if (!deck) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemedView style={[styles.container, { paddingTop: insets.top + 10 }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: theme.card }]}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 15 }}>
            <Text style={[styles.title, { color: theme.text }]}>{deck.title}</Text>
            <View style={styles.headerStats}>
              <View style={styles.miniBadge}><Flame size={10} color={theme.tint} /><Text style={styles.miniBadgeText}>{dueCards.length} DUE</Text></View>
              <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{cards.length} cards</Text>
            </View>
          </View>
          {!isReviewing && <TouchableOpacity onPress={() => setIsAddModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint }]}><Plus size={24} color="white" /></TouchableOpacity>}
        </View>

        {!isReviewing ? (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={[styles.statsCard, { backgroundColor: theme.card }]}>
              <View style={styles.statItem}><View style={[styles.statIcon, { backgroundColor: theme.tint + '15' }]}><Brain size={20} color={theme.tint} /></View><Text style={[styles.statValue, { color: theme.tint }]}>{dueCards.length}</Text><Text style={styles.statLabel}>Ready</Text></View>
              <View style={[styles.statDivider, { backgroundColor: theme.background }]} />
              <View style={styles.statItem}><View style={[styles.statIcon, { backgroundColor: '#34C75915' }]}><Trophy size={20} color="#34C759" /></View><Text style={[styles.statValue, { color: '#34C759' }]}>{cards.length - dueCards.length}</Text><Text style={styles.statLabel}>Mastered</Text></View>
              <View style={[styles.statDivider, { backgroundColor: theme.background }]} />
              <View style={styles.statItem}><View style={[styles.statIcon, { backgroundColor: '#FF950015' }]}><History size={20} color="#FF9500" /></View><Text style={[styles.statValue, { color: '#FF9500' }]}>{cards.length}</Text><Text style={styles.statLabel}>Total</Text></View>
            </View>
            <View style={styles.reviewOptions}>
              <TouchableOpacity activeOpacity={0.9} disabled={dueCards.length === 0} style={[styles.startBtn, { backgroundColor: theme.tint, flex: 1 }, dueCards.length === 0 && { opacity: 0.5 }]} onPress={() => { setReviewMode('due'); setIsReviewing(true); setCurrentCardIdx(0); setIsFlipped(false); flipRotation.value = 0; translateX.value = 0; translateY.value = 0; cardOpacity.value = 1; }}><Brain size={24} color="white" /><Text style={styles.startBtnText}>DUE TODAY</Text></TouchableOpacity>
              <TouchableOpacity activeOpacity={0.9} disabled={cards.length === 0} style={[styles.startBtn, { backgroundColor: theme.secondary, flex: 1 }, cards.length === 0 && { opacity: 0.5 }]} onPress={() => { setReviewMode('all'); setIsReviewing(true); setCurrentCardIdx(0); setIsFlipped(false); flipRotation.value = 0; translateX.value = 0; translateY.value = 0; cardOpacity.value = 1; }}><Repeat size={24} color="white" /><Text style={styles.startBtnText}>PRACTICE ALL</Text></TouchableOpacity>
            </View>
            {cards.map((card) => (
              <View key={card.id} style={[styles.cardItem, { backgroundColor: theme.card }]}>
                <View style={[styles.cardTag, { backgroundColor: card.custom_color || (isAfter(new Date(card.next_review), new Date()) ? '#34C759' : theme.tint) }]} />
                <View style={{ flex: 1 }}><Text style={[styles.cardFront, { color: theme.text }]} numberOfLines={1}>{card.front_content}</Text><Text style={[styles.cardNext, { color: theme.tabIconDefault }]}>{card.difficulty?.toUpperCase() || 'NEW'} • {format(new Date(card.next_review), 'MMM d')}</Text></View>
                <ChevronLeft size={16} color={theme.tabIconDefault} style={{ transform: [{ rotate: '180deg' }] }} />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.reviewContainer}>
            <View style={styles.reviewProgress}><View style={styles.progressBarBase}><Animated.View style={[styles.progressFill, { backgroundColor: theme.tint }, progressBarStyle]} /></View><View style={styles.progressLabelRow}><Text style={styles.progressLabel}>CARD {currentCardIdx + 1} / {cardsToReview.length}</Text><TouchableOpacity onPress={() => setIsReviewing(false)} style={styles.exitBtn}><X size={18} color="#888" /></TouchableOpacity></View></View>
            
            <View style={styles.deckStackContainer}>
              <GestureDetector gesture={swipeGesture}>
                <Animated.View style={[styles.cardStack, containerAnimatedStyle]}>
                  <Pressable onPress={toggleFlip} style={{ flex: 1 }}>
                    <View style={styles.cardContainer}>
                      <Animated.View style={[styles.flashcard, { backgroundColor: theme.card, borderColor: cardsToReview[currentCardIdx]?.custom_color || 'rgba(150,150,150,0.1)' }, frontAnimatedStyle]}>
                        <Animated.View pointerEvents="none" style={[styles.swipeHint, styles.hintLeft, leftHintStyle]}><Text style={styles.hintText}>INCORRECT</Text></Animated.View>
                        <Animated.View pointerEvents="none" style={[styles.swipeHint, styles.hintRight, rightHintStyle]}><Text style={styles.hintText}>CORRECT</Text></Animated.View>
                        <Animated.View pointerEvents="none" style={[styles.swipeHint, styles.hintTop, topHintStyle]}><Text style={styles.hintText}>SKIP</Text></Animated.View>
                        <View style={styles.cardVisibleArea}>
                          <Animated.View style={[styles.cardContentWrapper, scrollStyle]} onLayout={onLayoutContent}>
                            <Brain size={32} color={cardsToReview[currentCardIdx]?.custom_color || theme.tint} style={styles.cardIcon} />
                            {cardsToReview[currentCardIdx]?.front_image_url && <Image source={{ uri: cardsToReview[currentCardIdx].front_image_url }} style={styles.cardImage} resizeMode="contain" />}
                            <Text style={[styles.cardMainText, { color: theme.text }]}>{cardsToReview[currentCardIdx]?.front_content}</Text>
                            {cardsToReview[currentCardIdx]?.options?.length > 0 && (
                              <View style={styles.optionsGrid}>{cardsToReview[currentCardIdx].options.map((opt: string, i: number) => (
                                <TouchableOpacity key={i} style={[styles.optionBtn, { backgroundColor: theme.background }, selectedOption === i && { borderColor: theme.tint, borderWidth: 2 }]} onPress={() => { setSelectedOption(i); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}><Text style={[styles.optionBtnText, { color: theme.text }]}>{opt}</Text></TouchableOpacity>
                              ))}</View>
                            )}
                            <View style={styles.flipPrompt}><Rotate3d size={14} color={theme.tabIconDefault} /><Text style={styles.tapToFlip}>Tap to reveal</Text></View>
                          </Animated.View>
                        </View>
                      </Animated.View>
                      <Animated.View style={[styles.flashcard, styles.flashcardBack, { backgroundColor: theme.card, borderColor: cardsToReview[currentCardIdx]?.custom_color || 'rgba(150,150,150,0.1)' }, backAnimatedStyle]}>
                        <View style={styles.cardVisibleArea}>
                          <Animated.View style={[styles.cardContentWrapper, scrollStyle]}>
                            <Sparkles size={32} color="#FFCC00" style={styles.cardIcon} />
                            {cardsToReview[currentCardIdx]?.back_image_url && <Image source={{ uri: cardsToReview[currentCardIdx].back_image_url }} style={styles.cardImage} resizeMode="contain" />}
                            <Text style={[styles.cardMainText, { color: theme.text }]}>{cardsToReview[currentCardIdx]?.back_content}</Text>
                            <View style={styles.flipPrompt}><Rotate3d size={14} color={theme.tabIconDefault} /><Text style={styles.tapToFlip}>Tap to hide</Text></View>
                          </Animated.View>
                        </View>
                      </Animated.View>
                    </View>
                  </Pressable>
                </Animated.View>
              </GestureDetector>

              <GestureDetector gesture={sliderGesture}>
                <View style={styles.sliderTrack}><Animated.View style={[styles.sliderHandle, { backgroundColor: theme.tint }, sliderHandleStyle]} /></View>
              </GestureDetector>
            </View>

            <View style={styles.reviewFooter}>
              {!cardsToReview[currentCardIdx]?.difficulty ? (
                <View style={{ width: '100%', alignItems: 'center' }}>
                  <Text style={styles.difficultyLabel}>RATE DIFFICULTY (SET ONCE)</Text>
                  <View style={styles.manualActions}>
                    <TouchableOpacity onPress={() => setDifficultyFirstTime('hard')} style={[styles.manualBtn, { borderColor: '#FF3B30', borderWidth: 1 }]}><Text style={{color:'#FF3B30', fontWeight:'900'}}>HARD</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setDifficultyFirstTime('good')} style={[styles.manualBtn, { borderColor: theme.tint, borderWidth: 1 }]}><Text style={{color:theme.tint, fontWeight:'900'}}>GOOD</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setDifficultyFirstTime('easy')} style={[styles.manualBtn, { borderColor: '#34C759', borderWidth: 1 }]}><Text style={{color:'#34C759', fontWeight:'900'}}>EASY</Text></TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={{ width: '100%', alignItems: 'center' }}>
                  <Text style={styles.gestureHelp}>Swipe Left (Incorrect) • Up (Skip) • Right (Correct)</Text>
                  <View style={styles.manualActions}>
                    <TouchableOpacity onPress={() => handleReview('incorrect')} style={[styles.manualBtn, { borderColor: '#FF3B30', borderWidth: 1 }]}><X size={20} color="#FF3B30" /></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReview('skip')} style={[styles.manualBtn, { borderColor: '#8E8E93', borderWidth: 1 }]}><FastForward size={20} color="#8E8E93" /></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleReview('correct')} style={[styles.manualBtn, { borderColor: '#34C759', borderWidth: 1 }]}><Check size={20} color="#34C759" /></TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        <Modal visible={isAddModalVisible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsAddModalVisible(false)} />
            <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Add Cue Card</Text><TouchableOpacity onPress={() => setIsAddModalVisible(false)} style={styles.modalClose}><X size={20} color={theme.text} /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20 }}>
                <View style={styles.sideBySide}>
                  <View style={{ flex: 1 }}><Text style={styles.inputLabel}>PROMPT / QUESTION</Text><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Question..." multiline value={front} onChangeText={setFront} /><TouchableOpacity onPress={() => pickImage('front')} style={styles.imgPicker}>{frontImg ? <Image source={{ uri: frontImg }} style={styles.pickedImg} /> : <Text style={styles.imgPickerText}>Add Front Image</Text>}</TouchableOpacity></View>
                  <View style={{ flex: 1 }}><Text style={styles.inputLabel}>REVEAL / ANSWER</Text><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Answer..." multiline value={back} onChangeText={setBack} /><TouchableOpacity onPress={() => pickImage('back')} style={styles.imgPicker}>{backImg ? <Image source={{ uri: backImg }} style={styles.pickedImg} /> : <Text style={styles.imgPickerText}>Add Back Image</Text>}</TouchableOpacity></View>
                </View>
                <View><Text style={styles.inputLabel}>MULTIPLE CHOICE OPTIONS</Text>{options.map((opt, i) => (<View key={i} style={styles.optionInputRow}><TextInput style={[styles.input, { flex: 1, backgroundColor: theme.background, color: theme.text }]} value={opt} onChangeText={(t) => { const n = [...options]; n[i] = t; setOptions(n); }} /><TouchableOpacity onPress={() => setOptions(options.filter((_, idx) => idx !== i))}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity></View>))}<TouchableOpacity onPress={() => setOptions([...options, ''])} style={styles.addOptionBtn}><Plus size={16} color={theme.tint} /><Text style={{ color: theme.tint, fontWeight: 'bold' }}>Add Option</Text></TouchableOpacity></View>
                <TouchableOpacity onPress={addCard} style={[styles.saveBtn, { backgroundColor: theme.tint }]}><Text style={styles.saveBtnText}>Save to Deck</Text></TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 25 },
  backBtn: { width: 44, height: 44, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  headerStats: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  miniBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  miniBadgeText: { fontSize: 10, fontWeight: '900', color: '#666' },
  subtitle: { fontSize: 12, fontWeight: '700', opacity: 0.6 },
  addBtn: { width: 44, height: 44, borderRadius: 15, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  statsCard: { flexDirection: 'row', padding: 20, borderRadius: 28, marginBottom: 25, elevation: 2 },
  statItem: { flex: 1, alignItems: 'center', gap: 5 },
  statIcon: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900' },
  statLabel: { fontSize: 10, fontWeight: '800', color: '#888', textTransform: 'uppercase' },
  statDivider: { width: 1, height: 40, opacity: 0.1 },
  reviewOptions: { flexDirection: 'row', gap: 15, marginBottom: 25 },
  startBtn: { height: 65, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, elevation: 4 },
  startBtnText: { color: 'white', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  cardItem: { padding: 16, borderRadius: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', elevation: 1 },
  cardTag: { width: 4, height: 30, borderRadius: 2, marginRight: 15 },
  cardFront: { fontSize: 15, fontWeight: '700' },
  cardNext: { fontSize: 11, fontWeight: '600', marginTop: 2, textTransform: 'uppercase' },
  reviewContainer: { flex: 1, paddingHorizontal: 20 },
  reviewProgress: { marginBottom: 30 },
  progressBarBase: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  progressLabel: { fontSize: 11, fontWeight: '900', color: '#888', letterSpacing: 1 },
  exitBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.03)' },
  deckStackContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 40 },
  cardStack: { flex: 1, height: SCREEN_HEIGHT * 0.5 },
  cardVisibleArea: { flex: 1, height: '100%', overflow: 'hidden' },
  cardContentWrapper: { padding: 30, alignItems: 'center', width: '100%' },
  sliderTrack: { width: 30, height: 200, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 15, overflow: 'hidden', alignItems: 'center' },
  sliderHandle: { width: 10, height: 60, borderRadius: 5, marginTop: 0 },
  flashcard: { flex: 1, borderRadius: 40, elevation: 8, overflow: 'hidden', borderWidth: 2 },
  flashcardBack: { ...StyleSheet.absoluteFillObject },
  cardContainer: { flex: 1 },
  cardIcon: { marginBottom: 20, opacity: 0.2 },
  cardImage: { width: '100%', height: 180, borderRadius: 20, marginBottom: 20 },
  cardMainText: { fontSize: 24, fontWeight: '800', textAlign: 'center', lineHeight: 32, marginBottom: 20 },
  optionsGrid: { width: '100%', gap: 10, marginBottom: 40 },
  optionBtn: { padding: 15, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)' },
  optionBtnText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  flipPrompt: { paddingVertical: 20, flexDirection: 'row', alignItems: 'center', gap: 8 },
  tapToFlip: { fontSize: 11, fontWeight: '900', color: '#888', textTransform: 'uppercase', letterSpacing: 1.5 },
  swipeHint: { ...StyleSheet.absoluteFillObject, zIndex: 10, justifyContent: 'center', alignItems: 'center' },
  hintText: { color: 'white', fontSize: 32, fontWeight: '900', letterSpacing: 4 },
  reviewFooter: { marginBottom: 40, alignItems: 'center', gap: 20 },
  difficultyLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 2, marginBottom: 10 },
  gestureHelp: { fontSize: 10, fontWeight: '800', color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  manualActions: { flexDirection: 'row', gap: 15, width: '100%', justifyContent: 'center' },
  manualBtn: { flex: 1, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { height: '90%', padding: 25, borderTopLeftRadius: 40, borderTopRightRadius: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  modalClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  sideBySide: { flexDirection: 'row', gap: 15 },
  inputLabel: { fontSize: 11, fontWeight: '900', color: '#888', marginBottom: 10, letterSpacing: 1 },
  input: { padding: 15, borderRadius: 15, fontSize: 16, fontWeight: '600', textAlignVertical: 'top' },
  imgPicker: { height: 80, borderRadius: 15, borderStyle: 'dashed', borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  pickedImg: { width: '100%', height: '100%', borderRadius: 15 },
  imgPickerText: { fontSize: 10, fontWeight: '800', color: '#888' },
  optionInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 10 },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '900' }
});
