import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, FlatList, Modal, TextInput, Platform, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { Palette, Briefcase, List, ChevronLeft, Plus, Menu, X, Globe, Settings, Save, Trash2, MapPin, Utensils, Camera, Landmark, Building2, MinusCircle, Wallet, CheckCircle2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import LottieView from 'lottie-react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, runOnJS } from 'react-native-reanimated';

import { format, eachDayOfInterval, isAfter } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

// ---------------------------------------------------------------------------
// 🚀 DYNAMIC WAVE COMPONENTS
// ---------------------------------------------------------------------------

const CategoryTick = ({ index, scrollX, itemIndex }: { index: number, scrollX: Animated.SharedValue<number>, itemIndex: number }) => {
  const animatedStyle = useAnimatedStyle(() => {
    const tickRelativePos = (index / TICKS_PER_ITEM) - 0.5;
    const globalTickPos = (itemIndex * ITEM_WIDTH) + (tickRelativePos * ITEM_WIDTH * 0.8);
    const distance = Math.abs(scrollX.value - globalTickPos);
    
    const h = 8 + 30 * Math.exp(-Math.pow(distance / 60, 2));
    const op = 0.1 + 0.8 * Math.exp(-Math.pow(distance / 60, 2));

    return {
      height: h,
      opacity: op,
      backgroundColor: distance < 10 ? '#FF2D55' : '#888', 
    };
  });

  return <Animated.View style={[styles.tickMark, animatedStyle]} />;
};

const CategoryDialItem = ({ cat, index, isSelected, theme, scrollX, activeDayItems, onRemoveItem, isDark }: any) => {
  return (
    <View style={{ width: ITEM_WIDTH, height: '100%', alignItems: 'center' }}>
      <View style={styles.dialContentWrapper}>
        <AnimatePresence>
          {isSelected && (
            <MotiView
              from={{ opacity: 0, scale: 0.95, translateY: 10 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              exit={{ opacity: 0, scale: 0.95, translateY: -10 }}
              transition={{ type: 'timing', duration: 250 }}
              style={styles.itineraryListContainer}
            >
              {activeDayItems.length === 0 ? (
                <View style={styles.emptyItinerary}>
                  <Text style={[styles.emptyItineraryText, { color: '#aaa' }]}>Tap a map pin to add to your plan</Text>
                </View>
              ) : (
                <ScrollView 
                  showsVerticalScrollIndicator={false} 
                  contentContainerStyle={styles.itineraryScroll}
                  style={{ flex: 1 }}
                >
                  {activeDayItems.map((item: any, idx: number) => (
                    <MotiView 
                      key={item.id}
                      from={{ opacity: 0, translateX: -15 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      transition={{ delay: idx * 40 }}
                      style={[styles.plannedItem, { borderLeftColor: cat.color, backgroundColor: '#FFFFFF' }]}
                    >
                      <View style={styles.plannedItemMain}>
                        <Text style={[styles.plannedItemText, { color: '#1A1A1A' }]} numberOfLines={1}>
                          {item.bucket_items?.name || item.name}
                        </Text>
                      </View>
                      <TouchableOpacity 
                        onPress={() => onRemoveItem(item.id)}
                        style={styles.removeItemBtn}
                        activeOpacity={0.6}
                      >
                        <Trash2 size={18} color="#FF3B30" />
                      </TouchableOpacity>
                    </MotiView>
                  ))}
                </ScrollView>
              )}
            </MotiView>
          )}
        </AnimatePresence>
      </View>
      
      {/* 🎡 Dial moves to bottom */}
      <View style={styles.bottomTickTrack}>
        {[...Array(TICKS_PER_ITEM)].map((_, j) => (
          <CategoryTick key={`tick-${index}-${j}`} index={j} itemIndex={index} scrollX={scrollX} />
        ))}
      </View>
    </View>
  );
};

const CategoryHeader = ({ name, isDark }: { name: string, isDark: boolean }) => {
  return (
    <View style={styles.headerTitleContainer}>
      <AnimatePresence mode="wait">
        <MotiView
          key={name}
          from={{ opacity: 0, translateY: 5 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: -5 }}
          transition={{ type: 'timing', duration: 200 }}
        >
          <Text style={[styles.sheetTitle, { color: Colors[isDark ? 'dark' : 'light'].text }]}>
            {name.toUpperCase()}
          </Text>
        </MotiView>
      </AnimatePresence>
    </View>
  );
};


export default function TripWorkspace({ tripId, onBack, userId, mapRef, onMarkersChange, onSnapChange, onDayChange }: TripWorkspaceProps) {
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
  const lastTickIndex = useRef(0);

  // 🕹️ FAB & MODAL STATE
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'settings' | 'finance' | 'wardrobe' | 'bucket' | 'canvas' | 'rack' | null>(null);

  // Settings State
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editCoords, setEditCoords] = useState<{lat: number, lng: number} | null>(null);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const triggerHaptic = (type: 'tick' | 'snap') => {
    if (type === 'snap') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.selectionAsync();
    }
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      const x = event.contentOffset.x;
      scrollX.value = x;
      
      const progress = x / ITEM_WIDTH;
      const distToSnap = Math.abs(progress - Math.round(progress));
      const hapticStep = 0.02 + (distToSnap * 0.3);
      
      if (Math.abs(progress - lastHapticProgress.value) > hapticStep) {
        runOnJS(triggerHaptic)('tick');
        lastHapticProgress.value = progress;
      }
    },
  });

  const onDialScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / ITEM_WIDTH);
    if (index >= 0 && index < dbCategories.length) {
      if (index !== lastTickIndex.current) {
        lastTickIndex.current = index;
        setActiveCategoryFilter(dbCategories[index].name);
        triggerHaptic('snap');
      }
    }
  };

  const handleRemoveFromDay = async (itemId: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const { error } = await supabase.from('itinerary_items').delete().eq('id', itemId);
      if (error) console.error('[REMOVE ERROR]', error);
    } catch (e) { console.error(e); }
  };

  // 🔒 READ-ONLY LOGIC
  const isPastTrip = trip?.end_date ? isAfter(new Date(), new Date(trip.end_date)) : false;
  const isReadOnly = isPastTrip || trip?.is_passed;

  useEffect(() => {
    if (tripId) {
      fetchTripData();
      fetchItinerary();
      fetchBucketItems();
      fetchCategories();

      const itSub = supabase.channel(`itinerary-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter: `trip_id=eq.${tripId}` }, () => fetchItinerary())
        .subscribe();

      const bucketSub = supabase.channel(`workspace-bucket-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_items', filter: `trip_id=eq.${tripId}` }, () => fetchBucketItems())
        .subscribe();

      const catSub = supabase.channel(`workspace-cat-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_categories', filter: `trip_id=eq.${tripId}` }, () => fetchCategories())
        .subscribe();

      return () => { 
        supabase.removeChannel(itSub);
        supabase.removeChannel(bucketSub);
        supabase.removeChannel(catSub);
      };
    }
  }, [tripId]);

  useEffect(() => {
    if (!onMarkersChange) return;
    
    let currentMarkers: any[] = [];
    const isMin = currentSnap === 'min';
    const isMid = currentSnap === 'mid';

    if (isMin) {
      currentMarkers = itineraryItems
        .filter(item => item.day_number === activeDayIndex + 1)
        .map(item => ({
          id: item.id,
          bucketItemId: item.bucket_item_id,
          name: item.bucket_items?.name,
          latitude: item.bucket_items?.latitude,
          longitude: item.bucket_items?.longitude,
          category: item.bucket_items?.category,
          isAssigned: true 
        }));
      onMarkersChange(currentMarkers);
    } else if (isMid) {
      const dayAssignedIds = itineraryItems
        .filter(i => i.day_number === activeDayIndex + 1)
        .map(i => i.bucket_item_id);

      // STRICT FILTER: Only show active category in MID mode
      currentMarkers = bucketItems
        .filter(bi => bi.category === activeCategoryFilter)
        .map(bi => ({
          id: bi.id,
          name: bi.name,
          latitude: bi.latitude,
          longitude: bi.longitude,
          category: bi.category,
          isAssigned: dayAssignedIds.includes(bi.id)
        }));
      onMarkersChange(currentMarkers);
    } else {
      onMarkersChange([]);
    }

    // 🗺️ SMART MODE-AWARE FRAMING
    if (mapRef?.current && (isMin || isMid)) {
      const validCoords = currentMarkers
        .filter(m => m.latitude && m.longitude)
        .map(m => ({ latitude: m.latitude, longitude: m.longitude }));

      const LAT_DELTA = isMin ? 0.02 : 0.05;
      const visualOffset = LAT_DELTA * (isMin ? 0.1 : 0.25);
      const bottomPadding = isMin ? 250 : SCREEN_HEIGHT * 0.55;

      if (validCoords.length > 1) {
        mapRef.current.fitToCoordinates(validCoords, {
          edgePadding: { top: 100, right: 80, bottom: bottomPadding, left: 80 },
          animated: true
        });
      } else if (validCoords.length === 1) {
        mapRef.current.animateToRegion({
          latitude: validCoords[0].latitude - visualOffset,
          longitude: validCoords[0].longitude,
          latitudeDelta: LAT_DELTA,
          longitudeDelta: LAT_DELTA
        }, 800);
      } else if (trip?.latitude && trip?.longitude) {
        mapRef.current.animateToRegion({
          latitude: trip.latitude - visualOffset,
          longitude: trip.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        }, 800);
      }
    }
  }, [currentSnap, activeDayIndex, itineraryItems, bucketItems, activeCategoryFilter, trip]);

  const fetchItinerary = async () => {
    const { data } = await supabase.from('itinerary_items').select('*, bucket_items(*)').eq('trip_id', tripId).order('sequence', { ascending: true });
    if (data) {
      setItineraryItems(data);
      const counts: Record<number, number> = {};
      data.forEach(item => { counts[item.day_number] = (counts[item.day_number] || 0) + 1; });
      setDayCounts(counts);
    }
  };

  const fetchBucketItems = async () => {
    const { data } = await supabase.from('bucket_items').select('*').eq('trip_id', tripId);
    if (data) setBucketItems(data);
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('bucket_categories').select('*').eq('trip_id', tripId).order('name', { ascending: true });
    if (data) {
      setDbCategories(data);
      if (data.length > 0 && !activeCategoryFilter) setActiveCategoryFilter(data[0].name);
    }
  };

  const fetchTripData = async () => {
    const { data } = await supabase.from('trips').select('*').eq('id', tripId).single();
    if (data) {
      setTrip(data);
      setEditTitle(data.title || '');
      setEditLocation(data.location_name || '');
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
    const { error } = await supabase.from('trips').update({
      title: editTitle,
      location_name: editLocation,
      latitude: editCoords?.lat,
      longitude: editCoords?.lng,
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString()
    }).eq('id', tripId);
    if (!error) {
      setActiveModal(null);
      fetchTripData();
    }
    setIsUpdating(false);
  };

  const handleDeleteTrip = async () => {
    Alert.alert(
      "Delete Plan",
      "Are you sure you want to permanently delete this entire plan? All locations, finances, and drawings will be lost. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete Plan", 
          style: "destructive", 
          onPress: async () => {
            try {
              setIsUpdating(true);
              // Deleting from 'trips' will cascade to all related tables
              const { error } = await supabase.from('trips').delete().eq('id', tripId);
              if (!error) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setActiveModal(null);
                onBack(); // Return to plans list
              } else {
                Alert.alert("Error", "Failed to delete plan.");
              }
            } catch (e) {
              console.error(e);
            } finally {
              setIsUpdating(false);
            }
          }
        }
      ]
    );
  };

  const handleSnapChange = useCallback((index: number) => {
    const snapKey: 'min' | 'mid' | 'max' = index === 0 ? 'min' : index === 1 ? 'mid' : 'max';
    setCurrentSnap(snapKey);
    if (onSnapChange) onSnapChange(snapKey);
    if (index > 0) setIsWorkspaceMenuOpen(false);
    
    // Reset Dial when snapping to MID
    if (snapKey === 'mid' && dbCategories.length > 0) {
      setActiveCategoryFilter(dbCategories[0].name);
      dialRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [dbCategories, onSnapChange]);

  const onMomentumScrollEnd = (event: any) => {
    if (currentSnap === 'min') {
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      setActiveDayIndex(index);
      if (onDayChange) onDayChange(index);
    }
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      
      {/* 🏙️ TOP BACK BUTTON */}
      <View style={[styles.topBackWrapper, { top: insets.top + 10 }]}>
        <TouchableOpacity onPress={onBack} style={styles.mainBackBtn}>
          <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <X size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* 🚀 WORKSPACE FAB (Only visible at MIN height AND when no day is selected) */}
      {currentSnap === 'min' && !selectedDay && (
        <View style={[styles.fabContainer, { bottom: 260 }]}>
          <AnimatePresence>
            {isWorkspaceMenuOpen && (
              <MotiView style={styles.subFabMenu}>
                {/* 1. Plan Settings */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('settings'); }}>
                  <Settings size={20} color="#8E8E93" />
                </TouchableOpacity>

                {/* 2. Draw Board */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('canvas'); }}>
                  <Palette size={20} color="#FF2D55" />
                </TouchableOpacity>

                {/* 3. Finance */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('finance'); }}>
                  <Wallet size={20} color="#FF9500" />
                </TouchableOpacity>

                {/* 4. Wardrobe */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('wardrobe'); }}>
                  <Briefcase size={20} color="#5856D6" />
                </TouchableOpacity>

                {/* 5. Bucket (Lottie) */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsWorkspaceMenuOpen(false); setActiveModal('bucket'); }}>
                  <LottieView
                    source={require('@/assets/lottie/activity.lottie')}
                    autoPlay
                    loop
                    style={{ width: 82, height: 82 }}
                  />
                </TouchableOpacity>
              </MotiView>
            )}
          </AnimatePresence>
          <TouchableOpacity activeOpacity={0.9} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen); }} style={[styles.mainFab, { backgroundColor: theme.tint }]}><MotiView animate={{ rotate: isWorkspaceMenuOpen ? '45deg' : '0deg' }}><Plus size={28} color="white" /></MotiView></TouchableOpacity>
        </View>
      )}

      {!selectedDay && (
        <BottomSheet
          ref={bottomSheetRef}
          index={0}
          snapPoints={snapPoints}
          onChange={handleSnapChange}
          backgroundComponent={GlassBackground}
          enableOverDrag={false}
          enableDynamicSizing={false}
          handleIndicatorStyle={{ backgroundColor: theme.tabIconDefault + '60', width: 40 }}
        >
          <BottomSheetView style={styles.sheetContent}>
            <View style={styles.sheetInnerHeader}>
              {currentSnap === 'mid' ? (
                <CategoryHeader name={activeCategoryFilter || 'EXPLORE'} isDark={isDark} />
              ) : (
                <Text style={[styles.sheetTitle, { color: theme.text }]}>{trip?.title || 'Trip Plan'}</Text>
              )}
            </View>
            
            <View style={styles.listWrapper}>
              {currentSnap === 'min' ? (
                <FlatList data={days} horizontal pagingEnabled keyExtractor={(_, i) => i.toString()} renderItem={({ item }) => (
                  <View style={{ width: width }}>
                    <TouchableOpacity style={[styles.dayCard, { width: width - 40, height: 130, marginHorizontal: 20 }]} onPress={() => setSelectedDay(item)}>
                      <View style={styles.dayCardInnerHorizontal}>
                        <Text style={styles.dayWeekday}>{item.weekday}</Text>
                        <Text style={[styles.dayNumber, { color: theme.text }]}>Day {item.dayNumber}</Text>
                        {(dayCounts[item.dayNumber] || 0) > 0 && (
                          <View style={[styles.countBadge, { backgroundColor: theme.tint + '15' }]}><MapPin size={10} color={theme.tint} /><Text style={[styles.countText, { color: theme.tint }]}>{dayCounts[item.dayNumber]} spots</Text></View>
                        )}
                        <Text style={styles.dayDate}>{item.date ? format(item.date, 'dd MMM yyyy') : 'Set Date'}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                )} showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onMomentumScrollEnd} snapToInterval={width} snapToAlignment="center" decelerationRate="fast" />
              ) : currentSnap === 'mid' ? (
                <View style={styles.dialWrapper}>
                  <Animated.ScrollView ref={dialRef} horizontal pagingEnabled onScroll={scrollHandler} scrollEventThrottle={16} onMomentumScrollEnd={(e) => {
                    const idx = Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH);
                    if (idx >= 0 && idx < dbCategories.length) {
                      runOnJS(setActiveCategoryFilter)(dbCategories[idx].name);
                      runOnJS(triggerHaptic)('snap');
                    }
                  }} showsHorizontalScrollIndicator={false} snapToInterval={ITEM_WIDTH} decelerationRate="fast">
                    {dbCategories.map((cat, i) => {
                      const activeDayItems = itineraryItems.filter(item => item.day_number === (activeDayIndex + 1) && (item.category?.toLowerCase() === cat.name.toLowerCase() || item.bucket_items?.category?.toLowerCase() === cat.name.toLowerCase()));
                      return <CategoryDialItem key={cat.id} cat={cat} index={i} isSelected={activeCategoryFilter === cat.name} theme={theme} scrollX={scrollX} activeDayItems={activeDayItems} onRemoveItem={handleRemoveFromDay} isDark={isDark} />;
                    })}
                  </Animated.ScrollView>
                </View>
              ) : (
                <DayReorderList tripId={tripId} days={days} dayCounts={dayCounts} onReorder={(newData) => setDays(newData)} onSelectDay={(d) => setSelectedDay(d)} onAddFromBucket={(dayNum) => { setActiveDayIndex(dayNum - 1); bottomSheetRef.current?.snapToIndex(1); }} />
              )}
            </View>
          </BottomSheetView>
        </BottomSheet>
      )}

      {/* MODALS */}
      <Modal visible={activeModal === 'settings'} animationType="slide" transparent>
        <View style={styles.modalOverlay}><BlurView intensity={100} tint={colorScheme} style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Plan Settings</Text><TouchableOpacity onPress={() => setActiveModal(null)}><X size={24} color={theme.text} /></TouchableOpacity></View><ScrollView><Text style={styles.label}>TRIP NAME</Text><TextInput style={[styles.input, { color: theme.text, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]} value={editTitle} onChangeText={setEditTitle} /><Text style={[styles.label, { marginTop: 20 }]}>DESTINATION</Text><TouchableOpacity onPress={() => setShowLocationPicker(true)} style={[styles.input, styles.locationBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Globe size={20} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700', marginLeft: 10 }}>{editLocation || 'Change Location'}</Text></TouchableOpacity><View style={styles.dateRow}><TouchableOpacity onPress={() => setShowStartPicker(true)} style={[styles.dateBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Text style={styles.label}>START</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(startDate, 'dd MMM')}</Text></TouchableOpacity><TouchableOpacity onPress={() => setShowEndPicker(true)} style={[styles.dateBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }]}><Text style={styles.label}>END</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(endDate, 'dd MMM')}</Text></TouchableOpacity></View><TouchableOpacity onPress={handleUpdateSettings} style={[styles.saveBtnFull, { backgroundColor: theme.tint }]}>{isUpdating ? <ActivityIndicator color="white" /> : <><Save size={20} color="white" /><Text style={styles.saveBtnText}>Save Changes</Text></>}</TouchableOpacity></ScrollView></BlurView></View>
        {showStartPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />}
        {showEndPicker && <DateTimePicker value={endDate} mode="date" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />}
        <Modal visible={showLocationPicker} animationType="slide"><SmartLocationPicker title="Destination" onLocationCaptured={(d) => { setEditLocation(d.name); setEditCoords({lat:d.lat, lng:d.lng}); }} onClose={() => setShowLocationPicker(false)} /></Modal>
      </Modal>

      <Modal visible={activeModal === 'finance'} animationType="slide"><TripFinance tripId={tripId} trip={trip} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'wardrobe'} animationType="slide"><Wardrobe userId={userId} tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'canvas'} animationType="slide"><SharedCanvas tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'rack'} animationType="slide"><TripRack tripId={tripId} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'bucket'} animationType="slide">
        <Bucket 
          tripId={tripId} 
          userId={userId} 
          onClose={() => setActiveModal(null)} 
          onSelectItem={(item) => {
            // Re-use logic to add from bucket
            const addItinerary = async (bucketItem: any) => {
              const { data: currentItems } = await supabase.from('itinerary_items').select('sequence').eq('trip_id', tripId).eq('day_number', activeDayIndex + 1).order('sequence', { ascending: false }).limit(1);
              const nextSeq = (currentItems?.[0]?.sequence || 0) + 1;
              await supabase.from('itinerary_items').upsert({
                trip_id: tripId,
                bucket_item_id: bucketItem.id,
                day_number: activeDayIndex + 1,
                sequence: nextSeq
              }, { onConflict: 'trip_id, day_number, bucket_item_id' });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            };
            addItinerary(item);
            setActiveModal(null);
          }}
          mapRef={mapRef}
        />
      </Modal>

      <AnimatePresence>
        {selectedDay && (
          <MotiView from={{ opacity: 0, translateY: SCREEN_HEIGHT }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: SCREEN_HEIGHT }} style={styles.fullOverlay}>
            <DayDetails tripId={tripId} day={selectedDay} isReadOnly={isReadOnly} onClose={() => setSelectedDay(null)} />
          </MotiView>
        )}
      </AnimatePresence>
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
  dialContentWrapper: { height: 200, width: '100%', justifyContent: 'center', alignItems: 'center' },
  itineraryListContainer: { width: width * 0.85, height: 180, borderRadius: 25, overflow: 'hidden' },
  itineraryScroll: { padding: 15 },
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
  saveBtnText: { color: 'white', fontSize: 17, fontWeight: '900' }
});
