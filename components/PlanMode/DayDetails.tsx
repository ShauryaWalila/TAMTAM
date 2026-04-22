import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, Image, Dimensions, Pressable, ActivityIndicator, TextInput, Platform, findNodeHandle, UIManager } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, MapPin, Plus, Shirt, Check, ChevronRight, Menu, Search, Filter, Tags, Package, Eye, Layers, User, Clock, Sparkles, CheckCircle2, Trash2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import AddPinModal from '@/components/Map/AddPinModal';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.8;
const HangerIcon = require('@/assets/images/clothes-hanger.png');

interface DayDetailsProps {
  tripId: string;
  day: any;
  onClose: () => void;
  isReadOnly?: boolean;
}

export default function DayDetails({ tripId, day, onClose, isReadOnly }: DayDetailsProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  const [itinerary, setItinerary] = useState<any[]>([]);
  const [wardrobe, setWardrobe] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [selectedOutfitIds, setSelectedOutfitIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Memories State
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [targetCoordinate, setTargetCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [targetName, setTargetName] = useState('');
  const [finishDayQueue, setFinishDayQueue] = useState<any[]>([]);

  // Drag and Drop state
  const drawerTranslateX = useSharedValue(-DRAWER_WIDTH);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const shouldCloseDrawerAfterDrop = useSharedValue(false);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);

  // Refs for live measurement of drop targets at drop time
  const itemRefs = useRef<Record<string, View | null>>({});

  useEffect(() => {
    if (drawerOpen) {
      drawerTranslateX.value = withTiming(0, { duration: 300 });
    } else {
      drawerTranslateX.value = withTiming(-DRAWER_WIDTH, { duration: 300 });
    }
  }, [drawerOpen]);

  useEffect(() => {
    init();
    const tripWardrobeSub = supabase.channel('trip_wardrobe_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'trip_wardrobe', filter: `trip_id=eq.${tripId}` }, () => fetchWardrobe()).subscribe();
    const outfitsSub = supabase.channel('outfit_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_outfits' }, () => fetchItinerary()).subscribe();
    const itSub = supabase.channel('itinerary_changes').on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items' }, () => fetchItinerary()).subscribe();
    return () => {
      supabase.removeChannel(tripWardrobeSub);
      supabase.removeChannel(outfitsSub);
      supabase.removeChannel(itSub);
    };
  }, [tripId, day, refreshTrigger]);

  const init = async () => {
    const user = await SecureStore.getItemAsync('user_name');
    setCurrentUser(user);
    fetchData();
  };

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchItinerary(), fetchWardrobe()]);
    setLoading(false);
  };

  const fetchItinerary = async () => {
    const { data } = await supabase
      .from('itinerary_items')
      .select('*, bucket_items(*), itinerary_outfits(wardrobe_item_id, wardrobe(*))')
      .eq('trip_id', tripId)
      .eq('day_number', day.dayNumber)
      .order('sequence', { ascending: true });
    if (data) setItinerary(data);
  };

  const fetchWardrobe = async () => {
    const { data } = await supabase
      .from('trip_wardrobe')
      .select('wardrobe_item_id, wardrobe(*)')
      .eq('trip_id', tripId);
    if (data) {
      const wardrobeItems = data.map(d => d.wardrobe).filter(Boolean);
      setWardrobe(wardrobeItems);
      if (wardrobeItems.length > 0 && expandedCategories.length === 0) {
        setExpandedCategories([wardrobeItems[0].category || 'Uncategorized']);
      }
    }
  };

  const filteredWardrobe = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return wardrobe.filter(item => !term || item.name?.toLowerCase().includes(term) || item.category?.toLowerCase().includes(term));
  }, [wardrobe, searchTerm]);

  useEffect(() => {
    if (searchTerm.length > 0) {
      const allCats = [...new Set(filteredWardrobe.map(i => i.category || 'Uncategorized'))];
      setExpandedCategories(allCats);
    }
  }, [searchTerm, filteredWardrobe]);

  const groupedWardrobe = useMemo(() => {
    return filteredWardrobe.reduce((acc: any, item) => {
      const cat = item.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {});
  }, [filteredWardrobe]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const linkOutfits = async (itineraryItemId: string, wardrobeItemIds: string[]) => {
    if (isReadOnly || wardrobeItemIds.length === 0) return;
    try {
      const payload = wardrobeItemIds.map(wId => ({ itinerary_item_id: itineraryItemId, wardrobe_item_id: wId }));
      const { error } = await supabase.from('itinerary_outfits').upsert(payload, { onConflict: 'itinerary_item_id, wardrobe_item_id' });
      
      if (!error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSelectedOutfitIds([]);
        setRefreshTrigger(prev => prev + 1);
        fetchItinerary(); 
        // Triple-stage refresh for maximum reliability
        setTimeout(fetchItinerary, 400);
        setTimeout(fetchItinerary, 1000);
      } else {
        console.error('[Wardrobe] Error:', error.message);
        Alert.alert('Link Error', error.message);
      }
    } catch (e) {
      console.error('[Wardrobe] linkOutfits Exception:', e);
    }
  };

  const removeOutfit = async (itItemId: string, wId: string) => {
    if (isReadOnly) return;
    const { error } = await supabase.from('itinerary_outfits').delete().eq('itinerary_item_id', itItemId).eq('wardrobe_item_id', wId);
    if (!error) {
      setRefreshTrigger(prev => prev + 1);
      fetchItinerary();
    }
  };

  const toggleTargetUser = async (item: any) => {
    if (isReadOnly) return;
    const newTarget = item.target_user === 'pratishth' ? 'love' : 'pratishth';
    await supabase.from('wardrobe').update({ target_user: newTarget }).eq('id', item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchWardrobe();
  };

  const getOwnershipLabel = (item: any) => item.target_user === 'pratishth' ? 'His' : 'Her';
  const getMiniLabel = (item: any) => item.target_user === 'pratishth' ? 'P' : 'S';

  const handleAddMemory = (item: any) => {
    const lat = item.bucket_items?.latitude;
    const lng = item.bucket_items?.longitude;
    if (lat && lng) {
      setTargetCoordinate({ latitude: lat, longitude: lng });
      setTargetName(item.is_custom ? item.custom_label : item.bucket_items?.name);
      setIsAddModalVisible(true);
    }
  };

  const handleFinishDay = () => {
    const validItems = itinerary.filter(it => it.bucket_items?.latitude && it.bucket_items?.longitude);
    if (validItems.length === 0) return;
    setFinishDayQueue(validItems);
    const first = validItems[0];
    setTargetCoordinate({ latitude: first.bucket_items.latitude, longitude: first.bucket_items.longitude });
    setTargetName(first.is_custom ? first.custom_label : first.bucket_items.name);
    setIsAddModalVisible(true);
  };

  const onMemorySuccess = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (finishDayQueue.length > 1) {
      const nextQueue = finishDayQueue.slice(1);
      setFinishDayQueue(nextQueue);
      const nextItem = nextQueue[0];
      setTargetCoordinate({ latitude: nextItem.bucket_items.latitude, longitude: nextItem.bucket_items.longitude });
      setTargetName(nextItem.is_custom ? nextItem.custom_label : nextItem.bucket_items.name);
    } else {
      setFinishDayQueue([]);
      setIsAddModalVisible(false);
      Alert.alert("All Done!", "Your day's memories have been shared to Our Life.");
    }
  };

  const measureRef = (ref: any): Promise<{ x: number; y: number; w: number; h: number } | null> => {
    return new Promise((resolve) => {
      if (!ref) return resolve(null);
      const handle = findNodeHandle(ref);
      if (!handle) return resolve(null);
      UIManager.measureInWindow(handle, (x: number, y: number, w: number, h: number) => {
        if (x == null || isNaN(x) || (w === 0 && h === 0)) return resolve(null);
        resolve({ x, y, w, h });
      });
    });
  };

  const handleDrop = async (absX: number, absY: number, draggedItem: any) => {
    try {
      const entries = Object.entries(itemRefs.current).filter(([, r]) => r);
      const rects = await Promise.all(
        entries.map(async ([id, ref]) => [id, await measureRef(ref)] as const)
      );
      const found = rects.find(([, rect]) => {
        if (!rect) return false;
        return absX >= rect.x && absX <= rect.x + rect.w &&
               absY >= rect.y - 10 && absY <= rect.y + rect.h + 10;
      });
      if (found && found[1]) {
        const itId = found[0];
        const ids = selectedOutfitIds.includes(draggedItem.id) ? selectedOutfitIds : [draggedItem.id];
        linkOutfits(itId, ids);
      }
    } catch (err: any) {
      console.error('[Drop] Error:', err?.message || err);
    } finally {
      isDragging.value = false;
      setActiveDragItem(null);
    }
  };

  const createPanGesture = (item: any) => Gesture.Pan()
    .minDistance(8)
    .onBegin(() => {
      if (isReadOnly) return;
      shouldCloseDrawerAfterDrop.value = false;
      runOnJS(setActiveDragItem)(item);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Heavy);
    })
    .onUpdate((e) => {
      dragX.value = e.absoluteX;
      dragY.value = e.absoluteY;
      isDragging.value = true;
      dragScale.value = withSpring(1.15);
      // Slide drawer out of the way visually only - do NOT unmount it,
      // or the GestureDetector inside gets removed mid-drag.
      if (e.absoluteX > DRAWER_WIDTH * 0.5) {
        drawerTranslateX.value = withSpring(-DRAWER_WIDTH);
        shouldCloseDrawerAfterDrop.value = true;
      }
    })
    .onFinalize((e) => {
      runOnJS(handleDrop)(e.absoluteX, e.absoluteY, item);
      dragScale.value = withSpring(1);
      if (shouldCloseDrawerAfterDrop.value) {
        runOnJS(setDrawerOpen)(false);
        shouldCloseDrawerAfterDrop.value = false;
      }
    });

  const animatedDragStyle = useAnimatedStyle(() => ({
    position: 'absolute', top: -40, left: -40, width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.tint, justifyContent: 'center', alignItems: 'center',
    zIndex: 9999, opacity: isDragging.value ? 1 : 0,
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { scale: dragScale.value }],
    elevation: 25, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12,
  }));

  const animatedDrawerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: drawerTranslateX.value }] }));

  const animatedBackdropStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(1, Math.max(0, -drawerTranslateX.value / DRAWER_WIDTH));
    return { opacity: progress };
  });

  const toggleOutfitSelection = (id: string) => {
    setSelectedOutfitIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.mainContent}>
          <View style={[styles.header, { backgroundColor: theme.card }]}>
            <View style={styles.headerInfo}>
              <TouchableOpacity onPress={() => setDrawerOpen(true)} style={[styles.menuBtn, { backgroundColor: theme.background }]}>
                <Image source={HangerIcon} style={{ width: 24, height: 24, tintColor: theme.text }} resizeMode="contain" />
              </TouchableOpacity>
              <View><Text style={[styles.weekday, { color: theme.text, opacity: 0.6 }]}>{day.weekday}</Text><Text style={[styles.title, { color: theme.text }]}>Day {day.dayNumber}</Text></View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}><X size={24} color={theme.text} /></TouchableOpacity>
          </View>

          <Animated.ScrollView
            style={styles.stopsList}
            showsVerticalScrollIndicator={false}
          >
            {loading ? <ActivityIndicator style={{ marginTop: 50 }} color={theme.tint} /> : itinerary.length === 0 ? (
              <View style={styles.emptyState}><Package size={48} color={theme.text} opacity={0.2} /><Text style={[styles.emptyText, { color: theme.text }]}>No stops planned for today.</Text></View>
            ) : (
              <>
                {itinerary.map((item, index) => (
                  <View
                    key={item.id}
                    ref={(r) => { itemRefs.current[item.id] = r; }}
                    collapsable={false}
                    style={[styles.stopCard, { backgroundColor: theme.card }]}
                  >
                    <View style={styles.stopHeader}>
                      <View style={[styles.sequenceBadge, { backgroundColor: theme.tint }]}><Text style={styles.sequenceText}>{index + 1}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.stopName, { color: theme.text }]}>{item.is_custom ? item.custom_label : item.bucket_items?.name}</Text>
                        {!item.is_custom && <View style={styles.typeBadge}><MapPin size={10} color={theme.text} opacity={0.5} /><Text style={[styles.typeText, { color: theme.text, opacity: 0.5 }]}>{item.bucket_items?.category?.toUpperCase() || 'STOP'}</Text></View>}
                      </View>
                      <TouchableOpacity onPress={() => handleAddMemory(item)}><Sparkles size={18} color={theme.tint} /></TouchableOpacity>
                    </View>
                    <View style={[styles.attachedOutfits, { borderTopColor: theme.background }]}>
                      {item.itinerary_outfits?.length > 0 ? (
                        <View style={styles.outfitGrid}>{item.itinerary_outfits.map((io: any) => (
                          <View key={io.wardrobe_item_id} style={styles.outfitItem}>
                            <View style={[styles.outfitThumbWrapper, { backgroundColor: theme.background }]}>
                              {io.wardrobe?.image_url ? <Image source={{ uri: io.wardrobe.image_url }} style={styles.outfitThumb} /> : <Shirt size={14} color={theme.tint} />}
                              <TouchableOpacity style={styles.removeOutfitBtn} onPress={() => removeOutfit(item.id, io.wardrobe_item_id)}><X size={10} color="white" /></TouchableOpacity>
                              <View style={styles.itemTargetMiniBadge}><Text style={styles.itemTargetMiniText}>{io.wardrobe?.target_user === 'pratishth' ? 'P' : 'S'}</Text></View>
                            </View>
                            <Text style={[styles.outfitName, { color: theme.text }]} numberOfLines={1}>{io.wardrobe?.name || '...'}</Text>
                          </View>
                        ))}</View>
                      ) : <Text style={{ color: theme.text, opacity: 0.3, fontSize: 12 }}>Drag clothes here</Text>}
                    </View>
                  </View>
                ))}
                <TouchableOpacity style={[styles.finishDayBtn, { backgroundColor: theme.tint }]} onPress={handleFinishDay}><CheckCircle2 size={20} color="white" /><Text style={styles.finishDayText}>Finish Day & Add Memories</Text></TouchableOpacity>
              </>
            )}
            <View style={{ height: 100 }} />
          </Animated.ScrollView>
        </View>

        <AnimatePresence>
          {drawerOpen && (
            <Animated.View style={[styles.drawerBackdrop, animatedBackdropStyle]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} />
              <Animated.View style={[styles.drawer, { backgroundColor: theme.card }, animatedDrawerStyle]}>
                <View style={styles.drawerHeader}><Text style={[styles.drawerTitle, { color: theme.text }]}>Wardrobe</Text><TouchableOpacity onPress={() => setDrawerOpen(false)} style={[styles.closeBtn, { backgroundColor: theme.background }]}><X size={24} color={theme.text} /></TouchableOpacity></View>
                <View style={styles.drawerActions}><View style={[styles.searchBar, { backgroundColor: theme.background }]}><Search size={16} color={theme.text} opacity={0.5} /><TextInput style={[styles.searchText, { color: theme.text, flex: 1, padding: 0 }]} placeholder="Search clothes..." placeholderTextColor={theme.text + '50'} value={searchTerm} onChangeText={setSearchTerm} autoCorrect={false} />{searchTerm.length > 0 && (<TouchableOpacity onPress={() => setSearchTerm('')}><X size={14} color={theme.text} opacity={0.5} /></TouchableOpacity>)}</View></View>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.drawerContent}>{Object.keys(groupedWardrobe).map(cat => (
                  <View key={cat} style={styles.drawerCatSection}>
                    <TouchableOpacity style={styles.drawerCatHeader} onPress={() => toggleCategory(cat)}><Text style={[styles.drawerCatTitle, { color: theme.text, opacity: 0.6 }]}>{cat.toUpperCase()}</Text><View style={[styles.catCount, { backgroundColor: theme.tint + '20' }]}><Text style={[styles.catCountText, { color: theme.tint }]}>{groupedWardrobe[cat].length}</Text></View></TouchableOpacity>
                    <AnimatePresence>{expandedCategories.includes(cat) && (<MotiView from={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'timing', duration: 300 }} style={{ overflow: 'hidden' }}><View style={styles.drawerItemsGrid}>
                      {groupedWardrobe[cat].map((item: any) => {
                        const isSelected = selectedOutfitIds.includes(item.id);
                        return (
                          <GestureDetector key={item.id} gesture={createPanGesture(item)}>
                            <Pressable onPress={() => setSelectedOutfitIds(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])} style={[styles.drawerItemCard, { backgroundColor: theme.background, borderColor: isSelected ? theme.tint : 'transparent', borderWidth: 2 }]}>
                              <View style={[styles.itemThumbContainer, { backgroundColor: theme.card }]}>
                                {item.image_url ? <Image source={{ uri: item.image_url }} style={item.itemThumb} /> : <Shirt size={24} color={theme.tint} />}
                                <View style={[styles.selectionBox, { borderColor: isSelected ? theme.tint : theme.text + '20', backgroundColor: isSelected ? theme.tint : 'transparent' }]}>{isSelected && <Check size={10} color="white" />}</View>
                                <TouchableOpacity style={[styles.targetToggle, { backgroundColor: item.target_user === 'pratishth' ? '#007AFF' : '#FF2D55' }]} onPress={() => toggleTargetUser(item)}><Text style={styles.targetToggleText}>{getOwnershipLabel(item)}</Text></TouchableOpacity>
                              </View>
                              <Text style={[styles.drawerItemName, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
                            </Pressable>
                          </GestureDetector>
                        );
                      })}</View></MotiView>)}
                    </AnimatePresence>
                  </View>
                ))}</ScrollView>
              </Animated.View>
            </Animated.View>
          )}
        </AnimatePresence>

        <Animated.View style={[animatedDragStyle, { pointerEvents: 'none' }]}>
          {activeDragItem && (<View style={{ alignItems: 'center' }}><Layers size={32} color="white" /><Text style={{ color: 'white', fontWeight: '900', marginTop: 4 }}>{selectedOutfitIds.length || 1}</Text></View>)}
        </Animated.View>

        <AddPinModal isVisible={isAddModalVisible} onClose={() => { setIsAddModalVisible(false); setFinishDayQueue([]); }} coordinate={targetCoordinate} isPlanMode={false} onSuccess={onMemorySuccess} />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mainContent: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20 },
  headerInfo: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  menuBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  weekday: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  title: { fontSize: 24, fontWeight: '900' },
  closeBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  stopsList: { flex: 1, padding: 20 },
  stopCard: { borderRadius: 24, padding: 20, marginBottom: 20, elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  stopHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 15 },
  sequenceBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  sequenceText: { color: 'white', fontSize: 12, fontWeight: '900' },
  stopName: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  attachedOutfits: { borderTopWidth: 1, paddingTop: 15 },
  outfitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  outfitItem: { alignItems: 'center', width: 60 },
  outfitThumbWrapper: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  outfitThumb: { width: '100%', height: '100%', borderRadius: 12 },
  removeOutfitBtn: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'white', zIndex: 10 },
  itemTargetMiniBadge: { position: 'absolute', bottom: -2, left: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'white' },
  itemTargetMiniText: { color: 'white', fontSize: 8, fontWeight: '900' },
  outfitName: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  drawerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 },
  drawer: { width: DRAWER_WIDTH, height: '100%', paddingHorizontal: 20, paddingTop: 60, elevation: 16 },
  drawerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  drawerTitle: { fontSize: 24, fontWeight: '900' },
  drawerActions: { marginBottom: 20 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12 },
  searchText: { fontSize: 14 },
  drawerContent: { flex: 1 },
  drawerCatSection: { marginBottom: 20 },
  drawerCatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  drawerCatTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  catCount: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  catCountText: { fontSize: 10, fontWeight: 'bold' },
  drawerItemsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 10 },
  drawerItemCard: { width: (DRAWER_WIDTH - 52) / 2, borderRadius: 16, padding: 10 },
  itemThumbContainer: { width: '100%', height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  itemThumb: { width: '100%', height: '100%', borderRadius: 12 },
  selectionBox: { position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: 6, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  targetToggle: { position: 'absolute', bottom: 5, left: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  targetToggleText: { color: 'white', fontSize: 8, fontWeight: '900' },
  drawerItemName: { fontSize: 10, fontWeight: '700' },
  finishDayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, borderRadius: 24, marginTop: 10, marginBottom: 30, elevation: 4 },
  finishDayText: { color: 'white', fontSize: 16, fontWeight: '900' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 18, fontWeight: '800', marginTop: 15 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typeText: { fontSize: 10, fontWeight: '700' },
  notesContainer: { padding: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.03)', marginBottom: 15 },
  notesText: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  memoryBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(175, 82, 222, 0.1)', justifyContent: 'center', alignItems: 'center' },
  centeredContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
});
