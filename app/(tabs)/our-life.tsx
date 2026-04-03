import { BlurView } from "expo-blur";
import * as Location from "expo-location";
import { Menu, Plane, Search, X, Map as MapIcon, Settings } from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Dimensions, Image, StyleSheet, TouchableOpacity, View, ScrollView, ActivityIndicator, DeviceEventEmitter, Modal } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';

import AddPinModal from "@/components/Map/AddPinModal";
import PolaroidPopup from '@/components/Map/PolaroidPopup';
import PlansListScreen from '@/app/our-life/plans-list';
import NewTripWorkspace from '@/components/PlanMode/NewTripWorkspace';
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { supabase } from "@/lib/supabase";
import { registerProximityAlerts } from '@/lib/location';

// @ts-ignore
import PinAsset from "../../assets/images/pin.png";

const { width, height } = Dimensions.get('window');
const LATITUDE_DELTA = 0.005;
const LONGITUDE_DELTA = 0.005;

export default function OurLifeScreen() {
  const colorScheme = useColorScheme() ?? "light";
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
  const [pendingCoordinate, setPendingCoordinate] = useState<{ latitude: number; longitude: number; } | null>(null);
  const [editingPin, setEditingPin] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const user = await SecureStore.getItemAsync('user_name');
      if (user) setUserId(user);
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      let loc = await Location.getCurrentPositionAsync({});
      setLocation(loc);
      fetchPins();
    })();
  }, [activeTripId]);

  const fetchPins = async () => {
    let query = supabase.from("places").select("*");
    if (activeTripId) query = query.eq('trip_id', activeTripId);
    else query = query.is('trip_id', null);
    const { data } = await query;
    if (data) {
      setPins(data);
      if (!activeTripId) registerProximityAlerts(data.map(p => ({ ...p, type: 'memory' })));
    }
  };

  const togglePlanMode = () => {
    setIsPlanMode(!isPlanMode);
    setActivePin(null);
    setIsMenuOpen(false);
  };

  const closeActivePin = () => {
    if (activePin) {
      mapRef.current?.animateToRegion({ latitude: activePin.latitude, longitude: activePin.longitude, latitudeDelta: LATITUDE_DELTA, longitudeDelta: LONGITUDE_DELTA }, 600);
      setActivePin(null);
    }
  };

  const handleMapLongPress = (e: any) => {
    const coordinate = e.nativeEvent.coordinate;
    setPendingCoordinate(coordinate);
    setEditingPin(null);
    setIsAddModalVisible(true);
  };

  const handlePlaceSelect = (data: any, details: any = null) => {
    if (details) {
      const { lat, lng } = details.geometry.location;
      const coordinate = { latitude: lat, longitude: lng };
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: LATITUDE_DELTA, longitudeDelta: LONGITUDE_DELTA }, 1000);
      setPendingCoordinate(coordinate);
      setEditingPin(null);
      setSearchVisible(false);
      Alert.alert("Location Found", `Add a pin at ${data.description}?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Add Pin", onPress: () => setIsAddModalVisible(true) },
      ]);
    }
  };

  const handlePinPress = (pin: any) => {
    setActivePin(pin);
    setIsMenuOpen(false);
    const latOffset = LATITUDE_DELTA * 0.45;
    mapRef.current?.animateToRegion({ latitude: pin.latitude + latOffset, longitude: pin.longitude, latitudeDelta: LATITUDE_DELTA, longitudeDelta: LONGITUDE_DELTA }, 800);
  };

  const handleBackFromTrip = () => {
    setActiveTripId(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  if (isPlanMode && !activeTripId) {
    return <View style={{ flex: 1 }}><PlansListScreen onSelectTrip={(id) => { setActiveTripId(id); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }} onClose={() => setIsPlanMode(false)} /></View>;
  }

  return (
    <View style={styles.container}>
      {/* 🗺️ MAP BASE (Always Rendered) */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={[styles.map, { zIndex: 1 }]}
        initialRegion={{ latitude: location?.coords.latitude ?? 20, longitude: location?.coords.longitude ?? 78, latitudeDelta: 0.0922, longitudeDelta: 0.0421 }}
        onPress={closeActivePin}
        onLongPress={handleMapLongPress}
      >
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            onPress={(e) => { e.stopPropagation(); handlePinPress(pin); }}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={styles.markerContainer}>
              <MotiView from={{ scale: 0.9 }} animate={{ translateY: activePin?.id === pin.id ? -12 : 0, scale: activePin?.id === pin.id ? 1.15 : 1 }}>
                <Image source={PinAsset} style={{ width: 45, height: 45, opacity: activeTripId && activePin?.id !== pin.id ? 0.7 : 1 }} resizeMode="contain" />
              </MotiView>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* 📋 TRIP WORKSPACE (Direct Overlay with High Z-Index) */}
      {activeTripId && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="box-none">
          <NewTripWorkspace 
            tripId={activeTripId} 
            onBack={handleBackFromTrip} 
          />
        </View>
      )}

      {/* Floating Action Menu (Only visible when NO trip active) */}
      <AnimatePresence>
        {!activePin && !activeTripId && (
          <View style={styles.fabContainer}>
            <AnimatePresence>
              {isMenuOpen && (
                <MotiView style={styles.fabSubMenu}>
                  <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: 20 }}>
                    <TouchableOpacity style={[styles.subActionButton, { backgroundColor: '#FFF' }]} onPress={() => { setSearchVisible(true); setIsMenuOpen(false); }}><Search size={22} color={theme.tint} /></TouchableOpacity>
                  </MotiView>
                  <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: 20 }}>
                    <TouchableOpacity style={[styles.subActionButton, { backgroundColor: '#FFF' }]} onPress={togglePlanMode}><Plane size={22} color={theme.tint} /></TouchableOpacity>
                  </MotiView>
                </MotiView>
              )}
            </AnimatePresence>
            <TouchableOpacity activeOpacity={0.8} onPress={() => setIsMenuOpen(!isMenuOpen)} style={[styles.mainFab, { backgroundColor: isMenuOpen ? "#444" : theme.tint }]}>
              <MotiView animate={{ rotate: isMenuOpen ? "90deg" : "0deg" }}>{isMenuOpen ? <X size={28} color="white" /> : <Menu size={28} color="white" />}</MotiView>
            </TouchableOpacity>
          </View>
        )}
      </AnimatePresence>

      {/* Search Bar Overlay */}
      {searchVisible && (
        <MotiView from={{ opacity: 0, translateY: -20 }} animate={{ opacity: 1, translateY: 0 }} style={[styles.searchOverlay, { top: insets.top + 10 }]}>
          <BlurView intensity={90} tint={colorScheme} style={styles.searchContainer}>
            <GooglePlacesAutocomplete
              placeholder="Search for a place..."
              onPress={handlePlaceSelect}
              fetchDetails={true}
              autoFocus={true}
              query={{ key: "AIzaSyDO9hnBEOUdx2IvXdmEisQEZXoUbldJjAo", language: "en" }}
              styles={{
                container: { flex: 1 },
                textInput: { backgroundColor: "transparent", color: theme.text, height: 44, fontSize: 16 },
                listView: { backgroundColor: colorScheme === "dark" ? "#1a1a1a" : "#fff", borderRadius: 10, marginTop: 5, elevation: 5, maxHeight: 300, zIndex: 5000 },
              }}
            />
            <TouchableOpacity onPress={() => setSearchVisible(false)} style={styles.closeSearch}><X size={20} color={theme.text} /></TouchableOpacity>
          </BlurView>
        </MotiView>
      )}

      {/* Floating Memory Popup */}
      <AnimatePresence>
        {activePin && !activeTripId && (
          <PolaroidPopup pin={activePin} onClose={closeActivePin} onEdit={(pin) => { setEditingPin(pin); setIsAddModalVisible(true); }} isPlanMode={isPlanMode} />
        )}
      </AnimatePresence>

      <AddPinModal isVisible={isAddModalVisible} onClose={() => { setIsAddModalVisible(false); setPendingCoordinate(null); setEditingPin(null); }} coordinate={pendingCoordinate} editingPin={editingPin} onSuccess={fetchPins} isPlanMode={isPlanMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: "100%", height: "100%" },
  fabContainer: { position: "absolute", bottom: 40, right: 20, alignItems: "center", zIndex: 2000 },
  mainFab: { width: 60, height: 60, borderRadius: 30, justifyContent: "center", alignItems: "center", elevation: 8, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6 },
  fabSubMenu: { alignItems: "center", marginBottom: 15, gap: 15 },
  subActionButton: { width: 48, height: 48, borderRadius: 24, justifyContent: "center", alignItems: "center", elevation: 5, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10 },
  markerContainer: { width: 60, height: 80, justifyContent: "flex-end", alignItems: "center", paddingBottom: 5 },
  searchOverlay: { position: "absolute", left: 20, right: 20, zIndex: 3000 },
  searchContainer: { borderRadius: 15, padding: 10, overflow: "hidden", flexDirection: "row", alignItems: "flex-start" },
  closeSearch: { padding: 10 },
});
