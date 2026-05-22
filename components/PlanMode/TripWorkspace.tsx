import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, FlatList, Modal, TextInput, Platform, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { Palette, Briefcase, List, ChevronLeft, Plus, Menu, X, Globe, Settings, Save, Trash2, MapPin, Utensils, Camera, Landmark, Building2, MinusCircle, Wallet, CheckCircle2, Download, Music, Library } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import LottieView from 'lottie-react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';

import { format, eachDayOfInterval, isAfter } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import Bucket from './Bucket';
import Wardrobe from './Wardrobe';
import SharedCanvas from './SharedCanvas';
import DayDetails from './DayDetails';
import TripRack from './TripRack';
import DayTimeline from './DayTimeline';
import DayReorderList from './DayReorderList';
import TripFinance from './TripFinance';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';
import { TripSoundtrack } from './TripSoundtrack';
import * as Haptics from 'expo-haptics';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ITEM_WIDTH = width; 
const TICKS_PER_ITEM = 25;

interface TripWorkspaceProps {
  tripId: string;
  onBack: () => void;
  userId: string;
  mapRef?: any;
  onMarkersChange?: (markers: any[]) => void;
  onSnapChange?: (snap: 'min' | 'mid' | 'max') => void;
  onDayChange?: (dayIndex: number) => void;
  onCategoryChange?: (categoryName: string) => void;
  onFocusDay?: (dayNumber: number | null) => void;
}

const GlassBackground = ({ style }: BottomSheetBackgroundProps) => {
  const colorScheme = useColorScheme() ?? 'light';
  return (
    <View style={[style, styles.glassContainer]}>
      <BlurView intensity={80} tint={colorScheme} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colorScheme === 'light' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)' }]} />
    </View>
  );
};

const CategoryTick = ({ index, scrollX, itemIndex }: { index: number, scrollX: Animated.SharedValue<number>, itemIndex: number }) => {
  const animatedStyle = useAnimatedStyle(() => {
    const tickRelativePos = (index / TICKS_PER_ITEM) - 0.5;
    const globalTickPos = (itemIndex * ITEM_WIDTH) + (tickRelativePos * ITEM_WIDTH * 0.8);
    const distance = Math.abs(scrollX.value - globalTickPos);
    const h = 8 + 30 * Math.exp(-Math.pow(distance / 60, 2));
    const op = 0.1 + 0.8 * Math.exp(-Math.pow(distance / 60, 2));
    return { height: h, opacity: op, backgroundColor: distance < 10 ? '#FF2D55' : '#888' };
  });
  return <Animated.View style={[styles.tickMark, animatedStyle]} />;
};

const CategoryDialItem = ({ cat, index, isSelected, theme, scrollX, categoryBucketItems, dayAssignedIds, onAddItem, onRemoveItem, isDark }: any) => {
  return (
    <View style={{ width: ITEM_WIDTH, height: '100%', alignItems: 'center' }}>
      <View style={styles.dialContentWrapper}>
        <AnimatePresence>
          {isSelected && (
            <MotiView from={{ opacity: 0, scale: 0.95, translateY: 10 }} animate={{ opacity: 1, scale: 1, translateY: 0 }} exit={{ opacity: 0, scale: 0.95, translateY: -10 }} transition={{ type: 'timing', duration: 250 }} style={styles.itineraryListContainer}>
              {(() => {
                // Only show items already assigned to this day. Adding new ones
                // is done from the map (tap a pin → add button on callout).
                const plannedInCategory = (categoryBucketItems || [])
                  .map((item: any) => ({ item, assigned: dayAssignedIds.find((a: any) => a.bucket_item_id === item.id) }))
                  .filter((x: any) => !!x.assigned);
                if (plannedInCategory.length === 0) {
                  return (
                    <View style={styles.emptyItinerary}>
                      <Text style={[styles.emptyItineraryText, { color: '#aaa', textAlign: 'center' }]}>
                        No {cat.name.toLowerCase()} planned for this day yet.{'\n'}Tap a pin on the map to add one.
                      </Text>
                    </View>
                  );
                }
                return (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.itineraryScroll} style={{ flex: 1 }}>
                    {plannedInCategory.map(({ item, assigned }: any, idx: number) => (
                      <MotiView key={item.id} from={{ opacity: 0, translateX: -15 }} animate={{ opacity: 1, translateX: 0 }} transition={{ delay: idx * 40 }} style={[styles.plannedItem, { borderLeftColor: cat.color, backgroundColor: isDark ? '#1a2e1a' : '#F0FFF4' }]}>
                        <View style={styles.plannedItemMain}>
                          <Text style={[styles.plannedItemText, { color: isDark ? '#FFF' : '#1A1A1A' }]} numberOfLines={1}>{item.name}</Text>
                          <Text style={{ fontSize: 10, color: '#34C759', fontWeight: '800' }}>IN PLAN</Text>
                        </View>
                        <TouchableOpacity onPress={() => onRemoveItem(assigned.id)} style={styles.removeItemBtn} activeOpacity={0.6}>
                          <Trash2 size={18} color="#FF3B30" />
                        </TouchableOpacity>
                      </MotiView>
                    ))}
                  </ScrollView>
                );
              })()}
            </MotiView>
          )}
        </AnimatePresence>
      </View>
      <View style={styles.bottomTickTrack}>{[...Array(TICKS_PER_ITEM)].map((_, j) => <CategoryTick key={`tick-${index}-${j}`} index={j} itemIndex={index} scrollX={scrollX} />)}</View>
    </View>
  );
};

const CategoryHeader = ({ name, isDark }: { name: string, isDark: boolean }) => (
  <View style={styles.headerTitleContainer}><AnimatePresence mode="wait"><MotiView key={name} from={{ opacity: 0, translateY: 5 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: -5 }} transition={{ type: 'timing', duration: 200 }}><Text style={[styles.sheetTitle, { color: Colors[isDark ? 'dark' : 'light'].text }]}>{name.toUpperCase()}</Text></MotiView></AnimatePresence></View>
);

export default function TripWorkspace({ tripId, onBack, userId, mapRef, onMarkersChange, onSnapChange, onDayChange, onCategoryChange, onFocusDay }: TripWorkspaceProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [220, '55%', SCREEN_HEIGHT - 85], [SCREEN_HEIGHT]);
  const dialRef = useRef<Animated.ScrollView>(null);
  const [currentSnap, setCurrentSnap] = useState<'min' | 'mid' | 'max'>('min');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  const [trip, setTrip] = useState<any>(null);
  const [days, setDays] = useState<any[]>([]);
  const [itineraryItems, setItineraryItems] = useState<any[]>([]);
  const [bucketItems, setBucketItems] = useState<any[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [dayCounts, setDayCounts] = useState<Record<number, number>>({});
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('');
  
  const scrollX = useSharedValue(0);
  const lastHapticProgress = useSharedValue(0);

  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'settings' | 'finance' | 'wardrobe' | 'bucket' | 'canvas' | 'rack' | 'soundtrack' | 'masterSoundtrack' | null>(null);

  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editCoords, setEditCoords] = useState<{lat: number, lng: number} | null>(null);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (tripId) {
      fetchTripData(); fetchItinerary(); fetchBucketItems(); fetchCategories();
      const itSub = supabase.channel(`itinerary-${tripId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter: `trip_id=eq.${tripId}` }, () => fetchItinerary()).subscribe();
      const bucketSub = supabase.channel(`workspace-bucket-${tripId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_items', filter: `trip_id=eq.${tripId}` }, () => fetchBucketItems()).subscribe();
      const catSub = supabase.channel(`workspace-cat-${tripId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_categories', filter: `trip_id=eq.${tripId}` }, () => fetchCategories()).subscribe();
      return () => { supabase.removeChannel(itSub); supabase.removeChannel(bucketSub); supabase.removeChannel(catSub); };
    }
  }, [tripId]);

  const triggerHaptic = (type: 'tick' | 'snap') => type === 'snap' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const x = event.contentOffset.x; scrollX.value = x;
      const progress = x / ITEM_WIDTH;
      const distToSnap = Math.abs(progress - Math.round(progress));
      if (Math.abs(progress - lastHapticProgress.value) > (0.02 + distToSnap * 0.3)) { runOnJS(triggerHaptic)('tick'); lastHapticProgress.value = progress; }
    },
  });

  const handleRemoveFromDay = async (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const { error } = await supabase.from('itinerary_items').delete().eq('id', itemId);
    if (error) {
      console.warn('Remove from day failed', error);
      Alert.alert('Could not remove', error.message || 'Check Supabase delete policy on itinerary_items.');
    }
  };

  const fetchItinerary = async () => {
    const { data } = await supabase.from('itinerary_items')
      .select('*, bucket_items(*), itinerary_outfits(wardrobe_item_id, wardrobe(*))')
      .eq('trip_id', tripId)
      .order('day_number', { ascending: true })
      .order('sequence', { ascending: true });
    if (data) { 
      setItineraryItems(data); 
      const counts: Record<number, number> = {}; 
      data.forEach(item => { counts[item.day_number] = (counts[item.day_number] || 0) + 1; }); 
      setDayCounts(counts); 
    }
  };

  const handleExportFullItinerary = async () => {
    if (itineraryItems.length === 0) {
      Alert.alert("Empty Itinerary", "No items to export yet!");
      return;
    }
    
    try {
      // Group items by day
      const itemsByDay: Record<number, any[]> = {};
      itineraryItems.forEach(item => {
        if (!itemsByDay[item.day_number]) itemsByDay[item.day_number] = [];
        itemsByDay[item.day_number].push(item);
      });

      const sortedDays = Object.keys(itemsByDay).map(Number).sort((a, b) => a - b);

      const html = `
        <html>
          <head>
            <style>
              body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #1a1a1a; }
              .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
              h1 { font-size: 34px; font-weight: 900; margin-bottom: 8px; color: #000; }
              .location { font-size: 20px; color: ${theme.tint}; font-weight: 800; margin-bottom: 5px; }
              .dates { font-size: 15px; color: #444; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700; }
              
              .day-section { margin-top: 50px; page-break-before: auto; }
              .day-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 25px; border-left: 6px solid ${theme.tint}; padding-left: 18px; }
              .day-title { font-size: 28px; font-weight: 900; color: #000; }
              .day-date { font-size: 18px; color: #222; font-weight: 700; }

              .stop { margin-bottom: 35px; padding-bottom: 20px; border-bottom: 1px solid #eee; page-break-inside: avoid; }
              .stop-row { display: flex; align-items: flex-start; }
              .sequence { width: 32px; height: 32px; border-radius: 16px; background-color: #333; color: #fff; display: flex; justify-content: center; align-items: center; font-weight: 900; margin-right: 15px; font-size: 14px; flex-shrink: 0; }
              .stop-info { flex: 1; }
              .stop-name { font-size: 22px; font-weight: 900; color: #000; margin: 0; }
              .stop-meta { font-size: 12px; font-weight: 800; color: #555; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 8px; }
              .time-badge { background: #f0f0f0; color: ${theme.tint}; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 900; }
              
              .clothes-section { margin-top: 18px; padding-left: 47px; }
              .outfit-grid { display: flex; flex-wrap: wrap; gap: 20px; }
              .outfit-item { text-align: center; width: 75px; position: relative; }
              .outfit-thumb { width: 70px; height: 70px; border-radius: 14px; object-fit: cover; background-color: #fff; margin-bottom: 6px; }
              .outfit-name { font-size: 10px; font-weight: 700; color: #333; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
              
              .owner-badge { position: absolute; top: -5px; left: -5px; background: #333; color: #fff; font-size: 8px; font-weight: 900; padding: 3px 6px; border-radius: 6px; border: 1.5px solid #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              .owner-p { background: #007AFF; }
              .owner-s { background: #FF2D55; }

              footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; font-size: 12px; color: #888; font-weight: 600; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>${trip?.title || 'Our Adventure'}</h1>
              <div class="location">${trip?.location_name || ''}</div>
              <div class="dates">${trip?.start_date ? format(new Date(trip.start_date), 'dd MMM') : ''} - ${trip?.end_date ? format(new Date(trip.end_date), 'dd MMM yyyy') : ''}</div>
            </div>

            ${sortedDays.map(dayNum => {
              const dayItems = itemsByDay[dayNum];
              const dayData = days.find(d => d.dayNumber === dayNum);
              return `
                <div class="day-section">
                  <div class="day-header">
                    <span class="day-title">Day ${dayNum}</span>
                    <span class="day-date">${dayData?.weekday || ''}${dayData?.date ? ', ' + format(dayData.date, 'dd MMM') : ''}</span>
                  </div>
                  ${dayItems.map((item, idx) => `
                    <div class="stop">
                      <div class="stop-row">
                        <div class="sequence">${idx + 1}</div>
                        <div class="stop-info">
                          <h3 class="stop-name">${item.is_custom ? item.custom_label : (item.bucket_items?.name || 'Unnamed Stop')}</h3>
                          <div class="stop-meta">
                            ${item.bucket_items?.category || 'Planned Stop'}
                            ${item.target_time ? `<span class="time-badge">${item.target_time}</span>` : ''}
                          </div>
                        </div>
                      </div>
                      ${item.itinerary_outfits?.length > 0 ? `
                        <div class="clothes-section">
                          <div class="outfit-grid">
                            ${item.itinerary_outfits.map((io: any) => {
                              const isP = io.wardrobe?.target_user === 'pratishth';
                              const label = isP ? 'P' : 'S';
                              const badgeClass = isP ? 'owner-p' : 'owner-s';
                              return `
                                <div class="outfit-item">
                                  <div class="owner-badge ${badgeClass}">${label}</div>
                                  ${io.wardrobe?.image_url ? `<img src="${io.wardrobe.image_url}" class="outfit-thumb" />` : `<div style="height:20px;"></div>`}
                                  <span class="outfit-name">${io.wardrobe?.name || 'Item'}</span>
                                </div>
                              `;
                            }).join('')}
                          </div>
                        </div>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              `;
            }).join('')}
            
            <footer>Generated by TAMTAM • Our Life together</footer>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
      await Sharing.shareAsync(uri);
    } catch (e) {
      console.error(e);
      Alert.alert("Export Error", "Could not generate full itinerary PDF");
    }
  };

  const fetchBucketItems = async () => {
    const { data } = await supabase.from('bucket_items').select('*').eq('trip_id', tripId);
    if (data) setBucketItems(data);
  };

  // Push bucket items as map markers whenever they (or the itinerary) change.
  // `isAssigned` is true if the bucket item is already in any day's itinerary.
  // NOTE: `onMarkersChange` is intentionally NOT in the deps. Parent passes a
  // fresh arrow each render; including it caused an infinite re-render loop
  // that froze the bottom sheet. Capture latest via ref instead.
  const onMarkersChangeRef = React.useRef(onMarkersChange);
  React.useEffect(() => { onMarkersChangeRef.current = onMarkersChange; }, [onMarkersChange]);
  const onCategoryChangeRef = React.useRef(onCategoryChange);
  React.useEffect(() => { onCategoryChangeRef.current = onCategoryChange; }, [onCategoryChange]);
  React.useEffect(() => {
    if (onCategoryChangeRef.current) onCategoryChangeRef.current(activeCategoryFilter || '');
  }, [activeCategoryFilter]);
  const didFitRef = React.useRef(false);
  React.useEffect(() => {
    const cb = onMarkersChangeRef.current;
    if (!cb) return;
    // Build a map of bucket_item_id -> day_number for "assigned" info.
    const dayByItemId = new Map<string, number>();
    (itineraryItems || []).forEach((it: any) => {
      if (it && it.bucket_item_id && it.day_number != null && !dayByItemId.has(it.bucket_item_id)) {
        dayByItemId.set(it.bucket_item_id, it.day_number);
      }
    });
    const markers = (bucketItems || [])
      .filter((b: any) => b.latitude != null && b.longitude != null)
      .map((b: any) => ({
        id: b.id,
        latitude: Number(b.latitude),
        longitude: Number(b.longitude),
        name: b.name,
        category: b.category,
        notes: b.notes,
        isAssigned: dayByItemId.has(b.id),
        dayNumber: dayByItemId.get(b.id) ?? null,
      }));
    cb(markers);

    // First time we get markers, pan the map so they're visible. Trip pins are
    // often in a different region than the user's current location, so the
    // map's initialRegion ends up empty without this.
    if (!didFitRef.current && markers.length > 0 && mapRef?.current) {
      didFitRef.current = true;
      try {
        if (markers.length === 1) {
          mapRef.current.animateToRegion({
            latitude: markers[0].latitude,
            longitude: markers[0].longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }, 600);
        } else {
          mapRef.current.fitToCoordinates(
            markers.map((m: any) => ({ latitude: m.latitude, longitude: m.longitude })),
            { edgePadding: { top: 100, bottom: 300, left: 60, right: 60 }, animated: true }
          );
        }
      } catch {}
    }
  }, [bucketItems, itineraryItems]);

  const fetchCategories = async () => {
    const { data } = await supabase.from('bucket_categories').select('*').eq('trip_id', tripId).order('name', { ascending: true });
    if (data) { setDbCategories(data); if (data.length > 0 && !activeCategoryFilter) setActiveCategoryFilter(data[0].name); }
  };

  const fetchTripData = async () => {
    const { data } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (data) {
      setTrip(data); setEditTitle(data.title || ''); setEditLocation(data.location_name || '');
      if (data.latitude && data.longitude) setEditCoords({ lat: data.latitude, lng: data.longitude });
      if (data.start_date) setStartDate(new Date(data.start_date));
      if (data.end_date) setEndDate(new Date(data.end_date));
      if (data.start_date && data.end_date) {
        try {
          const interval = eachDayOfInterval({ start: new Date(data.start_date), end: new Date(data.end_date) });
          setDays(interval.map((date, index) => ({ dayNumber: index + 1, date: date, weekday: format(date, 'EEEE') })));
        } catch (e) { setDays([{ dayNumber: 1, weekday: 'TBD', date: new Date() }]); }
      }
    }
  };

  const handleUpdateSettings = async () => {
    setIsUpdating(true);
    const { error } = await supabase.from('trips').update({ title: editTitle, location_name: editLocation, latitude: editCoords?.lat, longitude: editCoords?.lng, start_date: startDate.toISOString(), end_date: endDate.toISOString() }).eq('id', tripId);
    if (!error) { setActiveModal(null); fetchTripData(); }
    setIsUpdating(false);
  };

  const handleSnapChange = useCallback((index: number) => {
    const snapKey: 'min' | 'mid' | 'max' = index === 0 ? 'min' : index === 1 ? 'mid' : 'max';
    setCurrentSnap(snapKey); if (onSnapChange) onSnapChange(snapKey);
    if (index > 0) setIsWorkspaceMenuOpen(false);
    if (snapKey === 'mid' && dbCategories.length > 0) { setActiveCategoryFilter(dbCategories[0].name); dialRef.current?.scrollTo({ x: 0, animated: false }); }
  }, [dbCategories, onSnapChange]);

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={[styles.topBackWrapper, { top: insets.top + 10 }]}><TouchableOpacity onPress={onBack} style={styles.mainBackBtn}><BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} /><X size={24} color={theme.text} /></TouchableOpacity></View>

      {currentSnap === 'min' && !selectedDay && (
        <View style={[styles.fabContainer, { bottom: 260 }]}>
          <AnimatePresence>{isWorkspaceMenuOpen && (
            <MotiView style={styles.subFabMenu}>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('settings'); }}><Settings size={20} color="#8E8E93" /></TouchableOpacity>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('canvas'); }}><Palette size={20} color="#FF2D55" /></TouchableOpacity>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('soundtrack'); }}><Music size={20} color="#1DB954" /></TouchableOpacity>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('finance'); }}><Wallet size={20} color="#FF9500" /></TouchableOpacity>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('wardrobe'); }}><Briefcase size={20} color="#5856D6" /></TouchableOpacity>
              <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('bucket'); }}><LottieView source={require('@/assets/lottie/activity.lottie')} autoPlay loop style={{ width: 82, height: 82 }} /></TouchableOpacity>
              <TouchableOpacity style={[styles.subFab, { backgroundColor: theme.tint }]} onPress={() => { setIsWorkspaceMenuOpen(false); handleExportFullItinerary(); }}><Download size={20} color="white" /></TouchableOpacity>
            </MotiView>
          )}</AnimatePresence>
          <TouchableOpacity activeOpacity={0.9} onPress={() => { Haptics.selectionAsync(); setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen); }} style={[styles.mainFab, { backgroundColor: theme.tint }]}><MotiView animate={{ rotate: isWorkspaceMenuOpen ? '45deg' : '0deg' }}><Plus size={28} color="white" /></MotiView></TouchableOpacity>
        </View>
      )}

      {!selectedDay && (
        <BottomSheet ref={bottomSheetRef} index={0} snapPoints={snapPoints} onChange={handleSnapChange} backgroundComponent={GlassBackground} enableOverDrag={false} enableDynamicSizing={false} handleIndicatorStyle={{ backgroundColor: theme.tabIconDefault + '60', width: 40 }}>
          <BottomSheetView style={styles.sheetContent}>
            <View style={styles.sheetInnerHeader}>{currentSnap === 'mid' ? <CategoryHeader name={activeCategoryFilter || 'EXPLORE'} isDark={isDark} /> : <Text style={[styles.sheetTitle, { color: theme.text }]}>{trip?.title || 'Trip Plan'}</Text>}</View>
            <View style={styles.listWrapper}>
              {currentSnap === 'min' ? <FlatList data={days} horizontal pagingEnabled keyExtractor={(_, i) => i.toString()} renderItem={({ item }) => (<View style={{ width: width }}><TouchableOpacity style={[styles.dayCard, { width: width - 40, height: 130, marginHorizontal: 20 }]} onPress={() => setSelectedDay(item)}><View style={styles.dayCardInnerHorizontal}><Text style={styles.dayWeekday}>{item.weekday}</Text><Text style={[styles.dayNumber, { color: theme.text }]}>Day {item.dayNumber}</Text>{(dayCounts[item.dayNumber] || 0) > 0 && <View style={[styles.countBadge, { backgroundColor: theme.tint + '15' }]}><MapPin size={10} color={theme.tint} /><Text style={[styles.countText, { color: theme.tint }]}>{dayCounts[item.dayNumber]} spots</Text></View>}<Text style={styles.dayDate}>{item.date ? format(item.date, 'dd MMM yyyy') : 'Set Date'}</Text></View></TouchableOpacity></View>)} showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.x / width); setActiveDayIndex(idx); if(onDayChange) onDayChange(idx); }} snapToInterval={width} snapToAlignment="center" decelerationRate="fast" />
              : currentSnap === 'mid' ? <View style={styles.dialWrapper}><Animated.ScrollView ref={dialRef} horizontal pagingEnabled onScroll={scrollHandler} scrollEventThrottle={16} onMomentumScrollEnd={(e) => { const idx = Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH); if (idx >= 0 && idx < dbCategories.length) { runOnJS(setActiveCategoryFilter)(dbCategories[idx].name); runOnJS(triggerHaptic)('snap'); } }} showsHorizontalScrollIndicator={false} snapToInterval={ITEM_WIDTH} decelerationRate="fast">{dbCategories.map((cat, i) => { const categoryBucketItems = bucketItems.filter(bi => bi.category?.toLowerCase() === cat.name.toLowerCase()); const dayAssignedIds = itineraryItems.filter(i => i.day_number === activeDayIndex + 1); return <CategoryDialItem key={cat.id} cat={cat} index={i} isSelected={activeCategoryFilter === cat.name} theme={theme} scrollX={scrollX} categoryBucketItems={categoryBucketItems} dayAssignedIds={dayAssignedIds} onAddItem={async (bucketItem: any) => { await supabase.from('itinerary_items').upsert({ trip_id: tripId, bucket_item_id: bucketItem.id, day_number: activeDayIndex + 1, sequence: (dayAssignedIds.length || 0) + 1 }, { onConflict: 'trip_id, day_number, bucket_item_id' }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); fetchItinerary(); }} onRemoveItem={handleRemoveFromDay} isDark={isDark} /> ; })}</Animated.ScrollView></View>
              : <DayReorderList tripId={tripId} days={days} dayCounts={dayCounts} onReorder={(newData) => setDays(newData)} onSelectDay={(d) => setSelectedDay(d)} onAddFromBucket={(dayNum) => { setActiveDayIndex(dayNum - 1); bottomSheetRef.current?.snapToIndex(1); }} onFocusDay={(dayNum) => { if (onFocusDay) onFocusDay(dayNum); }} />}
            </View>
          </BottomSheetView>
        </BottomSheet>
      )}

      <Modal visible={activeModal === 'settings'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Plan Settings</Text><TouchableOpacity onPress={() => setActiveModal(null)}><X size={24} color={theme.text} /></TouchableOpacity></View>
            <ScrollView>
              <TouchableOpacity 
                style={[styles.saveBtnFull, { backgroundColor: '#1DB954', marginTop: 0, marginBottom: 25 }]} 
                onPress={() => setActiveModal('masterSoundtrack')}
              >
                <Music size={20} color="white" />
                <Text style={styles.saveBtnText}>Our Songs (Master List)</Text>
              </TouchableOpacity>

              <Text style={styles.label}>TRIP NAME</Text><TextInput style={[styles.input, { color: theme.text, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} value={editTitle} onChangeText={setEditTitle} /><Text style={[styles.label, { marginTop: 20 }]}>DESTINATION</Text><TouchableOpacity onPress={() => setShowLocationPicker(true)} style={[styles.input, styles.locationBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Globe size={20} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700', marginLeft: 10 }}>{editLocation || 'Change Location'}</Text></TouchableOpacity><View style={styles.dateRow}><TouchableOpacity onPress={() => setShowStartPicker(true)} style={[styles.dateBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Text style={styles.label}>START</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(startDate, 'dd MMM')}</Text></TouchableOpacity><TouchableOpacity onPress={() => setShowEndPicker(true)} style={[styles.dateBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Text style={styles.label}>END</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(endDate, 'dd MMM')}</Text></TouchableOpacity></View><TouchableOpacity onPress={handleUpdateSettings} style={[styles.saveBtnFull, { backgroundColor: theme.tint }]}>{isUpdating ? <ActivityIndicator color="white" /> : <><Save size={20} color="white" /><Text style={styles.saveBtnText}>Save Changes</Text></>}</TouchableOpacity></ScrollView>
          </BlurView>
        </View>
        <Modal visible={showStartPicker || showEndPicker} transparent animationType="fade">
          <View style={styles.pickerOverlayCenter}>
            <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.pickerCard, { backgroundColor: theme.card }]}>
              <Text style={[styles.pickerTitle, { color: theme.text }]}>Select Date</Text>
              <DateTimePicker 
                value={showStartPicker ? startDate : endDate} 
                mode="date" 
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                themeVariant={colorScheme}
                onChange={(e, d) => { 
                  if (Platform.OS === 'android') { setShowStartPicker(false); setShowEndPicker(false); }
                  if (d) { if (showStartPicker) setStartDate(d); else setEndDate(d); }
                }} 
                style={{ height: 350 }} 
              />
              <TouchableOpacity 
                style={[styles.doneBtn, { backgroundColor: theme.tint }]} 
                onPress={() => { setShowStartPicker(false); setShowEndPicker(false); }}
              >
                <Text style={styles.doneBtnText}>Confirm Selection</Text>
              </TouchableOpacity>
            </MotiView>
          </View>
        </Modal>
        <Modal visible={showLocationPicker} animationType="slide"><SmartLocationPicker title="Destination" onLocationCaptured={(d) => { setEditLocation(d.name); setEditCoords({lat:d.lat, lng:d.lng}); }} onClose={() => setShowLocationPicker(false)} /></Modal>
      </Modal>

      <Modal visible={activeModal === 'finance'} animationType="slide"><TripFinance tripId={tripId} trip={trip} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'soundtrack'} animationType="slide"><TripSoundtrack tripId={tripId} tripName={trip?.title} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'masterSoundtrack'} animationType="slide"><TripSoundtrack tripId="MASTER" tripName="Master Collection" isMaster onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'wardrobe'} animationType="slide"><Wardrobe userId={userId} tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'canvas'} animationType="slide"><SharedCanvas tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'rack'} animationType="slide"><TripRack tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'bucket'} animationType="slide"><Bucket tripId={tripId} userId={userId} onClose={() => setActiveModal(null)} onSelectItem={(item) => { setActiveModal(null); bottomSheetRef.current?.snapToIndex(1); const catIndex = dbCategories.findIndex(c => c.name === item.category); if (catIndex !== -1) { setActiveCategoryFilter(item.category); dialRef.current?.scrollTo({ x: catIndex * ITEM_WIDTH, animated: true }); } if (mapRef?.current && item.latitude) mapRef.current.animateToRegion({ latitude: item.latitude - 0.015, longitude: item.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 1000); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} mapRef={mapRef} /></Modal>

      <AnimatePresence>{selectedDay && (<MotiView from={{ opacity: 0, translateY: SCREEN_HEIGHT }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: SCREEN_HEIGHT }} style={styles.fullOverlay}><DayDetails tripId={tripId} day={selectedDay} onClose={() => setSelectedDay(null)} /></MotiView>)}</AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 },
  topBackWrapper: { position: 'absolute', left: 20, zIndex: 3000 },
  mainBackBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  fullOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 4000 },
  glassContainer: { borderTopLeftRadius: 35, borderTopRightRadius: 35, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  sheetContent: { flex: 1 },
  sheetInnerHeader: { paddingHorizontal: 20, marginBottom: 15 },
  sheetTitle: { fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  listWrapper: { flex: 1 },
  dayCard: { padding: 20, borderRadius: 25, backgroundColor: 'rgba(0,0,0,0.04)', alignItems: 'center', justifyContent: 'center' },
  dayCardInnerHorizontal: { alignItems: 'center', width: '100%' },
  dayWeekday: { fontSize: 12, color: '#888', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  dayNumber: { fontSize: 22, fontWeight: 'bold', marginVertical: 4 },
  dayDate: { fontSize: 14, color: '#888' },
  countBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, marginTop: 5 },
  countText: { fontSize: 10, fontWeight: 'bold', marginLeft: 4 },
  dialWrapper: { flex: 1, paddingBottom: 20 },
  dialContentWrapper: { height: 300, width: '100%', justifyContent: 'center', alignItems: 'center' },
  itineraryListContainer: { width: width * 0.85, height: 180, borderRadius: 25, overflow: 'hidden' },
  itineraryScroll: { padding: 15, paddingBottom: 20 },
  emptyItinerary: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyItineraryText: { fontSize: 13, fontWeight: '600', textAlign: 'center', lineHeight: 18 },
  plannedItem: { padding: 16, borderRadius: 20, marginBottom: 12, borderLeftWidth: 6, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 3 },
  plannedItemMain: { flex: 1 },
  plannedItemText: { fontSize: 16, fontWeight: '900', letterSpacing: -0.3 },
  removeItemBtn: { padding: 5, marginLeft: 10 },
  headerTitleContainer: { height: 30, justifyContent: 'center', alignItems: 'center' },
  bottomTickTrack: { position: 'absolute', bottom: 0, width: '100%', height: 60, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 10, paddingBottom: 10 },
  tickMark: { width: 3, borderRadius: 1.5, backgroundColor: '#888' },
  fabContainer: { position: 'absolute', right: 20, alignItems: 'center', zIndex: 5000 },
  mainFab: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 12 },
  subFabMenu: { gap: 12, marginBottom: 12, alignItems: 'center' },
  subFab: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'white', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '85%', borderTopLeftRadius: 35, borderTopRightRadius: 35, padding: 25, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  label: { fontSize: 11, fontWeight: '900', color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700', marginBottom: 5, justifyContent: 'center' },
  locationBtn: { flexDirection: 'row', alignItems: 'center' },
  dateRow: { flexDirection: 'row', gap: 15, marginTop: 20 },
  dateBtn: { flex: 1, padding: 15, borderRadius: 18 },
  dateVal: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  saveBtnFull: { height: 60, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 35 },
  saveBtnText: { color: 'white', fontSize: 17, fontWeight: '900' },
  pickerOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  pickerCard: { width: '100%', borderRadius: 32, padding: 25, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  pickerTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  doneBtn: { height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  doneBtnText: { color: 'white', fontSize: 16, fontWeight: '800' }
});
