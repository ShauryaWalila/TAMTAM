import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Alert, Image, Dimensions, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, MapPin, Plus, Shirt, Check, ChevronRight, Menu, Search, Filter, Tags, Package, Eye, Layers, User, Clock, Sparkles, CheckCircle2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolate } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import AddPinModal from '@/components/Map/AddPinModal';

const { width, height } = Dimensions.get('window');
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

  // Memories State
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [targetCoordinate, setTargetCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [targetName, setTargetName] = useState('');
  const [finishDayQueue, setFinishDayQueue] = useState<any[]>([]);

  // Animation values for the drawer visibility
  const drawerTranslateX = useSharedValue(-DRAWER_WIDTH);
  const isDrawerAutoClosed = useSharedValue(false);

  // Drag and Drop state
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const [activeDragItem, setActiveDragItem] = useState<any>(null);

  useEffect(() => {
    if (drawerOpen) {
      drawerTranslateX.value = withTiming(0, { duration: 300 });
      isDrawerAutoClosed.value = false;
    } else {
      drawerTranslateX.value = withTiming(-DRAWER_WIDTH, { duration: 300 });
    }
  }, [drawerOpen]);

  // Track layout of itinerary items for drop zones
  const itemLayouts = useRef<Record<string, { x: number, y: number, w: number, h: number }>>({});

  useEffect(() => {
    init();
    
    // Real-time subscriptions
    const tripWardrobeSub = supabase
      .channel('trip_wardrobe_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_wardrobe', filter: `trip_id=eq.${tripId}` }, () => fetchWardrobe())
      .subscribe();

    const outfitsSub = supabase
      .channel('outfit_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_outfits' }, () => fetchItinerary())
      .subscribe();

    const itSub = supabase
      .channel('itinerary_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items' }, () => fetchItinerary())
      .subscribe();

    const wardrobeSub = supabase
      .channel('wardrobe_global_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wardrobe' }, () => fetchWardrobe())
      .subscribe();

    return () => {
      supabase.removeChannel(tripWardrobeSub);
      supabase.removeChannel(outfitsSub);
      supabase.removeChannel(itSub);
      supabase.removeChannel(wardrobeSub);
    };
  }, [tripId, day]);

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
    if (!searchTerm) return wardrobe;
    const term = searchTerm.toLowerCase();
    return wardrobe.filter(item => 
      item.name?.toLowerCase().includes(term) || 
      item.category?.toLowerCase().includes(term)
    );
  }, [wardrobe, searchTerm]);

  // Auto-expand categories during search
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
    const payload = wardrobeItemIds.map(wId => ({
      itinerary_item_id: itineraryItemId,
      wardrobe_item_id: wId
    }));
    const { error } = await supabase.from('itinerary_outfits').upsert(payload);
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectedOutfitIds([]);
    } else {
      Alert.alert('Error', 'Failed to link outfits');
    }
  };

  const removeOutfit = async (itineraryItemId: string, wardrobeItemId: string) => {
    if (isReadOnly) return;
    await supabase.from('itinerary_outfits').delete()
      .eq('itinerary_item_id', itineraryItemId)
      .eq('wardrobe_item_id', wardrobeItemId);
  };

  const toggleTargetUser = async (item: any) => {
    if (isReadOnly) return;
    const newTarget = item.target_user === 'pratishth' ? 'love' : 'pratishth';
    await supabase.from('wardrobe').update({ target_user: newTarget }).eq('id', item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    } else {
      Alert.alert("No Location", "This activity has no coordinates to pin on the map.");
    }
  };

  const handleFinishDay = () => {
    const validItems = itinerary.filter(it => it.bucket_items?.latitude && it.bucket_items?.longitude);
    if (validItems.length === 0) {
      Alert.alert("No Stops", "You haven't visited any specific locations today to add memories.");
      return;
    }
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
      // Modal stays open, content updates
    } else {
      setFinishDayQueue([]);
      setIsAddModalVisible(false);
      Alert.alert("All Done!", "Your day's memories have been shared to Our Life.");
    }
  };

  // --- DRAG AND DROP LOGIC ---

  const handleDrop = (x: number, y: number, draggedItem: any) => {
    const targetItem = Object.entries(itemLayouts.current).find(([id, layout]) => {
      return x >= layout.x && x <= layout.x + layout.w &&
             y >= layout.y && y <= layout.y + layout.h;
    });

    if (targetItem) {
      const [itineraryItemId] = targetItem;
      const idsToLink = selectedOutfitIds.includes(draggedItem.id) ? selectedOutfitIds : [draggedItem.id];
      linkOutfits(itineraryItemId, idsToLink);
    }
    isDragging.value = false;
    setActiveDragItem(null);
  };

  const createPanGesture = (item: any) => Gesture.Pan()
    .onBegin(() => {
      if (isReadOnly) return;
      runOnJS(setActiveDragItem)(item);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
    })
    .onUpdate((e) => {
      dragX.value = e.absoluteX;
      dragY.value = e.absoluteY;
      isDragging.value = true;
      dragScale.value = withSpring(1.1);
      if (e.absoluteX > DRAWER_WIDTH + 20 && !isDrawerAutoClosed.value) {
        isDrawerAutoClosed.value = true;
        drawerTranslateX.value = withSpring(-DRAWER_WIDTH);
      }
    })
    .onFinalize((e) => {
      runOnJS(handleDrop)(e.absoluteX, e.absoluteY, item);
      dragScale.value = withSpring(1);
      if (isDrawerAutoClosed.value) runOnJS(setDrawerOpen)(false);
    });

  const animatedDragStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    top: -40, left: -40, width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.tint, justifyContent: 'center', alignItems: 'center',
    zIndex: 9999, opacity: isDragging.value ? 1 : 0,
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { scale: dragScale.value }],
    elevation: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10,
  }));

  const animatedDrawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drawerTranslateX.value }],
  }));

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
              <View>
                <Text style={[styles.weekday, { color: theme.text, opacity: 0.6 }]}>{day.weekday}</Text>
                <Text style={[styles.title, { color: theme.text }]}>Day {day.dayNumber}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.background }]}>
              <X size={24} color={theme.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.stopsList} showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator style={{ marginTop: 50 }} color={theme.tint} />
            ) : itinerary.length === 0 ? (
              <View style={styles.emptyState}>
                <Package size={48} color={theme.text} opacity={0.2} />
                <Text style={[styles.emptyText, { color: theme.text }]}>No stops planned for today.</Text>
                <Text style={[styles.emptySubText, { color: theme.text, opacity: 0.5 }]}>Add locations from the map to see them here.</Text>
              </View>
            ) : (
              <>
                {itinerary.map((item, index) => (
                  <View 
                    key={item.id} 
                    style={[styles.stopCard, { backgroundColor: theme.card }]}
                    onLayout={(e) => {
                      e.target.measure((x, y, w, h, pageX, pageY) => {
                        itemLayouts.current[item.id] = { x: pageX, y: pageY, w, h };
                      });
                    }}
                  >
                    <View style={styles.stopHeader}>
                      <View style={[styles.sequenceBadge, { backgroundColor: theme.tint }]}>
                        <Text style={styles.sequenceText}>{index + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.stopName, { color: theme.text }]}>
                          {item.is_custom ? item.custom_label : item.bucket_items?.name}
                        </Text>
                        {!item.is_custom && (
                          <View style={styles.typeBadge}>
                            <MapPin size={10} color={theme.text} opacity={0.5} />
                            <Text style={[styles.typeText, { color: theme.text, opacity: 0.5 }]}>{item.bucket_items?.category?.toUpperCase() || 'STOP'}</Text>
                          </View>
                        )}
                        {item.target_time && (
                          <View style={styles.timeBadge}>
                            <Clock size={12} color={theme.tint} />
                            <Text style={[styles.timeText, { color: theme.tint }]}>{item.target_time}</Text>
                          </View>
                        )}
                      </View>
                      <TouchableOpacity onPress={() => handleAddMemory(item)} style={styles.memoryBtn}>
                        <Sparkles size={18} color={theme.tint} />
                      </TouchableOpacity>
                    </View>

                    {item.notes && (
                      <View style={styles.notesContainer}>
                        <Text style={[styles.notesText, { color: theme.text, opacity: 0.7 }]}>{item.notes}</Text>
                      </View>
                    )}

                    <View style={[styles.attachedOutfits, { borderTopColor: theme.background }]}>
                      {item.itinerary_outfits?.length > 0 ? (
                        <View style={styles.outfitGrid}>
                          {item.itinerary_outfits.map((io: any) => {
                            const wItem = io.wardrobe;
                            if (!wItem) return null;
                            return (
                              <View key={wItem.id} style={styles.outfitItem}>
                                <View style={[styles.outfitThumbWrapper, { backgroundColor: theme.background }]}>
                                  {wItem.image_url ? (
                                    <Image source={{ uri: wItem.image_url }} style={styles.outfitThumb} />
                                  ) : (
                                    <View style={[styles.outfitPlaceholder, { backgroundColor: theme.card }]}>
                                      <Shirt size={14} color={theme.tint} />
                                    </View>
                                  )}
                                  {!isReadOnly && (
                                    <TouchableOpacity style={styles.removeOutfitBtn} onPress={() => removeOutfit(item.id, wItem.id)}><X size={10} color="white" /></TouchableOpacity>
                                  )}
                                  <View style={styles.itemTargetMiniBadge}><Text style={styles.itemTargetMiniText}>{getMiniLabel(wItem)}</Text></View>
                                </View>
                                <Text style={[styles.outfitName, { color: theme.text }]} numberOfLines={1}>{wItem.name}</Text>
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={styles.noOutfits}><Shirt size={16} color={theme.text} opacity={0.3} /><Text style={[styles.noOutfitsText, { color: theme.text, opacity: 0.4 }]}>Drag outfits here to plan</Text></View>
                      )}
                    </View>
                  </View>
                ))}
                
                <TouchableOpacity style={[styles.finishDayBtn, { backgroundColor: theme.tint }]} onPress={handleFinishDay}>
                  <CheckCircle2 size={20} color="white" />
                  <Text style={styles.finishDayText}>Finish Day & Add Memories</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={{ height: 100 }} />
          </ScrollView>
        </View>

        <AnimatePresence>
          {drawerOpen && (
            <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.drawerBackdrop}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} />
              <Animated.View style={[styles.drawer, { backgroundColor: theme.card }, animatedDrawerStyle]}>
                <View style={styles.drawerHeader}><Text style={[styles.drawerTitle, { color: theme.text }]}>Wardrobe</Text><TouchableOpacity onPress={() => setDrawerOpen(false)} style={[styles.closeBtn, { backgroundColor: theme.background }]}><X size={24} color={theme.text} /></TouchableOpacity></View>
                <View style={styles.drawerActions}><View style={[styles.searchBar, { backgroundColor: theme.background }]}><Search size={16} color={theme.text} opacity={0.5} /><TextInput style={[styles.searchText, { color: theme.text, flex: 1, padding: 0 }]} placeholder="Search clothes..." placeholderTextColor={theme.text + '50'} value={searchTerm} onChangeText={setSearchTerm} autoCorrect={false} />{searchTerm.length > 0 && (<TouchableOpacity onPress={() => setSearchTerm('')}><X size={14} color={theme.text} opacity={0.5} /></TouchableOpacity>)}</View></View>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.drawerContent}>
                  {Object.keys(groupedWardrobe).length === 0 ? (<View style={styles.centeredContent}><Search size={40} color={theme.text} opacity={0.1} /><Text style={[styles.emptySubText, { color: theme.text, opacity: 0.5 }]}>No matches found</Text></View>) : (
                    Object.keys(groupedWardrobe).map((cat) => (
                      <View key={cat} style={styles.drawerCatSection}><TouchableOpacity style={styles.drawerCatHeader} onPress={() => toggleCategory(cat)}><Text style={[styles.drawerCatTitle, { color: theme.text, opacity: 0.6 }]}>{cat.toUpperCase()}</Text><View style={[styles.catCount, { backgroundColor: theme.tint + '20' }]}><Text style={[styles.catCountText, { color: theme.tint }]}>{groupedWardrobe[cat].length}</Text></View></TouchableOpacity>
                        <AnimatePresence>{expandedCategories.includes(cat) && (<MotiView from={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'timing', duration: 300 }} style={{ overflow: 'hidden' }}><View style={styles.drawerItemsGrid}>
                                {groupedWardrobe[cat].map((item: any) => {
                                  const isSelected = selectedOutfitIds.includes(item.id);
                                  return (
                                    <GestureDetector key={item.id} gesture={createPanGesture(item)}><Pressable onPress={() => toggleOutfitSelection(item.id)} style={[styles.drawerItemCard, { backgroundColor: theme.background, borderColor: isSelected ? theme.tint : 'transparent', borderWidth: 2 }]}><View style={[styles.itemThumbContainer, { backgroundColor: theme.card }]}>{item.image_url ? (<Image source={{ uri: item.image_url }} style={styles.itemThumb} />) : (<View style={[styles.itemThumbPlaceholder, { backgroundColor: theme.background }]}><Shirt size={24} color={theme.tint} /></View>)}<View style={[styles.selectionBox, { borderColor: isSelected ? theme.tint : theme.text + '20', backgroundColor: isSelected ? theme.tint : 'transparent' }]}>{isSelected && <Check size={10} color="white" />}</View><TouchableOpacity style={[styles.targetToggle, { backgroundColor: item.target_user === 'pratishth' ? '#007AFF' : '#FF2D55' }]} onPress={() => toggleTargetUser(item)}><Text style={styles.targetToggleText}>{getOwnershipLabel(item)}</Text></TouchableOpacity></View><Text style={[styles.drawerItemName, { color: theme.text }]} numberOfLines={1}>{item.name}</Text></Pressable></GestureDetector>
                                  );
                                })}</View></MotiView>)}
                        </AnimatePresence></View>
                    ))
                  )}
                </ScrollView>
              </Animated.View>
            </MotiView>
          )}
        </AnimatePresence>
        <Animated.View style={[animatedDragStyle, { pointerEvents: 'none' }]}>
          {activeDragItem && (<View style={styles.dragGhost}><Layers size={32} color="white" /><Text style={styles.dragGhostCount}>{selectedOutfitIds.includes(activeDragItem.id) && selectedOutfitIds.length > 1 ? selectedOutfitIds.length : 1}</Text></View>)}
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
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  typeText: { fontSize: 10, fontWeight: '700' },
  attachedOutfits: { borderTopWidth: 1, paddingTop: 15 },
  outfitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  outfitItem: { alignItems: 'center', width: 60 },
  outfitThumbWrapper: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  outfitThumb: { width: '100%', height: '100%', borderRadius: 12 },
  outfitPlaceholder: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  removeOutfitBtn: { position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'white', zIndex: 10 },
  itemTargetMiniBadge: { position: 'absolute', bottom: -2, left: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#333', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'white' },
  itemTargetMiniText: { color: 'white', fontSize: 8, fontWeight: '900' },
  outfitName: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  noOutfits: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  noOutfitsText: { fontSize: 12, fontWeight: '500' },
  timeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  timeText: { fontSize: 11, fontWeight: '800' },
  notesContainer: { padding: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.03)', marginBottom: 15 },
  notesText: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  memoryBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(175, 82, 222, 0.1)', justifyContent: 'center', alignItems: 'center' },
  finishDayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, borderRadius: 24, marginTop: 10, marginBottom: 30, elevation: 4 },
  finishDayText: { color: 'white', fontSize: 16, fontWeight: '900' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  emptyText: { fontSize: 18, fontWeight: '800', marginTop: 15 },
  emptySubText: { fontSize: 14, marginTop: 5, textAlign: 'center' },
  drawerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000 },
  drawer: { width: DRAWER_WIDTH, height: '100%', paddingHorizontal: 20, paddingTop: 60, elevation: 16, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20 },
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
  drawerItemCard: { width: (DRAWER_WIDTH - 52) / 2, borderRadius: 16, padding: 10, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8 },
  itemThumbContainer: { width: '100%', height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  itemThumb: { width: '100%', height: '100%', borderRadius: 12 },
  itemThumbPlaceholder: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  selectionBox: { position: 'absolute', top: 5, right: 5, width: 18, height: 18, borderRadius: 6, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  targetToggle: { position: 'absolute', bottom: 5, left: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  targetToggleText: { color: 'white', fontSize: 8, fontWeight: '900' },
  drawerItemName: { fontSize: 12, fontWeight: '700' },
  dragGhost: { alignItems: 'center', justifyContent: 'center' },
  dragGhostCount: { color: 'white', fontSize: 14, fontWeight: '900', marginTop: 4 },
  centeredContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
});