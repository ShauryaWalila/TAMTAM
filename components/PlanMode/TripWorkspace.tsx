import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Image, Modal, TextInput, Alert, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Calendar, MapPin, ChevronRight, Menu, Search, Palette, Wallet, Briefcase, Plus, TrendingUp, RotateCcw, Download, Settings, Trash2, Camera, Globe, CheckCircle2, Save } from 'lucide-react-native';
import { AnimatePresence, MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import BottomSheet, { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, eachDayOfInterval } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import ActivityIcon from './ActivityIcon';
import Bucket from './Bucket';
import Wardrobe from './Wardrobe';
import DayDetails from './DayDetails';
import DayReorderList from './DayReorderList';
import TripFinance from './TripFinance';
import DayTimeline from './DayTimeline';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');
const MIN_HEIGHT = 220;

interface TripWorkspaceProps {
  tripId: string;
  userId: string;
  onBack: () => void;
  mapRef: any;
  onMarkersChange: (markers: any[]) => void;
  onSnapChange: (snap: 'min' | 'mid' | 'max') => void;
  onDayChange: (dayIndex: number) => void;
  isReadOnly?: boolean;
}

export default function TripWorkspace({ tripId, userId, onBack, mapRef, onMarkersChange, onSnapChange, onDayChange, isReadOnly }: TripWorkspaceProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [trip, setTrip] = useState<any>(null);
  const [days, setDays] = useState<any[]>([]);
  const [dayCounts, setDayCounts] = useState<Record<number, number>>({});
  const [activeView, setActiveView] = useState<'map' | 'canvas' | 'bucket' | 'wardrobe' | 'finance'>('map');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [selectedDay, setSelectedDay] = useState<any | null>(null);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  
  // 🎢 SNAP STATE
  const [snapIndex, setSnapIndex] = useState(0);
  const snapPoints = useMemo(() => [MIN_HEIGHT, '55%', '95%'], []);
  
  // ⚙️ SETTINGS STATE
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editCoords, setEditCoords] = useState<{lat: number, lng: number} | null>(null);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const [loading, setLoading] = useState(true);
  const bottomSheetRef = useRef<BottomSheet>(null);

  // 🛡️ VISIBILITY EFFECT: Force snap to ensure visibility
  useEffect(() => {
    const timer = setTimeout(() => {
      bottomSheetRef.current?.snapToIndex(0);
    }, 100);
    return () => clearTimeout(timer);
  }, [tripId]);

  useEffect(() => {
    if (tripId) {
      setLoading(true);
      fetchTripData();
      const itemSub = supabase.channel(`trip-items-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'itinerary_items', filter: `trip_id=eq.${tripId}` }, () => fetchDayCounts())
        .subscribe();
      return () => { supabase.removeChannel(itemSub); };
    }
  }, [tripId]);

  const fetchTripData = async () => {
    try {
      const { data: tripData } = await supabase.from('trips').select('*').eq('id', tripId).maybeSingle();
      if (tripData) {
        setTrip(tripData);
        setEditTitle(tripData.title);
        setEditLocation(tripData.location_name);
        setEditCoords({ lat: tripData.latitude, lng: tripData.longitude });
        setStartDate(new Date(tripData.start_date));
        setEndDate(new Date(tripData.end_date));
        generateDays(tripData);
        fetchDayCounts();
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const generateDays = (tripData: any) => {
    if (!tripData?.start_date || !tripData?.end_date) return;
    try {
      const interval = eachDayOfInterval({ start: new Date(tripData.start_date), end: new Date(tripData.end_date) });
      const daysArr = interval.map((date, index) => ({ dayNumber: index + 1, date: date, weekday: format(date, 'EEEE') }));
      setDays(daysArr);
    } catch (e) { setDays([]); }
  };

  const fetchDayCounts = async () => {
    const { data } = await supabase.from('itinerary_items').select('day_number').eq('trip_id', tripId);
    if (data) {
      const counts: Record<number, number> = {};
      data.forEach(item => { counts[item.day_number] = (counts[item.day_number] || 0) + 1; });
      setDayCounts(counts);
    }
  };

  const updateTripSettings = async () => {
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
      Alert.alert("Success", "Plan updated! ❤️");
      setIsSettingsVisible(false);
      fetchTripData();
    }
    setIsUpdating(false);
  };

  const handleSheetChange = (index: number) => {
    if (index < 0) return;
    setSnapIndex(index);
    const snaps: ('min' | 'mid' | 'max')[] = ['min', 'mid', 'max'];
    onSnapChange(snaps[index]);
    if (index === 0) setIsWorkspaceMenuOpen(false);
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      
      {/* 🏙️ TOP ACTIONS */}
      <View style={[styles.topActions, { top: insets.top + 10 }]}>
        <TouchableOpacity onPress={onBack} style={[styles.actionBtn, { backgroundColor: '#FFF' }]}><X size={24} color={theme.tint} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setIsSettingsVisible(true)} style={[styles.actionBtn, { backgroundColor: '#FFF' }]}><Settings size={22} color={theme.tint} /></TouchableOpacity>
      </View>

      <BottomSheet
        ref={bottomSheetRef}
        index={0} 
        snapPoints={snapPoints}
        onChange={handleSheetChange}
        backgroundStyle={{ backgroundColor: theme.card, borderTopLeftRadius: 35, borderTopRightRadius: 35, elevation: 30 }}
        handleIndicatorStyle={{ backgroundColor: theme.tabIconDefault + '40', width: 40 }}
      >
        <View style={{ flex: 1 }}>
          {/* ⚡ PEEK (MIN) */}
          {snapIndex === 0 && (
            <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.peekContent}>
              <View style={styles.peekHeader}>
                <Text style={[styles.peekTitle, { color: theme.text }]}>{trip?.title || (loading ? 'Loading Trip...' : 'Our Plan')}</Text>
                <Text style={[styles.peekSub, { color: theme.tabIconDefault }]}>{days.length} Days • Scroll to plan</Text>
              </View>
              <DayTimeline 
                days={days} 
                activeDayIndex={activeDayIndex} 
                onDayPress={(idx: number) => {
                  setActiveDayIndex(idx);
                  onDayChange(idx);
                  bottomSheetRef.current?.snapToIndex(1);
                }} 
              />
            </MotiView>
          )}

          {/* ⚡ BUCKET (MID) */}
          {snapIndex === 1 && (
            <View style={{ flex: 1 }}>
              <Bucket tripId={tripId} userId={userId} onSelectItem={() => {}} mapRef={mapRef} />
            </View>
          )}

          {/* ⚡ ITINERARY (MAX) */}
          {snapIndex === 2 && (
            <View style={{ flex: 1 }}>
              {loading ? (
                <View style={styles.loader}><ActivityIndicator color={theme.tint} size="large" /><Text style={{ color: theme.tabIconDefault, marginTop: 15, fontWeight: '700' }}>Syncing shared plan...</Text></View>
              ) : (
                <DayReorderList tripId={tripId} days={days} dayCounts={dayCounts} onReorder={(nd: any) => setDays(nd)} onSelectDay={(d: any) => setSelectedDay(d)} />
              )}
            </View>
          )}
        </View>
      </BottomSheet>

      {/* 🚀 WORKSPACE FABs (White with Tinted Icons) */}
      <View 
        style={[
          styles.fabContainer, 
          { bottom: (snapIndex === 0 ? MIN_HEIGHT : snapIndex === 1 ? SCREEN_HEIGHT * 0.55 : 40) + insets.bottom + 20 }
        ]} 
        pointerEvents="box-none"
      >
        <AnimatePresence>
          {isWorkspaceMenuOpen && snapIndex < 2 && (
            <MotiView style={styles.fabSubMenu}>
              <TouchableOpacity style={[styles.subFab, { backgroundColor: '#FFF' }]} onPress={() => setActiveView('finance')}><Wallet size={20} color={theme.tint} /></TouchableOpacity>
              <TouchableOpacity style={[styles.subFab, { backgroundColor: '#FFF' }]} onPress={() => setActiveView('wardrobe')}><Briefcase size={20} color={theme.tint} /></TouchableOpacity>
              <TouchableOpacity style={[styles.subFab, { backgroundColor: '#FFF' }]} onPress={() => setActiveView('bucket')}><ActivityIcon category="activity" size={26} color={theme.tint} /></TouchableOpacity>
            </MotiView>
          )}
        </AnimatePresence>
        
        {snapIndex < 2 && (
          <TouchableOpacity 
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen);
            }}
            style={[styles.mainFab, { backgroundColor: theme.tint }]}
          >
            <MotiView animate={{ rotate: isWorkspaceMenuOpen ? '45deg' : '0deg' }}>
              <Plus size={28} color="white" />
            </MotiView>
          </TouchableOpacity>
        )}
      </View>

      {/* MODALS */}
      <Modal visible={isSettingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Plan Settings</Text>
              <TouchableOpacity onPress={() => setIsSettingsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={styles.fieldLabel}>TRIP NAME</Text>
              <TextInput style={[styles.input, { color: theme.text, backgroundColor: theme.background }]} value={editTitle} onChangeText={setEditTitle} />
              <Text style={[styles.fieldLabel, { marginTop: 20 }]}>DESTINATION</Text>
              <TouchableOpacity onPress={() => setShowLocationPicker(true)} style={[styles.input, styles.locationBtn, { backgroundColor: theme.background }]}>
                <Globe size={20} color={theme.tint} />
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700', marginLeft: 10 }}>{editLocation || 'Change Destination'}</Text>
              </TouchableOpacity>
              <View style={styles.dateRow}>
                <TouchableOpacity onPress={() => setShowStartPicker(true)} style={[styles.dateBtn, { backgroundColor: theme.background }]}>
                  <Text style={styles.fieldLabel}>START</Text>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>{format(startDate, 'dd MMM')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowEndPicker(true)} style={[styles.dateBtn, { backgroundColor: theme.background }]}>
                  <Text style={styles.fieldLabel}>END</Text>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>{format(endDate, 'dd MMM')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={updateTripSettings} disabled={isUpdating} style={[styles.saveBtnFull, { backgroundColor: theme.tint }]}>
                {isUpdating ? <ActivityIndicator color="white" /> : <><Save size={20} color="white" /><Text style={styles.saveBtnText}>Save Changes</Text></>}
              </TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>
        {showStartPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />}
        {showEndPicker && <DateTimePicker value={endDate} mode="date" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />}
        <Modal visible={showLocationPicker} animationType="slide">
          <SmartLocationPicker title="New Destination" onLocationCaptured={(data) => { setEditLocation(data.name); setEditCoords({ lat: data.lat, lng: data.lng }); }} onClose={() => setShowLocationPicker(false)} />
        </Modal>
      </Modal>

      <Modal visible={activeView === 'finance'} animationType="slide"><TripFinance tripId={tripId} trip={trip} onClose={() => setActiveView('map')} /></Modal>
      <Modal visible={activeView === 'wardrobe'} animationType="slide">
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 20 }]}><Text style={styles.modalTitle}>Trip Wardrobe</Text><TouchableOpacity onPress={() => setActiveView('map')}><X size={28} color={theme.text} /></TouchableOpacity></View>
          <Wardrobe userId={userId} tripId={tripId} />
        </View>
      </Modal>
      <Modal visible={activeView === 'bucket'} animationType="slide">
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { paddingTop: insets.top + 20 }]}><Text style={styles.modalTitle}>Staging Bucket</Text><TouchableOpacity onPress={() => setActiveView('map')}><X size={28} color={theme.text} /></TouchableOpacity></View>
          <Bucket tripId={tripId} userId={userId} onSelectItem={() => {}} mapRef={mapRef} />
        </View>
      </Modal>
      {selectedDay && <Modal visible={!!selectedDay} animationType="slide"><DayDetails tripId={tripId} day={selectedDay} onClose={() => setSelectedDay(null)} isReadOnly={isReadOnly} /></Modal>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, zIndex: 9999 },
  topActions: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10000 },
  actionBtn: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  peekContent: { paddingHorizontal: 20, paddingBottom: 20 },
  peekHeader: { alignItems: 'center', marginBottom: 15 },
  peekTitle: { fontSize: 24, fontWeight: '900', letterSpacing: -1 },
  peekSub: { fontSize: 13, fontWeight: '600', marginTop: 2 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 150 },
  fabContainer: { position: 'absolute', right: 20, alignItems: 'center', zIndex: 10000 },
  mainFab: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 12, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 15 },
  fabSubMenu: { gap: 15, marginBottom: 15, alignItems: 'center' },
  subFab: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '85%', borderTopLeftRadius: 35, borderTopRightRadius: 35, padding: 25, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  fieldLabel: { fontSize: 11, fontWeight: '900', color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  input: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700', marginBottom: 5 },
  locationBtn: { flexDirection: 'row', alignItems: 'center' },
  dateRow: { flexDirection: 'row', gap: 15, marginTop: 20 },
  dateBtn: { flex: 1, padding: 15, borderRadius: 18 },
  saveBtnFull: { height: 60, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 35, elevation: 8 },
  saveBtnText: { color: 'white', fontSize: 17, fontWeight: '900' }
});
