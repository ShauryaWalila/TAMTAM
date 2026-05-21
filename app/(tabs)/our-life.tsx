import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Pressable, TouchableOpacity, Text, Dimensions, Alert, Image, ActivityIndicator } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { Map as MapIcon, MapPin, Plane, Plus, Search, Layers, X, Navigation as NavIcon, Menu, Sparkles, CheckCircle2 } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { WebView } from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonoText } from '@/components/StyledText';
import { View as ThemedView, Text as ThemedText } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';
import FloatingPopup from '@/components/Map/FloatingPopup';
import AddPinModal from '@/components/Map/AddPinModal';
import PlansListScreen from '@/app/our-life/plans-list';
import TripWorkspace from '@/components/PlanMode/TripWorkspace';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';
import { registerProximityAlerts } from '@/lib/location';

// @ts-ignore
import PinAsset from "../../assets/images/pin.png";
// @ts-ignore
import BucketLocationAsset from '../../assets/images/bucket_location.png';
// @ts-ignore
import BucketLocationMarkedAsset from '../../assets/images/bucket_location_marked.png';

const { width, height } = Dimensions.get('window');
const LATITUDE_DELTA = 0.005;
const LONGITUDE_DELTA = 0.005;

export default function OurLifeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  
  const [userId, setUserId] = useState<string>('');
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [pins, setPins] = useState<any[]>([]);
  const [activePin, setActivePin] = useState<any | null>(null);
  const [searchVisible, setSearchVisible] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Add Pin State
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [pendingCoordinate, setPendingCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [editingPin, setEditingPin] = useState<any | null>(null);
  
  // Workspace Sync State
  const [workspaceMarkers, setWorkspaceMarkers] = useState<any[]>([]);
  const [currentSnap, setCurrentSnap] = useState<'min' | 'mid' | 'max'>('min');
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  useEffect(() => {
    (async () => {
      const user = await SecureStore.getItemAsync('user_name');
      if (user) setUserId(user);
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
      fetchPins();
    })();
  }, [activeTripId]);

  const fetchPins = async () => {
    let query = supabase.from('places').select('*');
    if (activeTripId) query = query.eq('trip_id', activeTripId);
    else query = query.is('trip_id', null);
    const { data } = await query;
    if (data) {
      setPins(data);
      // Register proximity alerts for our life memories/pins
      registerProximityAlerts(data.map(pin => ({ ...pin, type: 'memory' })));
    }
  };

  const handleBackFromTrip = () => {
    setActiveTripId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const closeActivePin = () => {
    if (activePin) {
      mapRef.current?.animateToRegion({
        latitude: activePin.latitude,
        longitude: activePin.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA,
      }, 600);
      setActivePin(null);
    }
  };

  const handleAddItinerary = async (marker: any) => {
    if (!activeTripId) return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      const { data: currentItems } = await supabase
        .from('itinerary_items')
        .select('sequence')
        .eq('trip_id', activeTripId)
        .order('sequence', { ascending: false })
        .limit(1);
      
      const nextSeq = (currentItems?.[0]?.sequence || 0) + 1;
      
      const { error } = await supabase.from('itinerary_items').upsert({
        trip_id: activeTripId,
        bucket_item_id: marker.id,
        day_number: activeDayIndex + 1, 
        sequence: nextSeq
      }, { onConflict: 'trip_id, day_number, bucket_item_id' });

      if (!error) {
        Alert.alert("Success", `${marker.name} added to your day!`);
      } else if (error.code === '23505') {
        Alert.alert("Note", `${marker.name} is already in your plan for this day.`);
      }
    } catch (e) { console.error(e); }
  };

  const handlePinPress = (pin: any) => {
    setActivePin(pin);
    setIsMenuOpen(false);
    const latOffset = LATITUDE_DELTA * 0.45;
    mapRef.current?.animateToRegion({
      latitude: pin.latitude + latOffset,
      longitude: pin.longitude,
      latitudeDelta: LATITUDE_DELTA,
      longitudeDelta: LONGITUDE_DELTA,
    }, 800);
  };

  const handleMapLongPress = (e: any) => {
    const coordinate = e.nativeEvent.coordinate;
    setPendingCoordinate(coordinate);
    setEditingPin(null);
    setIsAddModalVisible(true);
  };

  if (isPlanMode && !activeTripId) {
    return (
      <View style={{ flex: 1 }}>
        <PlansListScreen 
          onSelectTrip={(id) => { 
            setActiveTripId(id); 
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }} 
          onClose={() => setIsPlanMode(false)} 
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {activeTripId && (
        <TripWorkspace 
          tripId={activeTripId} 
          userId={userId} 
          mapRef={mapRef} 
          onBack={handleBackFromTrip} 
          onMarkersChange={(m) => setWorkspaceMarkers(m)} 
          onSnapChange={(snap) => setCurrentSnap(snap)}
          onDayChange={(dayIndex) => setActiveDayIndex(dayIndex)}
        />
      )}

      <MapView
        key={`map-${activeTripId}`}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{ latitude: location?.coords.latitude ?? 20, longitude: location?.coords.longitude ?? 78, latitudeDelta: 0.0922, longitudeDelta: 0.0421 }}
        onPress={closeActivePin}
        onLongPress={handleMapLongPress}
      >
        {activeTripId ? (
          workspaceMarkers.map(marker => (
            <Marker
              key={marker.id}
              coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.markerIconContainer}>
                <Image 
                  source={marker.isAssigned ? BucketLocationMarkedAsset : BucketLocationAsset} 
                  style={styles.bucketIcon} 
                  resizeMode="contain" 
                />
              </View>
              
              <Callout tooltip onPress={() => handleAddItinerary(marker)}>
                <View style={styles.customCallout}>
                  <View style={styles.calloutHeader}>
                    <Text style={styles.calloutName} numberOfLines={1}>{marker.name}</Text>
                    <View style={[styles.miniBadge, { backgroundColor: (marker.category === 'eat' ? '#FF9500' : '#34C759') + '20' }]}>
                      <Text style={[styles.miniBadgeText, { color: marker.category === 'eat' ? '#FF9500' : '#34C759' }]}>{marker.category?.toUpperCase() || 'PLACE'}</Text>
                    </View>
                  </View>
                  {marker.notes ? <Text style={styles.calloutNotes} numberOfLines={2}>{marker.notes}</Text> : <Text style={styles.calloutNotes}>No notes added yet.</Text>}
                  
                  <View style={styles.calloutAction}>
                    {marker.isAssigned ? (
                      <View style={styles.addedRow}>
                        <CheckCircle2 size={12} color="#34C759" />
                        <Text style={styles.addedText}>ALREADY PLANNED</Text>
                      </View>
                    ) : (
                      <View style={styles.planRow}>
                        <Plus size={12} color="#FF2D55" />
                        <Text style={styles.planText}>TAP TO ADD TO DAY</Text>
                      </View>
                    )}
                  </View>
                </View>
              </Callout>
            </Marker>
          ))
        ) : (
          pins.map(pin => (
            <Marker
              key={pin.id} coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
              onPress={(e) => { e.stopPropagation(); handlePinPress(pin); }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={styles.markerContainer}>
                <MotiView from={{ scale: 0.9 }} animate={{ translateY: activePin?.id === pin.id ? -12 : 0, scale: activePin?.id === pin.id ? 1.15 : 1 }}>
                  <Image source={PinAsset} style={{ width: 45, height: 45, opacity: activePin?.id && activePin?.id !== pin.id ? 0.7 : 1 }} resizeMode="contain" />
                </MotiView>
              </View>
            </Marker>
          ))
        )}
      </MapView>

      <AnimatePresence>
        {!activePin && !searchVisible && !activeTripId && (
          <View style={styles.fabContainer}>
            <AnimatePresence>
              {isMenuOpen && (
                <MotiView style={styles.fabSubMenu}>
                  <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: 20 }}>
                    <TouchableOpacity style={[styles.subActionButton, { backgroundColor: '#FFF' }]} onPress={() => { setSearchVisible(true); setIsMenuOpen(false); }}><Search size={22} color={theme.tint} /></TouchableOpacity>
                  </MotiView>
                  <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: 20 }}>
                    <TouchableOpacity style={[styles.subActionButton, { backgroundColor: '#FFF' }]} onPress={() => setIsPlanMode(true)}><Plane size={22} color={theme.tint} /></TouchableOpacity>
                  </MotiView>
                </MotiView>
              )}
            </AnimatePresence>
            <TouchableOpacity 
              activeOpacity={0.8} 
              onPress={() => setIsMenuOpen(!isMenuOpen)} 
              style={[styles.mainFab, { backgroundColor: isMenuOpen ? '#444' : theme.tint, alignItems: 'center', justifyContent: 'center' }]}
            >
              <MotiView 
                animate={{ rotate: isMenuOpen ? '90deg' : '0deg' }}
                style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
              >
                {isMenuOpen ? <X size={28} color="white" /> : <Menu size={28} color="white" />}
              </MotiView>
            </TouchableOpacity>
          </View>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activePin && !activeTripId && (
          <FloatingPopup pin={activePin} onClose={closeActivePin} onEdit={() => setIsAddModalVisible(true)} isPlanMode={!!activeTripId} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchVisible && (
          <MotiView 
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -20 }}
            style={[styles.searchOverlay, { top: insets.top + 10 }]}
          >
            <SmartLocationPicker 
              title="Search Places"
              onClose={() => setSearchVisible(false)}
              onLocationCaptured={(loc) => {
                mapRef.current?.animateToRegion({
                  latitude: loc.lat,
                  longitude: loc.lng,
                  latitudeDelta: LATITUDE_DELTA,
                  longitudeDelta: LONGITUDE_DELTA
                }, 1000);
                setSearchVisible(false);
              }}
            />
          </MotiView>
        )}
      </AnimatePresence>

      <AddPinModal 
        isVisible={isAddModalVisible} 
        onClose={() => { setIsAddModalVisible(false); setPendingCoordinate(null); setEditingPin(null); }} 
        coordinate={pendingCoordinate} 
        editingPin={editingPin || activePin} 
        onSuccess={() => {
          fetchPins();
          setActivePin(null);
        }} 
        isPlanMode={isPlanMode} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  fabContainer: { position: 'absolute', bottom: 40, right: 20, alignItems: 'center', zIndex: 2000 },
  mainFab: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6 },
  fabSubMenu: { alignItems: 'center', marginBottom: 15, gap: 15 },
  subActionButton: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  markerContainer: { width: 60, height: 80, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 5 },
  markerIconContainer: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  bucketIcon: { width: 34, height: 34 },
  customCallout: { backgroundColor: 'white', borderRadius: 18, padding: 15, width: 220, elevation: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15 },
  calloutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  calloutName: { fontSize: 16, fontWeight: '900', color: '#333', flex: 1, marginRight: 8 },
  miniBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  miniBadgeText: { fontSize: 9, fontWeight: 'bold' },
  calloutNotes: { fontSize: 12, color: '#666', lineHeight: 18 },
  calloutAction: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 10 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planText: { fontSize: 10, fontWeight: '900', color: '#FF2D55', letterSpacing: 0.5 },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addedText: { fontSize: 10, fontWeight: '900', color: '#34C759', letterSpacing: 0.5 },
  searchOverlay: { position: "absolute", left: 20, right: 20, zIndex: 3000 },
});
