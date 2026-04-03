import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator, Modal, ScrollView, TextInput } from 'react-native';
import { X, Settings, Wallet, Briefcase, Plus, Save, Globe } from 'lucide-react-native';
import BottomSheet, { BottomSheetView, BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import { format, eachDayOfInterval } from 'date-fns';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';
import DayTimeline from './DayTimeline';
import TripFinance from './TripFinance';
import Wardrobe from './Wardrobe';
import Bucket from './Bucket';
import ActivityIcon from './ActivityIcon'; // 💓 RE-IMPORT LOTTIE ICON
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';

import DayReorderList from './DayReorderList';
import DayDetails from './DayDetails';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Props {
  tripId: string;
  onBack: () => void;
  mapRef: any;
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

export default function NewTripWorkspace({ tripId, onBack, mapRef }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [trip, setTrip] = useState<any>(null);
  const [days, setDays] = useState<any[]>([]);
  const [dayCounts, setDayCounts] = useState<Record<number, number>>({});
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  
  const [snapIndex, setSnapIndex] = useState(0);
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => [240, '55%', SCREEN_HEIGHT - 85], [SCREEN_HEIGHT]);

  // 🕹️ FAB & MODAL STATE
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'settings' | 'finance' | 'wardrobe' | 'bucket' | null>(null);

  // Settings Form State
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
      fetchTripData();
      fetchDayCounts();
      
      const itemSub = supabase.channel(`itinerary-sync-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter: `trip_id=eq.${tripId}` }, fetchDayCounts)
        .subscribe();
        
      return () => { supabase.removeChannel(itemSub); };
    }
  }, [tripId]);

  const fetchDayCounts = async () => {
    const { data } = await supabase.from('itinerary_items').select('day_number').eq('trip_id', tripId);
    if (data) {
      const counts: Record<number, number> = {};
      data.forEach(item => { counts[item.day_number] = (counts[item.day_number] || 0) + 1; });
      setDayCounts(counts);
    }
  };

  const fetchTripData = async () => {
    setLoading(true);
    const { data: tripData } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
    if (tripData) {
      setTrip(tripData);
      setEditTitle(tripData.title);
      setEditLocation(tripData.location_name);
      setEditCoords({ lat: tripData.latitude, lng: tripData.longitude });
      setStartDate(new Date(tripData.start_date));
      setEndDate(new Date(tripData.end_date));
      generateDays(tripData);
    }
    setLoading(false);
  };

  const generateDays = (tripData: any) => {
    if (!tripData?.start_date || !tripData?.end_date) return;
    try {
      const interval = eachDayOfInterval({ start: new Date(tripData.start_date), end: new Date(tripData.end_date) });
      const daysArr = interval.map((date, index) => ({ dayNumber: index + 1, date: date, weekday: format(date, 'EEEE') }));
      setDays(daysArr);
    } catch (e) { setDays([]); }
  };

  const handleReorderDays = async (newData: any[]) => {
    // Optimistic UI update
    setDays(newData);
    
    // In a real scenario, swapping days means updating the 'day_number' 
    // of all itinerary items associated with those days.
    // For now, we'll map the new order back to the database.
    try {
      for (let i = 0; i < newData.length; i++) {
        const originalDayNumber = newData[i].dayNumber;
        const newDayNumber = i + 1;
        
        if (originalDayNumber !== newDayNumber) {
          // Update all items from the original day to a temporary number first 
          // to avoid unique constraint violations if they exist
          await supabase
            .from('itinerary_items')
            .update({ day_number: 999 + newDayNumber })
            .eq('trip_id', tripId)
            .eq('day_number', originalDayNumber);
        }
      }

      for (let i = 0; i < newData.length; i++) {
        const newDayNumber = i + 1;
        await supabase
          .from('itinerary_items')
          .update({ day_number: newDayNumber })
          .eq('trip_id', tripId)
          .eq('day_number', 999 + newDayNumber);
      }
      
      fetchDayCounts();
    } catch (e) {
      console.error('Day reorder failed:', e);
    }
  };

  const handleAddToItinerary = async (bucketItem: any) => {
    const { error } = await supabase
      .from('itinerary_items')
      .insert([{
        trip_id: tripId,
        bucket_item_id: bucketItem.id,
        day_number: activeDayIndex + 1,
        sequence: (dayCounts[activeDayIndex + 1] || 0)
      }]);
    
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchDayCounts();
      Alert.alert("Added!", `${bucketItem.name} added to Day ${activeDayIndex + 1} ❤️`);
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

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]} pointerEvents="box-none">
      
      {/* 🏙️ TOP BACK BUTTON */}
      <SafeAreaView style={styles.topBackWrapper}>
        <TouchableOpacity onPress={onBack} style={styles.mainBackBtn}>
          <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <X size={24} color={theme.text} />
        </TouchableOpacity>
      </SafeAreaView>

      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        onChange={(idx) => { setSnapIndex(idx); if (idx > 0) setIsMenuOpen(false); }}
        backgroundComponent={GlassBackground}
        enableOverDrag={false}
        enableDynamicSizing={false}
        handleIndicatorStyle={{ backgroundColor: theme.tabIconDefault + '60', width: 40 }}
      >
        <BottomSheetView style={styles.sheetContent}>
          {loading ? (
            <View style={styles.loader}><ActivityIndicator color={theme.tint} /></View>
          ) : (
            <View style={{ flex: 1 }}>
              <AnimatePresence>
                {snapIndex === 0 && (
                  <MotiView key="mini" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.peekArea}>
                    <View style={styles.peekHeader}>
                      <Text style={[styles.peekTitle, { color: theme.text }]}>{trip?.title}</Text>
                      <Text style={[styles.peekSub, { color: theme.tabIconDefault }]}>{days.length} Days Planned</Text>
                    </View>
                    <DayTimeline days={days} activeDayIndex={activeDayIndex} onDayPress={(idx) => { setActiveDayIndex(idx); bottomSheetRef.current?.snapToIndex(1); }} />
                  </MotiView>
                )}
                {snapIndex === 1 && (
                  <MotiView key="mid" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.midArea}>
                    <Bucket 
                      tripId={tripId} 
                      userId="shared" 
                      mapRef={mapRef} 
                      onSelectItem={handleAddToItinerary} 
                    />
                  </MotiView>
                )}
                {snapIndex === 2 && (
                  <MotiView key="max" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.maxArea}>
                    <DayReorderList 
                      tripId={tripId} 
                      days={days} 
                      dayCounts={dayCounts} 
                      onReorder={setDays} 
                      onSelectDay={(d) => setSelectedDay(d)}
                      onAddFromBucket={(dayNum) => {
                        setActiveDayIndex(dayNum - 1);
                        bottomSheetRef.current?.snapToIndex(1);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                    />
                  </MotiView>
                )}
              </AnimatePresence>
            </View>
          )}
        </BottomSheetView>
      </BottomSheet>

      {/* 🚀 WORKSPACE FAB (Only visible at MIN height) */}
      {snapIndex === 0 && (
        <View style={styles.fabContainer}>
          <AnimatePresence>
            {isMenuOpen && (
              <MotiView style={styles.subFabMenu}>
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsMenuOpen(false); setActiveModal('settings'); }}>
                  <Settings size={20} color="#8E8E93" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsMenuOpen(false); setActiveModal('finance'); }}>
                  <Wallet size={20} color="#FF9500" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsMenuOpen(false); setActiveModal('wardrobe'); }}>
                  <Briefcase size={20} color="#5856D6" />
                </TouchableOpacity>
                
                {/* 💓 LOTTIE BUCKET ICON */}
                <TouchableOpacity style={styles.subFab} onPress={() => { setIsMenuOpen(false); bottomSheetRef.current?.snapToIndex(1); }}>
                  <ActivityIcon category="activity" size={28} color="#FF2D55" />
                </TouchableOpacity>
              </MotiView>
            )}
          </AnimatePresence>
          <TouchableOpacity activeOpacity={0.9} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setIsMenuOpen(!isMenuOpen); }} style={[styles.mainFab, { backgroundColor: theme.tint }]}><MotiView animate={{ rotate: isMenuOpen ? '45deg' : '0deg' }}><Plus size={28} color="white" /></MotiView></TouchableOpacity>
        </View>
      )}

      {/* MODALS */}
      <Modal visible={activeModal === 'settings'} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Plan Settings</Text><TouchableOpacity onPress={() => setActiveModal(null)}><X size={24} color={theme.text} /></TouchableOpacity></View>
            <ScrollView>
              <Text style={styles.label}>TRIP NAME</Text>
              <TextInput style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} value={editTitle} onChangeText={setEditTitle} />
              <Text style={[styles.label, { marginTop: 20 }]}>DESTINATION</Text>
              <TouchableOpacity onPress={() => setShowLocationPicker(true)} style={[styles.input, styles.locationBtn, { backgroundColor: theme.background }]}><Globe size={20} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '700', marginLeft: 10 }}>{editLocation || 'Change Location'}</Text></TouchableOpacity>
              <View style={styles.dateRow}>
                <TouchableOpacity onPress={() => setShowStartPicker(true)} style={[styles.dateBtn, { backgroundColor: theme.background }]}><Text style={styles.label}>START</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(startDate, 'dd MMM')}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowEndPicker(true)} style={[styles.dateBtn, { backgroundColor: theme.background }]}><Text style={styles.label}>END</Text><Text style={[styles.dateVal, { color: theme.text }]}>{format(endDate, 'dd MMM')}</Text></TouchableOpacity>
              </View>
              <TouchableOpacity onPress={handleUpdateSettings} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>{isUpdating ? <ActivityIndicator color="white" /> : <><Save size={20} color="white" /><Text style={styles.saveBtnText}>Save Changes</Text></>}</TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>
        {showStartPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />}
        {showEndPicker && <DateTimePicker value={endDate} mode="date" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />}
        <Modal visible={showLocationPicker} animationType="slide"><SmartLocationPicker title="Destination" onLocationCaptured={(d) => { setEditLocation(d.name); setEditCoords({lat:d.lat, lng:d.lng}); }} onClose={() => setShowLocationPicker(false)} /></Modal>
      </Modal>

      <Modal visible={activeModal === 'finance'} animationType="slide"><TripFinance tripId={tripId} trip={trip} onClose={() => setActiveModal(null)} /></Modal>
      <Modal visible={activeModal === 'wardrobe'} animationType="slide">
        <Wardrobe userId="shared" tripId={tripId} onClose={() => setActiveModal(null)} />
      </Modal>
      
      {selectedDay && (
        <Modal visible={!!selectedDay} animationType="slide">
          <DayDetails 
            tripId={tripId} 
            day={selectedDay} 
            onClose={() => setSelectedDay(null)} 
          />
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBackWrapper: { position: 'absolute', left: 20, zIndex: 1000 },
  mainBackBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  glassContainer: { borderTopLeftRadius: 35, borderTopRightRadius: 35, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  sheetContent: { flex: 1 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 50 },
  peekArea: { paddingHorizontal: 20, paddingTop: 5 },
  peekHeader: { marginBottom: 15, paddingHorizontal: 5 },
  peekTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -1 },
  peekSub: { fontSize: 13, fontWeight: '600' },
  midArea: { flex: 1, paddingHorizontal: 25, paddingTop: 10 },
  maxArea: { flex: 1, paddingHorizontal: 25, paddingTop: 10 },
  planningTitle: { fontSize: 22, fontWeight: '900', marginBottom: 25 },
  placeholderCard: { height: 200, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 35, borderStyle: 'dashed', borderWidth: 2, borderColor: 'rgba(150,150,150,0.2)', justifyContent: 'center', alignItems: 'center' },
  fabContainer: { position: 'absolute', bottom: 260, right: 20, alignItems: 'center', zIndex: 5000 },
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
  saveBtn: { height: 60, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 35 },
  saveBtnText: { color: 'white', fontSize: 17, fontWeight: '900' }
});
