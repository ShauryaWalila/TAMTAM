import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, FlatList, Dimensions, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Coffee, Plus, X, CheckCircle2, Circle, Vote, ListTodo, Smile, BarChart3, Trash2, Sparkles, ChevronRight, MessageCircleHeart, Heart, Send, Ghost, RefreshCw, Gamepad2, Users, Trophy, Dice5, MessageSquare, List as ListIcon, StickyNote, Flame } from 'lucide-react-native';
import { View as ThemedView } from '@/components/Themed';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withRepeat, withTiming, Easing, interpolate, runOnJS, useDerivedValue } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { G, Path, Text as SvgText, Circle as SvgCircle, Rect as SvgRect, Line } from 'react-native-svg';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import LudoBoard from '@/components/ChillZone/LudoBoard';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_SIZE = (SCREEN_WIDTH - 60) / 2;

const ITEM_TYPES = [
  { id: 'checklist', label: 'To-Do', icon: CheckCircle2, color: '#34C759' },
  { id: 'poll', label: 'Poll', icon: Vote, color: '#FF9500' },
  { id: 'roulette', label: 'Spin', icon: RefreshCw, color: '#5856D6' },
  { id: 'ludo', label: 'Ludo', icon: Gamepad2, color: '#FF2D55' },
  { id: 'snakes', label: 'Snakes', icon: Gamepad2, color: '#FF2D55' },
  { id: 'tictactoe', label: 'TicTac', icon: Gamepad2, color: '#5856D6' },
  { id: 'truthordare', label: 'Party', icon: Flame, color: '#FF9500' },
  { id: 'match', label: 'Match', icon: Heart, color: '#AF52DE' },
  { id: 'list', label: 'List', icon: ListIcon, color: '#5AC8FA' },
  { id: 'tracker', label: 'Goal', icon: BarChart3, color: '#FF2D55' },
  { id: 'mood', label: 'Mood', icon: Smile, color: '#AF52DE' },
  { id: 'note', label: 'Wall', icon: StickyNote, color: '#FFCC00' },
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

  const [selectedCategory, setSelectedCategory] = useState<any | null>(null);
  const [isItemModalVisible, setIsItemModalVisible] = useState(false);
  const [chatItem, setChatItem] = useState<any | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [matchCelebration, setMatchCelebration] = useState<string | null>(null);
  
  const [newItemType, setNewItemType] = useState('checklist');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemOptions, setNewItemOptions] = useState<string[]>(['', '']);

  useEffect(() => {
    init();
    const catSub = supabase.channel('chill_cats').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_categories' }, fetchCategories).subscribe();
    const itemSub = supabase.channel('chill_items').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_items' }, fetchItems).subscribe();
    return () => { supabase.removeChannel(catSub); supabase.removeChannel(itemSub); };
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
    let content: any = { chat: [] };
    
    if (newItemType === 'mood') content = { ...content, mood: '😊', last_updated: new Date().toISOString() };
    else if (newItemType === 'tracker') {
      const p = newItemTitle.split(':');
      content = { ...content, current: 0, goal: parseInt(p[1]) || 10 };
    }
    else if (newItemType === 'note') content = { ...content, body: newItemTitle, color: '#FFF9C4' };
    else if (newItemType === 'tictactoe') content = { ...content, board: Array(9).fill(null), turn: currentUserId, winner: null };
    else if (newItemType === 'snakes') content = { ...content, p1: 1, p2: 1, turn: currentUserId, winner: null };
    else if (newItemType === 'ludo') content = { ...content, players: { p1: [0,0,0,0], p2: [0,0,0,0] }, turn: currentUserId, winner: null };
    else if (newItemType === 'truthordare') content = { ...content, mode: 'truth', prompt: 'Tell me a secret...', turn: currentUserId };
    else if (newItemType === 'match') content = { ...content, choices: newItemOptions.filter(o => o.trim() !== '').map(o => ({ text: o.trim(), swiped: {} })) };
    else content = { ...content, options: newItemOptions.filter(o => o.trim() !== '').map(o => ({ text: o.trim(), completed: false, votes: [] })) };

    const { error } = await supabase.from('chill_items').insert([{
      category_id: selectedCategory.id,
      type: newItemType,
      title: newItemType === 'note' ? 'New Wall Note' : newItemTitle.trim(),
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

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !chatItem) return;
    const newMessage = { user: currentUserId, text: chatMessage.trim(), time: new Date().toISOString() };
    const newContent = { ...chatItem.content, chat: [...(chatItem.content.chat || []), newMessage] };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', chatItem.id);
    setChatMessage('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const finalizeGame = async (item: any, winner: string) => {
    const newContent = { ...item.content, winner, chat: [] };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', item.id);
    Alert.alert("VICTORY! 🏆", `${winner.toUpperCase()} WON!`, [{ text: "End Match", onPress: () => {} }]);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.text }]}>Chill Zone</Text>
              <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Play, decide & connect ✨</Text>
            </View>
            <MessageCircleHeart color={theme.tint} size={32} />
          </View>

          <View style={styles.categoryGrid}>
            {categories.map((cat) => (
              <TouchableOpacity key={cat.id} onPress={() => setSelectedCategory(cat)} style={[styles.catCard, { width: CARD_SIZE, height: CARD_SIZE }]}>
                {cat.image_url ? <Image source={{ uri: cat.image_url }} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: cat.color + '20' }]} />}
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
                <View style={styles.catOverlay}>
                  <View style={[styles.catIconBox, { backgroundColor: cat.color }]}><Coffee size={20} color="white" /></View>
                  <View><Text style={styles.catName} numberOfLines={1}>{cat.name}</Text><Text style={styles.itemCount}>{items.filter(i => i.category_id === cat.id).length} items</Text></View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Modal visible={!!selectedCategory} animationType="slide">
          <ThemedView style={{ flex: 1 }}>
            <View style={[styles.modalHeaderFixed, { paddingTop: insets.top + 10, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.closeBtn}><X size={24} color={theme.text} /></TouchableOpacity>
              <Text style={[styles.modalTitle, { color: theme.text }]}>{selectedCategory?.name}</Text>
              <TouchableOpacity onPress={() => setIsItemModalVisible(true)} style={[styles.addBtn, { backgroundColor: selectedCategory?.color || theme.tint }]}><Plus size={20} color="white" /></TouchableOpacity>
            </View>

            <FlatList 
              data={items.filter(i => i.category_id === selectedCategory?.id)}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: 20, paddingBottom: 150 }}
              renderItem={({item}) => (
                <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={[styles.itemCard, { backgroundColor: theme.card, borderLeftColor: selectedCategory?.color, borderLeftWidth: 5 }]}>
                  <View style={styles.itemHeader}>
                    <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
                    <View style={{flexDirection:'row', gap: 15}}>
                      {['tictactoe', 'ludo', 'snakes', 'match', 'truthordare'].includes(item.type) && !item.content?.winner && (
                        <TouchableOpacity onPress={() => setChatItem(item)}>
                          <MessageSquare size={18} color={theme.tint} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity onPress={async () => await supabase.from('chill_items').delete().eq('id', item.id)}>
                        <Trash2 size={18} color="#FF3B30" opacity={0.4} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.gameContainer}>
                    {(item.type === 'tictactoe' || item.type === 'snakes' || item.type === 'ludo' || item.type === 'truthordare') && (
                      <Text style={[styles.turnLabel, { color: item.content.turn === currentUserId ? theme.tint : '#888' }]}>
                        {item.content.winner ? `${item.content.winner?.toUpperCase() || 'SYSTEM'} WON! 🏆` : `${item.content.turn?.toUpperCase() || 'PARTNER'}'S TURN`}
                      </Text>
                    )}
                    {item.type === 'tictactoe' && <TicTacToeComponent item={item} currentUserId={currentUserId} finalize={finalizeGame} theme={theme} />}
                    {item.type === 'snakes' && (
                      <SnakesBoard 
                        item={item} 
                        currentUserId={currentUserId} 
                        onMove={async (roll: number) => {
                          const isP1 = currentUserId === 'pratishth';
                          const pKey = isP1 ? 'p1' : 'p2';
                          const partnerId = isP1 ? 'love' : 'pratishth';
                          
                          let currentPos = item.content[pKey] || 1;
                          let nextPos = currentPos + roll;

                          // 1. EXACT WIN RULE
                          if (nextPos > 100) {
                            await supabase.from('chill_items').update({ content: { ...item.content, turn: partnerId } }).eq('id', item.id);
                            return;
                          }

                          // 2. SNAKES & LADDERS LOGIC
                          const LADDERS: { [key: number]: number } = { 2: 38, 7: 14, 8: 31, 15: 26, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 78: 98, 87: 94 };
                          const SNAKES: { [key: number]: number } = { 16: 6, 46: 25, 49: 11, 62: 19, 64: 60, 74: 53, 89: 68, 92: 88, 95: 75, 99: 80 };

                          if (LADDERS[nextPos]) nextPos = LADDERS[nextPos];
                          else if (SNAKES[nextPos]) nextPos = SNAKES[nextPos];

                          // 3. VICTORY CHECK
                          const winner = nextPos === 100 ? currentUserId : null;
                          
                          if (winner) {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            await supabase.from('chill_items').update({ content: { winner, chat: item.content.chat || [] } }).eq('id', item.id);
                          } else {
                            await supabase.from('chill_items').update({ content: { ...item.content, [pKey]: nextPos, turn: partnerId } }).eq('id', item.id);
                          }
                        }}
                      />
                    )}
                    {item.type === 'ludo' && (
                      <LudoBoard 
                        item={item} 
                        currentUserId={currentUserId} 
                        onMove={async (pawnIdx: number, roll: number, overridePKey?: string) => {
                          const isP1 = overridePKey ? overridePKey === 'p1' : currentUserId === 'pratishth';
                          const pKey = isP1 ? 'p1' : 'p2';
                          const oKey = isP1 ? 'p2' : 'p1';
                          const partnerId = isP1 ? 'love' : 'pratishth';
                          const newPawns = [...(item.content.players?.[pKey] || [0,0,0,0])];
                          const opponentPawns = [...(item.content.players?.[oKey] || [0,0,0,0])];
                          
                          // 1. AUTO-PASS (ZERO MOVES POSSIBLE)
                          if (pawnIdx === -1) { 
                            await supabase.from('chill_items').update({ content: { ...item.content, turn: partnerId } }).eq('id', item.id);
                            return;
                          }

                          let extraTurn = roll === 6;
                          const currentPos = newPawns[pawnIdx];

                          // 2. VALIDATION: CAN THIS SPECIFIC PAWN MOVE?
                          // If it can't, we simply ignore the tap and let the user try another one.
                          const canThisPawnMove = currentPos === 0 ? roll === 6 : currentPos + roll <= 57;
                          if (!canThisPawnMove) {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                            return; // Do NOT update turn, do NOT proceed.
                          }

                          // 3. EXECUTE MOVE
                          if (currentPos === 0) newPawns[pawnIdx] = 1;
                          else newPawns[pawnIdx] += roll;

                          // 4. VICTORY HAPTICS
                          if (newPawns[pawnIdx] === 57) {
                            extraTurn = true;
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                          }

                          // 5. KILL LOGIC
                          const myGlobalIdx = (newPawns[pawnIdx] - 1 + (isP1 ? 0 : 26)) % 52;
                          const isSafe = [1, 9, 14, 22, 27, 35, 40, 48].includes(myGlobalIdx);
                          if (newPawns[pawnIdx] <= 51 && !isSafe) {
                            opponentPawns.forEach((pos, idx) => {
                              if (pos > 0 && pos <= 51) {
                                const oppGlobalIdx = (pos - 1 + (isP1 ? 26 : 0)) % 52;
                                if (myGlobalIdx === oppGlobalIdx) {
                                  opponentPawns[idx] = 0; extraTurn = true;
                                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                }
                              }
                            });
                          }

                          const winner = newPawns.every(p => p === 57) ? (overridePKey ? (overridePKey === 'p1' ? 'pratishth' : 'love') : currentUserId) : null;
                          
                          if (winner) {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                            // 🚀 PURGE DATA: Only keep the winner to save space
                            await supabase.from('chill_items').update({ 
                              content: { winner, chat: item.content.chat || [] } 
                            }).eq('id', item.id);
                          } else {
                            await supabase.from('chill_items').update({ 
                              content: { ...item.content, players: { [pKey]: newPawns, [oKey]: opponentPawns }, turn: extraTurn ? (overridePKey ? (overridePKey === 'p1' ? 'pratishth' : 'love') : currentUserId) : partnerId } 
                            }).eq('id', item.id);
                          }
                        }}
                      />
                    )}
                    {item.type === 'truthordare' && <TruthOrDareComponent item={item} currentUserId={currentUserId} theme={theme} color={selectedCategory?.color} />}
                  </View>

                  {item.type === 'roulette' && <RouletteComponent item={item} color={selectedCategory?.color} theme={theme} />}
                  {item.type === 'match' && <MatchStack item={item} currentUserId={currentUserId} setMatch={setMatchCelebration} color={selectedCategory?.color} theme={theme} />}
                  {(item.type === 'checklist' || item.type === 'list' || item.type === 'poll') && <CollabListComponent item={item} currentUserId={currentUserId} color={selectedCategory?.color} theme={theme} />}

                  {item.type === 'mood' && (
                    <View style={styles.moodSection}>
                      <Text style={styles.currentMood}>{item.content.mood}</Text>
                      <View style={styles.moodGrid}>{MOODS.map(m => (<TouchableOpacity key={m} onPress={async () => await supabase.from('chill_items').update({ content: { ...item.content, mood: m } }).eq('id', item.id)} style={styles.moodBtn}><Text style={{fontSize: 20}}>{m}</Text></TouchableOpacity>))}</View>
                    </View>
                  )}

                  {item.type === 'tracker' && (
                    <View style={styles.trackerSection}>
                      <View style={styles.progressBar}><MotiView animate={{ width: `${(item.content.current/item.content.goal)*100}%` }} style={[styles.progressFill, { backgroundColor: selectedCategory?.color }]} /></View>
                      <TouchableOpacity onPress={async () => await supabase.from('chill_items').update({ content: { ...item.content, current: Math.min(item.content.goal, item.content.current + 1) } }).eq('id', item.id)} style={[styles.plusOne, { backgroundColor: selectedCategory?.color }]}><Plus size={16} color="white" /></TouchableOpacity>
                    </View>
                  )}

                  {item.type === 'note' && (
                    <View style={[styles.notePaper, { backgroundColor: item.content.color || '#FFF9C4' }]}>
                      <Text style={styles.noteText}>{item.content.body}</Text>
                      <Sparkles size={14} color="rgba(0,0,0,0.2)" style={{ position: 'absolute', bottom: 10, right: 10 }} />
                    </View>
                  )}

                  <Text style={[styles.itemAuthor, { color: theme.tabIconDefault }]}>CREATED BY {item.created_by?.toUpperCase() || 'SYSTEM'}</Text>
                </MotiView>
              )}
            />
          </ThemedView>

          <Modal visible={!!chatItem} transparent animationType="slide">
            <View style={styles.chatOverlay}>
              <BlurView intensity={100} tint={colorScheme} style={styles.chatContent}>
                <View style={styles.chatHeader}><Text style={[styles.chatTitle, { color: theme.text }]}>Game Chat</Text><TouchableOpacity onPress={() => setChatItem(null)}><X size={24} color={theme.text} /></TouchableOpacity></View>
                <FlatList data={chatItem?.content.chat || []} keyExtractor={(_, i) => i.toString()} renderItem={({item: msg}) => (<View style={[styles.msgBox, msg.user === currentUserId ? styles.myMsg : styles.theirMsg, { backgroundColor: msg.user === currentUserId ? theme.tint : theme.background }]}><Text style={[styles.msgText, { color: msg.user === currentUserId ? 'white' : theme.text }]}>{msg.text}</Text></View>)}/>
                <View style={styles.chatInputRow}><TextInput style={[styles.chatInput, { color: theme.text, backgroundColor: theme.background }]} placeholder="Say something..." value={chatMessage} onChangeText={setChatMessage} /><TouchableOpacity onPress={handleSendMessage} style={[styles.chatSendBtn, { backgroundColor: theme.tint }]}><Send size={18} color="white" /></TouchableOpacity></View>
              </BlurView>
            </View>
          </Modal>

          <AnimatePresence>
            {matchCelebration && (
              <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.celebOverlay}>
                <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
                <MotiView from={{ scale: 0.5 }} animate={{ scale: 1 }} style={styles.celebContent}>
                  <Heart size={100} color="#FF2D55" fill="#FF2D55" />
                  <Text style={styles.celebTitle}>ITS A MATCH!</Text>
                  <Text style={styles.celebSub}>You both agreed on: {matchCelebration}</Text>
                  <TouchableOpacity onPress={() => setMatchCelebration(null)} style={styles.celebClose}><Text style={styles.celebCloseText}>YAY! ❤️</Text></TouchableOpacity>
                </MotiView>
              </MotiView>
            )}
          </AnimatePresence>

          <Modal visible={isItemModalVisible} animationType="fade" transparent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
              <View style={styles.modalOverlay}>
                <BlurView intensity={100} tint={colorScheme} style={styles.itemModalContent}>
                  <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>New Shared Experience</Text><TouchableOpacity onPress={() => setIsItemModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View>
                  <View style={styles.typePicker}>{ITEM_TYPES.map(t => (<TouchableOpacity key={t.id} onPress={() => setNewItemType(t.id)} style={[styles.typeChip, newItemType === t.id && { backgroundColor: selectedCategory?.color + '20', borderColor: selectedCategory?.color, borderWidth: 1 }]}><t.icon size={18} color={newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault} /><Text style={[styles.typeText, { color: newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault }]}>{t.label}</Text></TouchableOpacity>))}</View>
                  <TextInput style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]} placeholder={newItemType === 'note' ? "Write your message..." : "Title or Goal?"} value={newItemTitle} onChangeText={setNewItemTitle} multiline={newItemType === 'note'} />
                  {['match', 'checklist', 'poll', 'list', 'roulette'].includes(newItemType) && (
                    <View style={{ gap: 8 }}>
                      {newItemOptions.map((opt, idx) => (<TextInput key={idx} style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background, height: 44 }]} placeholder={`Option ${idx+1}`} value={opt} onChangeText={(v) => { const n = [...newItemOptions]; n[idx] = v; setNewItemOptions(n); }} />))}
                      <TouchableOpacity onPress={() => setNewItemOptions([...newItemOptions, ''])}><Text style={{ color: selectedCategory?.color, fontWeight: '900' }}>+ Add Option</Text></TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity onPress={addItem} style={[styles.saveBtn, { backgroundColor: selectedCategory?.color }]}><Text style={styles.saveBtnText}>Activate for Us</Text></TouchableOpacity>
                </BlurView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </Modal>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

// 🎡 CUSTOM STABLE SVG ROULETTE
function RouletteComponent({ item, color, theme }: any) {
  const rotation = useSharedValue(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const options = item.content.options || [];

  const spin = () => {
    if (spinning || options.length === 0) return;
    setSpinning(true);
    setWinner(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const extraSpins = 5 + Math.random() * 5;
    const finalRotation = rotation.value + (extraSpins * 360);
    rotation.value = withTiming(finalRotation, { duration: 3000, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(handleFinish)(finalRotation);
    });
  };

  const handleFinish = (finalRot: number) => {
    setSpinning(false);
    const normalizedRot = finalRot % 360;
    const itemAngle = 360 / options.length;
    const idx = Math.floor((360 - normalizedRot) / itemAngle) % options.length;
    setWinner(options[idx].text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <View style={styles.rouletteWrapper}>
      <AnimatePresence>{winner && <MotiView from={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} style={[styles.winnerBadge, { backgroundColor: color }]}><Sparkles size={16} color="white" /><Text style={styles.winnerName}>{winner.toUpperCase()}</Text></MotiView>}</AnimatePresence>
      <View style={styles.wheelOuter}>
        <View style={styles.pointer} />
        <Animated.View style={[styles.wheelContainer, wheelStyle]}>
          <Svg width={220} height={220} viewBox="0 0 220 220">
            <G transform="translate(110, 110)">
              {options.map((opt: any, i: number) => {
                const angle = (2 * Math.PI) / options.length;
                const startAngle = i * angle - Math.PI / 2;
                const endAngle = (i + 1) * angle - Math.PI / 2;
                const x1 = 100 * Math.cos(startAngle);
                const y1 = 100 * Math.sin(startAngle);
                const x2 = 100 * Math.cos(endAngle);
                const y2 = 100 * Math.sin(endAngle);
                return (
                  <G key={i}>
                    <Path d={`M 0 0 L ${x1} ${y1} A 100 100 0 0 1 ${x2} ${y2} Z`} fill={i % 2 === 0 ? color : color + '40'} stroke="#fff" strokeWidth={2} />
                    <SvgText x={60 * Math.cos(startAngle + angle/2)} y={60 * Math.sin(startAngle + angle/2)} fill={theme.text} fontSize="10" fontWeight="bold" textAnchor="middle" transform={`rotate(${(i * (360/options.length)) + (360/options.length)/2 + 90}, ${60 * Math.cos(startAngle + angle/2)}, ${60 * Math.sin(startAngle + angle/2)})`}>
                      {opt.text.substring(0, 10)}
                    </SvgText>
                  </G>
                );
              })}
              <SvgCircle r={15} fill="#fff" />
            </G>
          </Svg>
        </Animated.View>
      </View>
      <TouchableOpacity onPress={spin} disabled={spinning} style={[styles.spinBtn, { backgroundColor: color, marginTop: 20 }]}>
        <Text style={styles.spinText}>{spinning ? 'DECIDING...' : 'SPIN THE WHEEL'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// 🎮 SHARED GAME COMPONENTS
function TicTacToeComponent({ item, currentUserId, finalize, theme }: any) {
  const handleMove = async (idx: number) => {
    if (item.content.board[idx] || item.content.winner || item.content.turn !== currentUserId) return;
    const newBoard = [...item.content.board];
    newBoard[idx] = currentUserId === 'pratishth' ? 'X' : 'O';
    const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    let winner = null;
    for (const [a,b,c] of wins) if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]) winner = currentUserId;
    if (winner) finalize(item, winner);
    else await supabase.from('chill_items').update({ content: { ...item.content, board: newBoard, turn: currentUserId === 'pratishth' ? 'love' : 'pratishth' } }).eq('id', item.id);
  };
  return (
    <View style={styles.proGameBox}>
      <View style={styles.tictacGrid}>{item.content.board.map((c:any, i:number) => (<TouchableOpacity key={i} onPress={() => handleMove(i)} style={[styles.tictacCell, { backgroundColor: theme.background }]}><Text style={[styles.tictacText, { color: c === 'X' ? '#FF2D55' : '#34C759' }]}>{c}</Text></TouchableOpacity>))}</View>
      {item.content.turn !== currentUserId && !item.content.winner && <BlurView intensity={20} tint="light" style={styles.waitOverlay}><ActivityIndicator color={theme.tint} /><Text style={styles.waitText}>Partner is thinking...</Text></BlurView>}
    </View>
  );
}

function SnakesComponent({ item, currentUserId, finalize, theme }: any) {
  const roll = async () => {
    if (item.content.winner || item.content.turn !== currentUserId) return;
    const r = Math.floor(Math.random() * 6) + 1;
    const isP1 = currentUserId === 'pratishth';
    const nextPos = Math.min(30, (isP1 ? item.content.p1 : item.content.p2) + r);
    if (nextPos === 30) finalize(item, currentUserId);
    else await supabase.from('chill_items').update({ content: { ...item.content, [isP1 ? 'p1' : 'p2']: nextPos, turn: isP1 ? 'love' : 'pratishth', last_roll: r } }).eq('id', item.id);
  };
  return (
    <View style={styles.proGameBox}>
      <View style={styles.snakeGrid}>
        {[...Array(30)].map((_, i) => { 
          const idx = 30-i; 
          return (
            <View key={idx} style={[styles.snakeCell, { backgroundColor: theme.background }]}>
              <Text style={styles.snakeIdx}>{idx}</Text>
              <>
                {item.content.p1 === idx && <View style={[styles.pawnDot, { backgroundColor: '#FF2D55' }]} />}
                {item.content.p2 === idx && <View style={[styles.pawnDot, { backgroundColor: '#34C759', bottom: 2 }]} />}
              </>
            </View>
          ); 
        })}
      </View>
      <TouchableOpacity onPress={roll} style={[styles.diceBtn, { backgroundColor: theme.text }]} disabled={item.content.turn !== currentUserId}>
        <Dice5 size={20} color={theme.background} />
      </TouchableOpacity>
    </View>
  );
}

function TruthOrDareComponent({ item, currentUserId, theme, color }: any) {
  const next = async (m: 'truth' | 'dare') => {
    if (item.content.turn !== currentUserId) return;
    const truths = ["Most embarrassing memory?", "One thing you love about me?", "Last lie you told?"];
    const dares = ["Send a goofy selfie right now", "Do 10 pushups", "Call me and say I love you"];
    const prompt = m === 'truth' ? truths[Math.floor(Math.random()*truths.length)] : dares[Math.floor(Math.random()*dares.length)];
    await supabase.from('chill_items').update({ content: { mode: m, prompt, turn: currentUserId === 'pratishth' ? 'love' : 'pratishth' } }).eq('id', item.id);
  };
  return (<View style={styles.truthBox}><View style={[styles.promptCard, { backgroundColor: color + '15' }]}><Text style={[styles.promptMode, { color }]}>{item.content.mode.toUpperCase()}</Text><Text style={[styles.promptText, { color: theme.text }]}>{item.content.prompt}</Text></View><View style={styles.truthActions}><TouchableOpacity onPress={() => next('truth')} style={[styles.truthBtn, { borderColor: color, borderWidth: 1 }]} disabled={item.content.turn !== currentUserId}><Text style={{color, fontWeight:'900'}}>TRUTH</Text></TouchableOpacity><TouchableOpacity onPress={() => next('dare')} style={[styles.truthBtn, { backgroundColor: color }]} disabled={item.content.turn !== currentUserId}><Text style={{color:'white', fontWeight:'900'}}>DARE</Text></TouchableOpacity></View></View>);
}

function MatchStack({ item, currentUserId, setMatch, color, theme }: any) {
  const handleSwipe = async (idx: number, val: boolean) => {
    const newChoices = [...item.content.choices];
    newChoices[idx].swiped[currentUserId] = val;
    const partnerId = currentUserId === 'pratishth' ? 'love' : 'pratishth';
    if (val === true && newChoices[idx].swiped[partnerId] === true) setMatch(newChoices[idx].text);
    await supabase.from('chill_items').update({ content: { ...item.content, choices: newChoices } }).eq('id', item.id);
  };
  return (<View style={styles.matchStack}>{item.content.choices.map((choice: any, idx: number) => { if (choice.swiped[currentUserId] !== undefined) return null; return (<View key={idx} style={[styles.matchCard, { backgroundColor: theme.background, borderColor: color+'40' }]}><Text style={[styles.matchText, { color: theme.text }]}>{choice.text}</Text><View style={styles.matchActions}><TouchableOpacity onPress={() => handleSwipe(idx, false)} style={styles.noBtn}><X size={24} color="#FF3B30" /></TouchableOpacity><TouchableOpacity onPress={() => handleSwipe(idx, true)} style={[styles.yesBtn, { backgroundColor: theme.tint }]}><Heart size={24} color="white" fill="white" /></TouchableOpacity></View></View>); })}</View>);
}

function CollabListComponent({ item, currentUserId, color, theme }: any) {
  const toggle = async (idx: number) => {
    const newOptions = [...item.content.options];
    newOptions[idx].completed = !newOptions[idx].completed;
    await supabase.from('chill_items').update({ content: { ...item.content, options: newOptions } }).eq('id', item.id);
  };
  return (<View style={styles.collabList}>{item.content.options?.map((opt: any, i: number) => (<TouchableOpacity key={i} onPress={() => toggle(i)} style={[styles.optionRow, { backgroundColor: theme.background }]}>{item.type === 'checklist' && (opt.completed ? <CheckCircle2 size={20} color={color} /> : <Circle size={20} color="#888" />)}<Text style={[styles.optionText, { color: theme.text, textDecorationLine: opt.completed ? 'line-through' : 'none' }]}>{opt.text}</Text></TouchableOpacity>))}</View>);
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
  modalHeaderFixed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  closeBtn: { padding: 8, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  addBtn: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  itemCard: { padding: 25, borderRadius: 35, marginBottom: 20, elevation: 3 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  itemTitle: { fontSize: 22, fontWeight: '800' },
  gameContainer: { alignItems: 'center', gap: 15 },
  turnLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  proGameBox: { width: '100%', alignItems: 'center', overflow: 'hidden', borderRadius: 20 },
  tictacGrid: { width: 210, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tictacCell: { width: 66, height: 66, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  tictacText: { fontSize: 28, fontWeight: '900' },
  ludoBoardGraphic: { width: 200, height: 200, borderRadius: 20, overflow: 'hidden', backgroundColor: '#fff', elevation: 2 },
  ludoPawn: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  pawnText: { color: 'white', fontSize: 10, fontWeight: '900' },
  snakeGrid: { width: 200, height: 120, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  snakeCell: { width: 38, height: 18, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  snakeIdx: { fontSize: 6, color: '#888' },
  pawnDot: { width: 6, height: 6, borderRadius: 3, position: 'absolute' },
  diceBtn: { padding: 12, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  diceText: { fontWeight: '900', fontSize: 12 },
  waitOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  waitText: { fontSize: 10, fontWeight: '900', color: '#000', marginTop: 5 },
  truthBox: { width: '100%', gap: 15 },
  promptCard: { padding: 25, borderRadius: 20, alignItems: 'center' },
  promptMode: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  promptText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  truthActions: { flexDirection: 'row', gap: 10 },
  truthBtn: { flex: 1, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  notePaper: { padding: 25, borderRadius: 10, elevation: 5, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, transform: [{ rotate: '-1deg' }] },
  noteText: { fontSize: 18, fontWeight: '700', color: '#333', fontStyle: 'italic' },
  moodSection: { alignItems: 'center', gap: 15 },
  currentMood: { fontSize: 50 },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  moodBtn: { padding: 10, borderRadius: 10, backgroundColor: 'rgba(150,150,150,0.1)' },
  trackerSection: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  progressBar: { flex: 1, height: 12, borderRadius: 6, backgroundColor: 'rgba(150,150,150,0.1)', overflow: 'hidden' },
  progressFill: { height: '100%' },
  plusOne: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  rouletteWrapper: { alignItems: 'center', gap: 25 },
  winnerBadge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, position: 'absolute', top: -50, zIndex: 100, flexDirection: 'row', alignItems: 'center', gap: 8 },
  winnerName: { color: 'white', fontWeight: '900', fontSize: 16 },
  wheelOuter: { width: 220, height: 220, justifyContent: 'center', alignItems: 'center' },
  wheelContainer: { width: 220, height: 220, borderRadius: 110, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  pointer: { position: 'absolute', top: -10, width: 0, height: 0, borderLeftWidth: 15, borderRightWidth: 15, borderTopWidth: 25, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#FF2D55', zIndex: 10 },
  spinBtn: { paddingHorizontal: 40, paddingVertical: 15, borderRadius: 20 },
  spinText: { color: 'white', fontWeight: '900' },
  matchStack: { height: 200, justifyContent: 'center', alignItems: 'center' },
  matchCard: { width: SCREEN_WIDTH - 100, padding: 20, borderRadius: 20, borderWidth: 2, alignItems: 'center', gap: 20 },
  matchText: { fontSize: 20, fontWeight: '900', textAlign: 'center' },
  matchActions: { flexDirection: 'row', gap: 30 },
  yesBtn: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  noBtn: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,0,0,0.1)' },
  collabList: { gap: 10, width: '100%' },
  optionRow: { padding: 15, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionText: { fontSize: 15, fontWeight: '600' },
  chatOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  chatContent: { height: '70%', borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 30, overflow: 'hidden' },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  chatTitle: { fontSize: 24, fontWeight: '900' },
  msgBox: { padding: 12, borderRadius: 18, maxWidth: '80%', marginBottom: 10 },
  myMsg: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirMsg: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  msgText: { fontWeight: '600', fontSize: 14 },
  chatInputRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  chatInput: { flex: 1, height: 50, borderRadius: 25, paddingHorizontal: 20, fontWeight: '600' },
  chatSendBtn: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  itemAuthor: { fontSize: 9, fontWeight: '900', marginTop: 25, opacity: 0.5, letterSpacing: 1 },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', padding: 20 },
  itemModalContent: { borderRadius: 40, padding: 30, gap: 20, overflow: 'hidden' },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, backgroundColor: 'rgba(150,150,150,0.1)' },
  typeText: { fontSize: 11, fontWeight: '900' },
  modalInput: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: 'white', fontWeight: '900', fontSize: 17 },
  celebOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  celebContent: { alignItems: 'center', padding: 40, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)' },
  celebTitle: { color: 'white', fontSize: 32, fontWeight: '900', marginTop: 20 },
  celebSub: { color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 5, textAlign: 'center' },
  celebClose: { marginTop: 40, padding: 15 },
  celebCloseText: { color: 'white', fontWeight: '900', fontSize: 18 }
});
