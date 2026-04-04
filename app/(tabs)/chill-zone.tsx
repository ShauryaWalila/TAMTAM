import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, FlatList, Dimensions, Image, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Coffee, Plus, X, CheckCircle2, Circle, Vote, ListTodo, Smile, BarChart3, Trash2, Sparkles, ChevronRight, MessageCircleHeart, Heart, Send, Ghost, RefreshCw, Gamepad2, Users, Trophy, Dice5, MessageSquare, List as ListIcon, StickyNote, Flame, Bug, ChevronLeft, Pencil, Settings2, Clock, MapPin, Bell, BellOff, Calendar } from 'lucide-react-native';
import { View as ThemedView } from '@/components/Themed';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withRepeat, withTiming, Easing, interpolate, runOnJS, useDerivedValue, withDelay } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { G, Path, Text as SvgText, Circle as SvgCircle, Rect as SvgRect, Line } from 'react-native-svg';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import DateTimePicker from '@react-native-community/datetimepicker';
import LudoBoard from '@/components/ChillZone/LudoBoard';
import SnakesBoard from '@/components/ChillZone/SnakesBoard';
import TicTacToeBoard from '@/components/ChillZone/TicTacToeBoard';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';

import { syncAllNotifications } from '@/lib/notifications';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_SIZE = (SCREEN_WIDTH - 60) / 2;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
});

const ITEM_TYPES = [
  { id: 'reminder', label: 'Task/Remind', icon: Bell, color: '#5856D6' },
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

const FIXED_CATEGORIES = [
  { id: '479739cf-1f54-4020-a5ad-dad274a5c8a9', name: 'Tasks & Reminders', color: '#5856D6', image_url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?q=80&w=2068&auto=format&fit=crop' }
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
  const [activeAlert, setActiveAlert] = useState<any | null>(null);
  
  const [newItemType, setNewItemType] = useState('checklist');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemOptions, setNewItemOptions] = useState<string[]>(['', '']);
  const [remType, setRemType] = useState<'time' | 'location'>('time');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<any | null>(null);
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);

  useEffect(() => {
    init();
    const catSub = supabase.channel('chill_cats').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_categories' }, fetchCategories).subscribe();
    const itemSub = supabase.channel('chill_items').on('postgres_changes', { event: '*', schema: 'public', table: 'chill_items' }, fetchItems).subscribe();
    
    const notifSub = Notifications.addNotificationReceivedListener(notification => {
      setActiveAlert(notification.request.content);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });

    return () => { supabase.removeChannel(catSub); supabase.removeChannel(itemSub); notifSub.remove(); };
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
    if (newItemType === 'reminder') content = { ...content, remType, start_at: startDate.toISOString(), end_at: endDate ? endDate.toISOString() : null, location: selectedLoc, active: true };
    else if (newItemType === 'mood') content = { ...content, mood: '😊', last_updated: new Date().toISOString() };
    else if (newItemType === 'tracker') { const p = newItemTitle.split(':'); content = { ...content, current: 0, goal: parseInt(p[1]) || 10 }; }
    else if (newItemType === 'note') content = { ...content, body: newItemTitle, color: '#FFF9C4' };
    else if (newItemType === 'tictactoe') content = { ...content, board: Array(9).fill(null), turn: currentUserId, winner: null };
    else if (newItemType === 'snakes') content = { ...content, p1: 1, p2: 1, turn: currentUserId, winner: null };
    else if (newItemType === 'ludo') content = { ...content, players: { p1: [0,0,0,0], p2: [0,0,0,0] }, turn: currentUserId, winner: null };
    else if (newItemType === 'truthordare') content = { ...content, mode: null, prompt: null, turn: currentUserId };
    else if (newItemType === 'match') content = { ...content, choices: newItemOptions.filter(o => o.trim() !== '').map(o => ({ text: o.trim(), swiped: {} })) };
    else content = { ...content, options: newItemOptions.filter(o => o.trim() !== '').map(o => ({ text: o.trim(), completed: false, votes: [] })) };

    const { error } = await supabase.from('chill_items').insert([{ category_id: selectedCategory.id, type: newItemType, title: newItemTitle.trim(), content, created_by: currentUserId }]);
    if (!error) { 
      setIsItemModalVisible(false); setNewItemTitle(''); setNewItemOptions(['', '']); setEndDate(null); setSelectedLoc(null); 
      syncAllNotifications();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); 
    }
  };

  const updateItem = async () => {
    if (!editItem) return;
    const content = { ...editItem.content, remType, start_at: startDate.toISOString(), end_at: endDate ? endDate.toISOString() : null, location: selectedLoc };
    await supabase.from('chill_items').update({ title: newItemTitle, content }).eq('id', editItem.id);
    setEditItem(null); 
    setIsItemModalVisible(false); 
    syncAllNotifications();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !chatItem) return;
    const newMessage = { user: currentUserId, text: chatMessage.trim(), time: new Date().toISOString() };
    const newContent = { ...chatItem.content, chat: [...(chatItem.content.chat || []), newMessage] };
    await supabase.from('chill_items').update({ content: newContent }).eq('id', chatItem.id);
    setChatMessage(''); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const allCategories = useMemo(() => {
    const fixedIds = FIXED_CATEGORIES.map(f => f.id);
    return [...FIXED_CATEGORIES, ...categories.filter(c => !fixedIds.includes(c.id))];
  }, [categories]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View><Text style={[styles.title, { color: theme.text }]}>Chill Zone</Text><Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Play, decide & connect ✨</Text></View>
            <MessageCircleHeart color={theme.tint} size={32} />
          </View>
          <View style={styles.categoryGrid}>
            {allCategories.map((cat) => (
              <TouchableOpacity key={cat.id} onPress={() => setSelectedCategory(cat)} style={[styles.catCard, { width: CARD_SIZE, height: CARD_SIZE }]}>
                {cat.image_url ? <Image source={{ uri: cat.image_url }} style={StyleSheet.absoluteFill} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: cat.color + '20' }]} />}
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
                <View style={styles.catOverlay}><View /><View><Text style={styles.catName} numberOfLines={1}>{cat.name}</Text><Text style={styles.itemCount}>{items.filter(i => i.category_id === cat.id).length} items</Text></View></View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <Modal visible={!!selectedCategory} animationType="slide">
          <ThemedView style={{ flex: 1 }}>
            <View style={[styles.modalHeaderFixed, { paddingTop: insets.top + 10, backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setSelectedCategory(null)} style={styles.closeBtn}><X size={24} color={theme.text} /></TouchableOpacity>
              <Text style={[styles.modalTitle, { color: theme.text }]}>{selectedCategory?.name}</Text>
              <TouchableOpacity onPress={() => { setNewItemType(selectedCategory?.id === FIXED_CATEGORIES[0].id ? 'reminder' : 'checklist'); setIsItemModalVisible(true); }} style={[styles.addBtn, { backgroundColor: selectedCategory?.color || theme.tint }]}><Plus size={20} color="white" /></TouchableOpacity>
            </View>
            <FlatList 
              data={items.filter(i => i.category_id === selectedCategory?.id)}
              keyExtractor={i => i.id}
              contentContainerStyle={{ padding: 20, paddingBottom: 150 }}
              renderItem={({item}) => (
                <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={[styles.itemCard, { backgroundColor: theme.card, borderLeftColor: selectedCategory?.color, borderLeftWidth: 5 }]}>
                  <View style={styles.itemHeader}>
                    <TextInput style={[styles.itemTitle, { color: theme.text, flex: 1 }]} defaultValue={item.title} onEndEditing={async (e) => { const nt = e.nativeEvent.text; if (nt && nt !== item.title) await supabase.from('chill_items').update({ title: nt }).eq('id', item.id); }} />
                    <View style={{flexDirection:'row', gap: 15, alignItems: 'center'}}>
                      {item.type === 'reminder' && (<TouchableOpacity onPress={() => { setEditItem(item); setNewItemTitle(item.title); setRemType(item.content.remType); setStartDate(new Date(item.content.start_at)); setEndDate(item.content.end_at ? new Date(item.content.end_at) : null); setSelectedLoc(item.content.location); setIsItemModalVisible(true); }}><Pencil size={18} color={theme.tint} /></TouchableOpacity>)}
                      {['tictactoe', 'ludo', 'snakes', 'match', 'truthordare', 'reminder'].includes(item.type) && !item.content?.winner && (<TouchableOpacity onPress={() => setChatItem(item)}><MessageSquare size={18} color={theme.tint} /></TouchableOpacity>)}
                      <TouchableOpacity onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); Alert.alert("Delete?", "Remove for both?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await supabase.from('chill_items').delete().eq('id', item.id); syncAllNotifications(); } }]); }}><Trash2 size={18} color="#FF3B30" opacity={0.4} /></TouchableOpacity>
                    </View>
                  </View>
                  <View style={styles.gameContainer}>
                    {item.type === 'reminder' && <ReminderComponent item={item} theme={theme} color={selectedCategory?.color} />}
                    {(item.type === 'tictactoe' || item.type === 'snakes' || item.type === 'ludo' || item.type === 'truthordare') && !item.content?.winner && (<Text style={[styles.turnLabel, { color: item.content.turn === currentUserId ? theme.tint : '#888' }]}>{item.content.turn === currentUserId ? "IT'S YOUR TURN" : "WAITING FOR PARTNER..."}</Text>)}
                    {item.type === 'tictactoe' && <TicTacToeBoard item={item} currentUserId={currentUserId} onMove={async (idx:any, sym:any, p:any) => { const b = [...(item.content.board || Array(9).fill(null))]; b[idx] = sym; const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]; let w = null; for (const [a,b_idx,c] of wins) if (b[a] && b[a] === b[b_idx] && b[a] === b[c]) w = p; if (w) await supabase.from('chill_items').update({ content: { winner: w, board: b, chat: item.content.chat || [] } }).eq('id', item.id); else await supabase.from('chill_items').update({ content: { ...item.content, board: b, turn: p === 'pratishth' ? 'love' : 'pratishth' } }).eq('id', item.id); }} />}
                    {item.type === 'snakes' && <SnakesBoard item={item} currentUserId={currentUserId} onMove={async (roll:any, over:any) => { const isP1 = over ? over === 'p1' : currentUserId === 'pratishth'; const p = isP1 ? 'p1' : 'p2', o = isP1 ? 'p2' : 'p1', partner = isP1 ? 'love' : 'pratishth'; let next = (item.content[p] || 1) + roll; if (next > 100) { if (!over) await supabase.from('chill_items').update({ content: { ...item.content, turn: partner } }).eq('id', item.id); return; } const L = { 2: 38, 7: 14, 8: 31, 15: 26, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 78: 98, 87: 94 }, S = { 16: 6, 46: 25, 49: 11, 62: 19, 64: 60, 74: 53, 89: 68, 92: 88, 95: 75, 99: 80 }; if (L[next]) next = L[next]; else if (S[next]) next = S[next]; let opp = item.content[o] || 1; if (next > 1 && next < 100 && next === opp) opp = 1; if (next === 100) await supabase.from('chill_items').update({ content: { winner: currentUserId, chat: item.content.chat || [] } }).eq('id', item.id); else await supabase.from('chill_items').update({ content: { ...item.content, [p]: next, [o]: opp, turn: partner } }).eq('id', item.id); }} />}
                    {item.type === 'ludo' && <LudoBoard item={item} currentUserId={currentUserId} onMove={async (idx:any, roll:any, over:any) => { const isP1 = over ? over === 'p1' : currentUserId === 'pratishth'; const p = isP1 ? 'p1' : 'p2', o = isP1 ? 'p2' : 'p1', partner = isP1 ? 'love' : 'pratishth'; const nP = [...(item.content.players?.[p] || [0,0,0,0])], oP = [...(item.content.players?.[o] || [0,0,0,0])]; if (idx === -1) { await supabase.from('chill_items').update({ content: { ...item.content, turn: partner } }).eq('id', item.id); return; } let ex = roll === 6; if (nP[idx] === 0) nP[idx] = 1; else nP[idx] += roll; if (nP[idx] === 57) ex = true; const g = (nP[idx] - 1 + (isP1 ? 0 : 26)) % 52, safe = [0, 8, 13, 21, 26, 34, 39, 47].includes(g); if (nP[idx] <= 51 && !safe) oP.forEach((pos, i) => { if (pos > 0 && pos <= 51) { const og = (pos - 1 + (isP1 ? 26 : 0)) % 52; if (g === og) { oP[i] = 0; ex = true; } } }); const win = nP.every(p_val => p_val === 57) ? (over ? (over === 'p1' ? 'pratishth' : 'love') : currentUserId) : null; if (win) await supabase.from('chill_items').update({ content: { winner: win, chat: item.content.chat || [] } }).eq('id', item.id); else await supabase.from('chill_items').update({ content: { ...item.content, players: { [p]: nP, [o]: oP }, turn: ex ? (over ? (over === 'p1' ? 'pratishth' : 'love') : currentUserId) : partner } }).eq('id', item.id); }} />}
                    {item.type === 'truthordare' && <TruthOrDareComponent item={item} currentUserId={currentUserId} theme={theme} color={selectedCategory?.color} />}
                  </View>
                  {item.type === 'roulette' && <RouletteComponent item={item} color={selectedCategory?.color} theme={theme} />}
                  {item.type === 'match' && <MatchStack item={item} currentUserId={currentUserId} setMatch={setMatchCelebration} color={selectedCategory?.color} theme={theme} />}
                  {(item.type === 'checklist' || item.type === 'list' || item.type === 'poll') && <CollabListComponent item={item} currentUserId={currentUserId} color={selectedCategory?.color} theme={theme} />}
                  {item.type === 'mood' && (<View style={styles.moodSection}><Text style={styles.currentMood}>{item.content.mood}</Text><View style={styles.moodGrid}>{MOODS.map(m => (<TouchableOpacity key={m} onPress={async () => await supabase.from('chill_items').update({ content: { ...item.content, mood: m } }).eq('id', item.id)} style={styles.moodBtn}><Text style={{fontSize: 20}}>{m}</Text></TouchableOpacity>))}</View></View>)}
                  {item.type === 'tracker' && (<View style={styles.trackerSection}><View style={styles.progressBar}><MotiView animate={{ width: `${(item.content.current/item.content.goal)*100}%` }} style={[styles.progressFill, { backgroundColor: selectedCategory?.color }]} /></View><TouchableOpacity onPress={async () => await supabase.from('chill_items').update({ content: { ...item.content, current: Math.min(item.content.goal, item.content.current + 1) } }).eq('id', item.id)} style={[styles.plusOne, { backgroundColor: selectedCategory?.color }]}><Plus size={16} color="white" /></TouchableOpacity><TouchableOpacity onPress={() => Alert.prompt("Set Goal", "Enter target value", (v) => { if(parseInt(v)) supabase.from('chill_items').update({ content: { ...item.content, goal: parseInt(v) } }).eq('id', item.id).then(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)) })}><Settings2 size={16} color={theme.tabIconDefault} /></TouchableOpacity></View>)}
                  {item.type === 'note' && (<View style={[styles.notePaper, { backgroundColor: item.content.color || '#FFF9C4' }]}><TextInput style={styles.noteText} multiline defaultValue={item.content.body} onEndEditing={async (e) => { const nb = e.nativeEvent.text; if (nb && nb !== item.content.body) await supabase.from('chill_items').update({ content: { ...item.content, body: nb } }).eq('id', item.id); }} /><Sparkles size={14} color="rgba(0,0,0,0.2)" style={{ position: 'absolute', bottom: 10, right: 10 }} /></View>)}
                  <Text style={[styles.itemAuthor, { color: theme.tabIconDefault }]}>CREATED BY {item.created_by?.toUpperCase() || 'SYSTEM'}</Text>
                </MotiView>
              )}
            />
          </ThemedView>

          <Modal visible={!!activeAlert} transparent animationType="fade">
            <View style={styles.alertOverlay}>
              <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
              <MotiView from={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={styles.alertCard}>
                <View style={styles.alertIcon}><Bell size={40} color="white" /></View>
                <Text style={styles.alertTitle}>{activeAlert?.title || "Reminder!"}</Text>
                <Text style={styles.alertBody}>{activeAlert?.body || "It's time for your shared task."}</Text>
                <TouchableOpacity onPress={() => { setSelectedCategory(allCategories[0]); setActiveAlert(null); }} style={styles.alertBtn}><Text style={styles.alertBtnText}>SHOW ME</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveAlert(null)} style={{ marginTop: 15 }}><Text style={{ color: 'rgba(255,255,255,0.5)', fontWeight: '900' }}>DISMISS</Text></TouchableOpacity>
              </MotiView>
            </View>
          </Modal>

          <Modal visible={isItemModalVisible} animationType="fade" transparent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
              <View style={styles.modalOverlay}>
                <BlurView intensity={100} tint={colorScheme} style={styles.itemModalContent}>
                  <TouchableOpacity onPress={() => { setIsItemModalVisible(false); setEditItem(null); }} style={styles.modalCloseAbs}><X size={20} color={theme.text} /></TouchableOpacity>
                  <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editItem ? 'Edit' : 'New'} Shared Experience</Text></View>
                  {!editItem && (selectedCategory?.id !== FIXED_CATEGORIES[0].id ? (
                    <View style={styles.typePicker}>{ITEM_TYPES.filter(t => t.id !== 'reminder').map(t => (<TouchableOpacity key={t.id} onPress={() => setNewItemType(t.id)} style={[styles.typeChip, newItemType === t.id && { backgroundColor: selectedCategory?.color + '20', borderColor: selectedCategory?.color, borderWidth: 1 }]}><t.icon size={18} color={newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault} /><Text style={[styles.typeText, { color: newItemType === t.id ? selectedCategory?.color : theme.tabIconDefault }]}>{t.label}</Text></TouchableOpacity>))}</View>
                  ) : (
                    <View style={styles.remTypeToggle}><TouchableOpacity onPress={() => setRemType('time')} style={[styles.remToggleBtn, remType === 'time' && { backgroundColor: theme.tint }]}><Clock size={16} color={remType === 'time' ? 'white' : '#888'} /><Text style={[styles.remToggleText, remType === 'time' && { color: 'white' }]}>TIME BASED</Text></TouchableOpacity><TouchableOpacity onPress={() => setRemType('location')} style={[styles.remToggleBtn, remType === 'location' && { backgroundColor: theme.tint }]}><MapPin size={16} color={remType === 'location' ? 'white' : '#888'} /><Text style={[styles.remToggleText, remType === 'location' && { color: 'white' }]}>LOCATION BASED</Text></TouchableOpacity></View>
                  ))}
                  <TextInput style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background }]} placeholder={"What's the task?"} value={newItemTitle} onChangeText={setNewItemTitle} />
                  {newItemType === 'reminder' && (
                    <View style={{ gap: 15 }}>
                      {remType === 'time' ? (
                        <View style={{ gap: 10 }}>
                          <TouchableOpacity onPress={() => setShowStartPicker(true)} style={[styles.dateSelector, { backgroundColor: theme.background }]}><Clock size={16} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700' }}>START: {startDate.toLocaleString()}</Text></TouchableOpacity>
                          {showStartPicker && (<DateTimePicker value={startDate} mode="datetime" display="default" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />)}
                          <TouchableOpacity onPress={() => setShowEndPicker(true)} style={[styles.dateSelector, { backgroundColor: theme.background }]}><Calendar size={16} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700' }}>{endDate ? `END: ${endDate.toLocaleString()}` : "ADD END TIME (OPTIONAL)"}</Text></TouchableOpacity>
                          {showEndPicker && (<DateTimePicker value={endDate || new Date()} mode="datetime" display="default" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />)}
                          {endDate && <TouchableOpacity onPress={() => setEndDate(null)}><Text style={{ color: '#FF3B30', fontSize: 10, textAlign: 'center' }}>REMOVE END TIME</Text></TouchableOpacity>}
                        </View>
                      ) : (<TouchableOpacity onPress={() => setIsMapVisible(true)} style={[styles.dateSelector, { backgroundColor: theme.background }]}><MapPin size={16} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700' }}>{selectedLoc ? selectedLoc.name : "CHOOSE ON MAP"}</Text></TouchableOpacity>)}
                    </View>
                  )}
                  <TouchableOpacity onPress={editItem ? updateItem : addItem} style={[styles.saveBtn, { backgroundColor: selectedCategory?.color }]}><Text style={styles.saveBtnText}>{editItem ? 'Save Changes' : 'Activate for Us'}</Text></TouchableOpacity>
                </BlurView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
          <Modal visible={isMapVisible} animationType="slide"><SmartLocationPicker onLocationCaptured={(loc) => { setSelectedLoc(loc); setIsMapVisible(false); }} onClose={() => setIsMapVisible(false)} title="Set Task Location" /></Modal>
        </Modal>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

function ReminderComponent({ item, theme, color }: any) {
  const isTime = item.content.remType === 'time', isActive = item.content.active;
  const start = new Date(item.content.start_at), end = item.content.end_at ? new Date(item.content.end_at) : null, isExpired = end && new Date() > end;
  const toggleReminder = async () => {
    const newActive = !isActive;
    if (newActive && isTime) {
      const trigger = new Date(item.content.start_at);
      if (trigger > new Date()) {
        await Notifications.scheduleNotificationAsync({
          identifier: item.id,
          content: {
            title: `⏰ Task: ${item.title}`,
            body: "Starting now!",
            data: { itemId: item.id, type: 'reminder' },
            sound: true
          },
          trigger
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Notifications.cancelScheduledNotificationAsync(item.id);
    }
    await supabase.from('chill_items').update({ content: { ...item.content, active: newActive } }).eq('id', item.id);
    await syncAllNotifications();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  return (<View style={[styles.reminderBox, isExpired && { opacity: 0.5 }]}><View style={[styles.reminderIconBox, { backgroundColor: color + '15' }]}>{isTime ? <Clock size={24} color={color} /> : <MapPin size={24} color={color} />}</View><View style={{ flex: 1 }}><Text style={[styles.reminderVal, { color: theme.text }]}>{item.title}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}><Text style={styles.reminderSub}>{isTime ? `Starts: ${start.toLocaleTimeString()}` : `Near: ${item.content.location?.name || 'Saved Spot'}`}</Text>{end && <Text style={[styles.reminderSub, { color }]}>• Ends: {end.toLocaleTimeString()}</Text>}</View></View><TouchableOpacity onPress={toggleReminder} style={[styles.bellBtn, { backgroundColor: isActive ? color : 'rgba(150,150,150,0.1)' }]}>{isActive ? <Bell size={18} color="white" /> : <BellOff size={18} color="#888" />}</TouchableOpacity></View>);
}

function RouletteComponent({ item, color, theme }: any) {
  const rotation = useSharedValue(0), [spinning, setSpinning] = useState(false), [winner, setWinner] = useState<string | null>(null), options = item.content.options || [];
  const spin = () => { if (spinning || options.length === 0) return; setSpinning(true); setWinner(null); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); const ex = 5 + Math.random() * 5, final = rotation.value + (ex * 360); rotation.value = withTiming(final, { duration: 3000, easing: Easing.out(Easing.cubic) }, (f) => { if (f) runOnJS(handleFinish)(final); }); };
  const handleFinish = (f: number) => { setSpinning(false); const norm = f % 360, idx = Math.floor((360 - norm) / (360 / options.length)) % options.length; setWinner(options[idx].text); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (<View style={styles.rouletteWrapper}><AnimatePresence>{winner && <MotiView from={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} style={[styles.winnerBadge, { backgroundColor: color }]}><Sparkles size={16} color="white" /><Text style={styles.winnerName}>{winner.toUpperCase()}</Text></MotiView>}</AnimatePresence><View style={styles.wheelOuter}><View style={styles.pointer} /><Animated.View style={[styles.wheelContainer, wheelStyle]}><Svg width={220} height={220} viewBox="0 0 220 220"><G transform="translate(110, 110)">{options.map((opt: any, i: number) => { const angle = (2 * Math.PI) / options.length, sA = i * angle - Math.PI / 2, eA = (i + 1) * angle - Math.PI / 2, x1 = 100 * Math.cos(sA), y1 = 100 * Math.sin(sA), x2 = 100 * Math.cos(eA), y2 = 100 * Math.sin(eA); return (<G key={i}><Path d={`M 0 0 L ${x1} ${y1} A 100 100 0 0 1 ${x2} ${y2} Z`} fill={i % 2 === 0 ? color : color + '40'} stroke="#fff" strokeWidth={2} /><SvgText x={60 * Math.cos(startAngle + angle/2)} y={60 * Math.sin(startAngle + angle/2)} fill={theme.text} fontSize="10" fontWeight="bold" textAnchor="middle" transform={`rotate(${(i * (360/options.length)) + (360/options.length)/2 + 90}, ${60 * Math.cos(startAngle + angle/2)}, ${60 * Math.sin(startAngle + angle/2)})`}>{opt.text.substring(0, 10)}</SvgText></G>); })}<SvgCircle r={15} fill="#fff" /></G></Svg></Animated.View></View><TouchableOpacity onPress={spin} disabled={spinning} style={[styles.spinBtn, { backgroundColor: color, marginTop: 20 }]}><Text style={styles.spinText}>{spinning ? 'DECIDING...' : 'SPIN THE WHEEL'}</Text></TouchableOpacity></View>);
}

function TruthOrDareComponent({ item, currentUserId, theme, color }: any) {
  const [localPrompt, setLocalPrompt] = useState(''), partnerId = item.content.turn === 'pratishth' ? 'love' : 'pratishth', isMyTurn = item.content.turn === currentUserId, isPartnerTurn = item.content.turn !== currentUserId;
  const selectMode = async (mode: 'truth' | 'dare') => { if (!isMyTurn) return; await supabase.from('chill_items').update({ content: { ...item.content, mode, prompt: null } }).eq('id', item.id); };
  const submitPrompt = async () => { if (!localPrompt.trim()) return; await supabase.from('chill_items').update({ content: { ...item.content, prompt: localPrompt.trim() } }).eq('id', item.id); setLocalPrompt(''); };
  const complete = async () => { await supabase.from('chill_items').update({ content: { ...item.content, mode: null, prompt: null, turn: partnerId } }).eq('id', item.id); };
  return (<View style={styles.truthBox}>{!item.content.mode && (<View style={styles.truthActions}><TouchableOpacity onPress={() => selectMode('truth')} style={[styles.truthBtn, { borderColor: color, borderWidth: 1 }]} disabled={!isMyTurn}><Text style={{color, fontWeight:'900'}}>TRUTH</Text></TouchableOpacity><TouchableOpacity onPress={() => selectMode('dare')} style={[styles.truthBtn, { backgroundColor: color }]} disabled={!isMyTurn}><Text style={{color:'white', fontWeight:'900'}}>DARE</Text></TouchableOpacity></View>)}{item.content.mode && !item.content.prompt && (<View style={[styles.promptCard, { backgroundColor: color + '10' }]}><Text style={[styles.promptMode, { color }]}>{item.content.mode.toUpperCase()}</Text>{isPartnerTurn ? (<View style={{ width: '100%', gap: 10 }}><TextInput style={[styles.modalInput, { backgroundColor: theme.background, color: theme.text }]} placeholder="Write their challenge..." value={localPrompt} onChangeText={setLocalPrompt} /><TouchableOpacity onPress={submitPrompt} style={[styles.saveBtn, { backgroundColor: color }]}><Text style={styles.saveBtnText}>Send Challenge</Text></TouchableOpacity></View>) : (<Text style={styles.waitText}>Waiting for partner to set the prompt...</Text>)}</View>)}{item.content.prompt && (<View style={[styles.promptCard, { backgroundColor: color + '15' }]}><Text style={[styles.promptMode, { color }]}>{item.content.mode.toUpperCase()}</Text><Text style={[styles.promptText, { color: theme.text }]}>{item.content.prompt}</Text>{isMyTurn && (<TouchableOpacity onPress={complete} style={[styles.saveBtn, { backgroundColor: color, width: '100%', marginTop: 20 }]}><Text style={styles.saveBtnText}>Challenge Done ✅</Text></TouchableOpacity>)}</View>)}</View>);
}

function MatchStack({ item, currentUserId, setMatch, color, theme }: any) {
  const translateX = useSharedValue(0), translateY = useSharedValue(0), partnerId = currentUserId === 'pratishth' ? 'love' : 'pratishth', remaining = item.content.choices.filter((c: any) => c.swiped[currentUserId] === undefined), currentItem = remaining[0], bothFinished = item.content.choices.every((c:any) => c.swiped.pratishth !== undefined && c.swiped.love !== undefined);
  const handleSwipeResult = async (val: boolean) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); const nC = [...item.content.choices]; const idx = item.content.choices.indexOf(currentItem); nC[idx].swiped[currentUserId] = val; if (val === true && nC[idx].swiped[partnerId] === true) { setMatch(nC[idx].text); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } await supabase.from('chill_items').update({ content: { ...item.content, choices: nC } }).eq('id', item.id); translateX.value = 0; translateY.value = 0; };
  const gesture = Gesture.Pan().onUpdate((e) => { translateX.value = e.translationX; translateY.value = e.translationY; }).onEnd((e) => { if (Math.abs(e.translationX) > 100) { const res = e.translationX > 0; translateX.value = withTiming(e.translationX > 0 ? 500 : -500, { duration: 200 }); runOnJS(handleSwipeResult)(res); } else { translateX.value = withSpring(0); translateY.value = withSpring(0); } });
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { rotate: `${interpolate(translateX.value, [-200, 200], [-15, 15])}deg` }] })), likeStyle = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [0, 100], [0, 1]) })), nopeStyle = useAnimatedStyle(() => ({ opacity: interpolate(translateX.value, [-100, 0], [1, 0]) }));
  if (bothFinished) { const matches = item.content.choices.filter((c:any) => c.swiped.pratishth && c.swiped.love), mismatches = item.content.choices.filter((c:any) => c.swiped.pratishth !== c.swiped.love), bothNope = item.content.choices.filter((c:any) => !c.swiped.pratishth && !c.swiped.love); return (<View style={styles.matchReport}><View style={styles.reportHeader}><Trophy size={20} color="#FFD700" /><Text style={[styles.reportTitle, { color: theme.text }]}>THE MATCH REPORT</Text></View><ScrollView style={{ maxHeight: 250 }} nestedScrollEnabled>{matches.length > 0 && (<View style={styles.reportSection}><View style={styles.sectionHeader}><Heart size={14} color="#FF2D55" fill="#FF2D55" /><Text style={styles.sectionTitle}>PERFECT MATCHES</Text></View>{matches.map((m:any, i:number) => (<Text key={i} style={styles.reportItem}>• {m.text}</Text>))}</View>)}{mismatches.length > 0 && (<View style={styles.reportSection}><View style={styles.sectionHeader}><X size={14} color="#FF9500" /><Text style={styles.sectionTitle}>MISMATCHES</Text></View>{mismatches.map((m:any, i:number) => (<Text key={i} style={[styles.reportItem, { opacity: 0.6 }]}>• {m.text}</Text>))}</View>)}{bothNope.length > 0 && (<View style={styles.reportSection}><View style={styles.sectionHeader}><Ghost size={14} color="#8E8E93" /><Text style={styles.sectionTitle}>BOTH NOPE</Text></View>{bothNope.map((m:any, i:number) => (<Text key={i} style={[styles.reportItem, { opacity: 0.4 }]}>• {m.text}</Text>))}</View>)}</ScrollView></View>); }
  if (!currentItem) return (<View style={styles.emptyMatch}><ActivityIndicator color={color} /><Text style={[styles.emptyMatchText, { color: theme.tabIconDefault }]}>Waiting for Tamtam... ⏳</Text></View>);
  return (<View style={styles.matchContainer}><GestureDetector gesture={gesture}><Animated.View style={[styles.matchCard, { backgroundColor: theme.background, borderColor: color + '30' }, cardStyle]}><Animated.View style={[styles.swipeLabel, { borderColor: '#34C759', right: 20, top: 20 }, likeStyle]}><Text style={[styles.swipeLabelText, { color: '#34C759' }]}>MATCH</Text></Animated.View><Animated.View style={[styles.swipeLabel, { borderColor: '#FF3B30', left: 20, top: 20 }, nopeStyle]}><Text style={[styles.swipeLabelText, { color: '#FF3B30' }]}>NOPE</Text></Animated.View><Text style={[styles.matchCount, { color }]}>{item.content.choices.length - remaining.length + 1} / {item.content.choices.length}</Text><Text style={[styles.matchText, { color: theme.text }]}>{currentItem.text}</Text></Animated.View></GestureDetector></View>);
}

function CollabListComponent({ item, currentUserId, color, theme }: any) {
  const toggle = async (idx: number) => { const nO = [...item.content.options]; nO[idx].completed = !nO[idx].completed; await supabase.from('chill_items').update({ content: { ...item.content, options: nO } }).eq('id', item.id); };
  const editOption = async (idx: number, text: string) => { if (!text.trim()) return; const nO = [...item.content.options]; nO[idx].text = text.trim(); await supabase.from('chill_items').update({ content: { ...item.content, options: nO } }).eq('id', item.id); };
  return (<View style={styles.collabList}>{item.content.options?.map((opt: any, i: number) => (<View key={i} style={[styles.optionRow, { backgroundColor: theme.background }]}><TouchableOpacity onPress={() => toggle(i)} style={styles.optionCheck}>{item.type === 'checklist' && (opt.completed ? <CheckCircle2 size={20} color={color} /> : <Circle size={20} color="#888" />)}</TouchableOpacity><TextInput style={[styles.optionText, { color: theme.text, textDecorationLine: opt.completed ? 'line-through' : 'none', flex: 1 }]} defaultValue={opt.text} onEndEditing={(e) => editOption(i, e.nativeEvent.text)} /><Pencil size={12} color={theme.tabIconDefault} opacity={0.3} /></View>))}</View>);
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
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 10 },
  itemTitle: { fontSize: 22, fontWeight: '800' },
  gameContainer: { alignItems: 'center', gap: 15, width: '100%' },
  turnLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  truthBox: { width: '100%', gap: 15 },
  promptCard: { padding: 25, borderRadius: 20, alignItems: 'center', minHeight: 120, justifyContent: 'center', width: '100%' },
  promptMode: { fontSize: 10, fontWeight: '900', letterSpacing: 2, marginBottom: 10 },
  promptText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  truthActions: { flexDirection: 'row', gap: 10, width: '100%' },
  truthBtn: { flex: 1, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  waitText: { fontSize: 12, fontWeight: '700', fontStyle: 'italic', opacity: 0.5, textAlign: 'center' },
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
  matchContainer: { height: 220, width: '100%', justifyContent: 'center', alignItems: 'center' },
  matchCard: { width: SCREEN_WIDTH - 80, height: 200, padding: 25, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  matchCount: { fontSize: 10, fontWeight: '900', letterSpacing: 1, opacity: 0.6, position: 'absolute', top: 20 },
  matchText: { fontSize: 24, fontWeight: '900', textAlign: 'center' },
  swipeLabel: { position: 'absolute', borderWidth: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, transform: [{ rotate: '-10deg' }], zIndex: 10 },
  swipeLabelText: { fontWeight: '900', fontSize: 18 },
  emptyMatch: { height: 200, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyMatchText: { fontWeight: '800', fontSize: 14, textAlign: 'center' },
  matchReport: { width: '100%', backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 20, padding: 20 },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 15 },
  reportTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  reportSection: { marginBottom: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  sectionTitle: { fontSize: 9, fontWeight: '900', color: '#888' },
  reportItem: { fontSize: 14, fontWeight: '700', color: '#333', marginLeft: 20, marginBottom: 2 },
  collabList: { gap: 10, width: '100%' },
  optionRow: { padding: 15, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionCheck: { padding: 5 },
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
  modalHeader: { width: '100%', marginBottom: 10 },
  modalCloseAbs: { position: 'absolute', top: 25, right: 25, zIndex: 100, padding: 10, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.1)' },
  typePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 15, backgroundColor: 'rgba(150,150,150,0.1)' },
  typeText: { fontSize: 11, fontWeight: '900' },
  modalInput: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700' },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: 'white', fontWeight: '900', fontSize: 17 },
  debugSmallBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(150,150,150,0.1)', alignSelf: 'flex-start', marginBottom: 10 },
  debugBtnText: { fontSize: 10, fontWeight: '900', color: 'white' },
  celebOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  celebContent: { alignItems: 'center', padding: 40, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)' },
  celebTitle: { color: 'white', fontSize: 32, fontWeight: '900', marginTop: 20 },
  celebSub: { color: 'rgba(255,255,255,0.7)', fontSize: 16, marginTop: 5, textAlign: 'center' },
  celebClose: { marginTop: 40, padding: 15 },
  celebCloseText: { color: 'white', fontWeight: '900', fontSize: 18 },
  reminderBox: { flexDirection: 'row', alignItems: 'center', gap: 15, width: '100%', padding: 5 },
  reminderIconBox: { width: 48, height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  reminderVal: { fontSize: 16, fontWeight: '800' },
  reminderSub: { fontSize: 10, fontWeight: '600', opacity: 0.5 },
  bellBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  remTypeToggle: { flexDirection: 'row', gap: 10, width: '100%' },
  remToggleBtn: { flex: 1, height: 50, borderRadius: 15, backgroundColor: 'rgba(150,150,150,0.1)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  remToggleText: { fontSize: 11, fontWeight: '900', color: '#888' },
  dateSelector: { width: '100%', height: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  alertOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 5000, justifyContent: 'center', alignItems: 'center', padding: 20 },
  alertCard: { width: '100%', padding: 40, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', gap: 15 },
  alertIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#5856D6', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  alertTitle: { color: 'white', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  alertBody: { color: 'rgba(255,255,255,0.7)', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  alertBtn: { width: '100%', height: 60, borderRadius: 20, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center' },
  alertBtnText: { color: '#000', fontWeight: '900', fontSize: 16 }
});
