import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, Modal, TextInput, ActivityIndicator, Alert, Image, DeviceEventEmitter, Linking, FlatList, ScrollView, Platform, Share } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Search, Plus, X, Navigation as NavIcon, Globe, MapPin, Heart, MessageCircle, ArrowRight, Trash2, Map as MapIcon, ChevronDown, Sparkles, Copy, ExternalLink, MapPinned, ChevronRight, Users, Wifi } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { View as ThemedView } from '@/components/Themed';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';
import { registerProximityAlerts } from '@/lib/location';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface WishlistItem {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  comments: string;
  user_id: string;
  created_at: string;
}

export default function WishlistScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [isSynced, setIsSynced] = useState(false);

  // Modals
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isWebViewVisible, setIsWebViewVisible] = useState(false);
  const [selectedPin, setSelectedPin] = useState<WishlistItem | null>(null);

  // Form State
  const [newName, setNewName] = useState('');
  const [newComments, setNewComments] = useState('');
  const [newCoords, setNewCoords] = useState<{ lat: number, lng: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    init();
    
    // 🔗 REAL-TIME SUBSCRIPTION
    const wishlistChannel = supabase.channel('wishlist_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wishlist' }, (payload) => {
        setIsSynced(true);
        fetchWishlist();
        setTimeout(() => setIsSynced(false), 2000);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setIsSynced(true);
      });

    return () => {
      supabase.removeChannel(wishlistChannel);
    };
  }, []);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    if (name) {
      setCurrentUserId(name);
      setPartnerName(name.toLowerCase() === 'pratishth' ? 'Love' : 'Pratishth');
    }
    fetchWishlist();
  };

  const fetchWishlist = async () => {
    const { data } = await supabase.from('wishlist').select('*').order('created_at', { ascending: false });
    if (data) {
      setWishlist(data);
      // Register proximity alerts for wishlist items
      registerProximityAlerts(data.map(item => ({ ...item, type: 'wishlist' })));
    }
    setLoading(false);
  };

  const filteredWishlist = useMemo(() => {
    if (!searchQuery.trim()) return wishlist;
    const q = searchQuery.toLowerCase();
    return wishlist.filter(item => 
      item.name.toLowerCase().includes(q) || 
      (item.comments && item.comments.toLowerCase().includes(q))
    );
  }, [wishlist, searchQuery]);

  const saveToWishlist = async () => {
    if (!newName || !newCoords) {
      Alert.alert("Missing Info", "Please capture a location first! ❤️");
      return;
    }
    setIsSaving(true);
    const { error } = await supabase.from('wishlist').insert([{
      name: newName,
      latitude: newCoords.lat,
      longitude: newCoords.lng,
      comments: newComments,
      user_id: currentUserId
    }]);

    if (!error) {
      setNewName(''); setNewComments(''); setNewCoords(null);
      setIsAddModalVisible(false);
    } else {
      Alert.alert("Error", error.message);
    }
    setIsSaving(false);
  };

  const navigateToPlace = (item: WishlistItem) => {
    // Explicitly target Google Maps App if possible, otherwise use web link
    const scheme = Platform.OS === 'ios' ? 'comgooglemaps://?q=' : 'google.navigation:q=';
    const coords = `${item.latitude},${item.longitude}`;
    const url = `${scheme}${coords}`;
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${coords}`;

    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Linking.openURL(webUrl);
      }
    }).catch(() => {
      Linking.openURL(webUrl);
    });
  };

  const sharePlace = async (item: WishlistItem) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`;
    try {
      await Share.share({
        message: `Check out this spot from our shared wishlist: ${item.name}\n\n${item.comments}\n\n${url}`,
      });
    } catch (error) {
      Alert.alert('Error sharing place');
    }
  };

  const deleteItem = async (id: string) => {
    Alert.alert("Remove from Wishlist?", "This place will be gone from our shared map.", [
      { text: "Keep it", style: 'cancel' },
      { text: "Remove", style: 'destructive', onPress: async () => {
        await supabase.from('wishlist').delete().eq('id', id);
        setSelectedPin(null);
      }}
    ]);
  };

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{ latitude: 20.5937, longitude: 78.9629, latitudeDelta: 20, longitudeDelta: 20 }}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {filteredWishlist.map(item => (
          <Marker
            key={item.id}
            coordinate={{ latitude: item.latitude, longitude: item.longitude }}
            onPress={() => setSelectedPin(item)}
          >
            <MotiView 
              from={{ scale: 0, translateY: 20 }}
              animate={{ scale: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15 }}
              style={styles.customMarker}
            >
              <View style={[styles.markerIcon, { backgroundColor: theme.tint }]}>
                <Heart size={16} color="white" fill="white" />
              </View>
              <View style={[styles.markerTriangle, { borderTopColor: theme.tint }]} />
            </MotiView>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        {/* <View style={styles.statusRow}>
          <BlurView intensity={60} tint={colorScheme} style={styles.syncBadge}>
            <Users size={12} color={theme.tint} />
            <Text style={[styles.syncText, { color: theme.text }]}>Shared with {partnerName}</Text>
            {isSynced && (
              <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.liveIndicator}>
                <Wifi size={10} color="#34C759" />
                <Text style={styles.liveText}>LIVE</Text>
              </MotiView>
            )}
          </BlurView>
        </View> */}

        <BlurView intensity={80} tint={colorScheme} style={styles.searchBlur}>
          <Search size={20} color={theme.tabIconDefault} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: theme.text }]}
            placeholder="Search our wishes & keywords..."
            placeholderTextColor={theme.tabIconDefault}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}><X size={18} color={theme.tabIconDefault} /></TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setIsAddModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint }]}><Plus size={20} color="white" /></TouchableOpacity>
          )}
        </BlurView>
      </View>

      <AnimatePresence>
        {selectedPin && (
          <MotiView 
            from={{ opacity: 0, translateY: 150 }} 
            animate={{ opacity: 1, translateY: 0 }} 
            exit={{ opacity: 0, translateY: 150 }}
            style={[styles.detailsCard, { bottom: insets.bottom + 100 }]}
          >
            <BlurView intensity={100} tint={colorScheme} style={styles.detailsBlur}>
              <View style={styles.detailsHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.placeName, { color: theme.text }]}>{selectedPin.name}</Text>
                  {/* <View style={styles.addedByRow}>
                    <MapPinned size={12} color={theme.tint} />
                    <Text style={[styles.addedBy, { color: theme.tabIconDefault }]}>Wishlisted by {selectedPin.user_id.toUpperCase()}</Text>
                  </View> */}
                </View>
                <TouchableOpacity onPress={() => setSelectedPin(null)} style={styles.closeDetails}><ChevronDown size={28} color={theme.text} /></TouchableOpacity>
              </View>

              {selectedPin.comments ? (
                <View style={[styles.commentBox, { backgroundColor: theme.tint + '10' }]}>
                  <MessageCircle size={14} color={theme.tint} style={{ marginTop: 2 }} />
                  <Text style={[styles.commentText, { color: theme.text }]}>{selectedPin.comments}</Text>
                </View>
              ) : (
                <View style={{ height: 10 }} />
              )}

              <View style={styles.actionRow}>
                <TouchableOpacity onPress={() => deleteItem(selectedPin.id)} style={styles.deleteAction}><Trash2 size={20} color="#FF3B30" opacity={0.6} /></TouchableOpacity>
                <View style={styles.mainActions}>
                  <TouchableOpacity onPress={() => sharePlace(selectedPin)} style={[styles.secondaryBtn, { backgroundColor: theme.tabIconDefault + '20' }]}><ExternalLink size={18} color={theme.text} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => navigateToPlace(selectedPin)} style={[styles.navBtn, { backgroundColor: theme.tint }]}>
                    <Text style={styles.navBtnText}>Navigate</Text>
                    <NavIcon size={18} color="white" fill="white" />
                  </TouchableOpacity>
                </View>
              </View>
            </BlurView>
          </MotiView>
        )}
      </AnimatePresence>

      <Modal visible={isAddModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Sparkles size={24} color={theme.tint} />
                <Text style={[styles.modalTitle, { color: theme.text }]}>New Shared Wish</Text>
              </View>
              <TouchableOpacity onPress={() => setIsAddModalVisible(false)} style={styles.modalCloseBtn}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              <Text style={styles.fieldLabel}>1. WHERE ARE WE GOING?</Text>
              <TouchableOpacity 
                style={[styles.locationTrigger, { backgroundColor: theme.background, borderColor: newCoords ? theme.tint : 'rgba(0,0,0,0.1)' }]} 
                onPress={() => setIsWebViewVisible(true)}
              >
                <Globe size={24} color={newCoords ? theme.tint : theme.tabIconDefault} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[styles.locationTitle, { color: newCoords ? theme.text : theme.tabIconDefault }]}>
                    {newCoords ? "Location Captured ✓" : "Pick from Google Maps"}
                  </Text>
                  {newCoords && <Text style={styles.locationSub}>{newCoords.lat.toFixed(4)}, {newCoords.lng.toFixed(4)}</Text>}
                </View>
                <ChevronRight size={20} color={theme.tabIconDefault} />
              </TouchableOpacity>

              <Text style={[styles.fieldLabel, { marginTop: 25 }]}>2. NAME & DETAILS</Text>
              <View style={[styles.inputContainer, { backgroundColor: theme.background }]}>
                <TextInput 
                  style={[styles.input, { color: theme.text }]} 
                  placeholder="Name of this dream spot..." 
                  placeholderTextColor={theme.tabIconDefault}
                  value={newName}
                  onChangeText={setNewName}
                />
              </View>

              <View style={[styles.inputContainer, { backgroundColor: theme.background, marginTop: 15, height: 120 }]}>
                <TextInput 
                  style={[styles.input, { color: theme.text, height: 100, textAlignVertical: 'top' }]} 
                  placeholder="Why do we want to go here? (Tags: pizza, date, romantic, trip...)" 
                  placeholderTextColor={theme.tabIconDefault}
                  multiline
                  value={newComments}
                  onChangeText={setNewComments}
                />
              </View>

              <TouchableOpacity 
                onPress={saveToWishlist} 
                disabled={isSaving || !newName || !newCoords}
                activeOpacity={0.8}
                style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: (newName && newCoords) ? 1 : 0.5 }]}
              >
                {isSaving ? <ActivityIndicator color="white" /> : <><Heart size={20} color="white" fill="white" /><Text style={styles.saveBtnText}>Add to Our Life</Text></>}
              </TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>

        <Modal visible={isWebViewVisible} animationType="slide">
          <SmartLocationPicker 
            title="Find Our Spot"
            onLocationCaptured={(data) => {
              setNewCoords({ lat: data.lat, lng: data.lng });
              setNewName(data.name);
            }}
            onClose={() => setIsWebViewVisible(false)}
          />
        </Modal>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  topOverlay: { position: 'absolute', left: 20, right: 20, zIndex: 100 },
  statusRow: { marginBottom: 10, alignItems: 'flex-start' },
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' },
  syncText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: 'rgba(0,0,0,0.1)' },
  liveText: { fontSize: 9, fontWeight: '900', color: '#34C759' },
  searchBlur: { height: 64, borderRadius: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, overflow: 'hidden', elevation: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  searchIcon: { marginRight: 12 },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '700' },
  clearBtn: { padding: 5 },
  addBtn: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  customMarker: { alignItems: 'center', justifyContent: 'center' },
  markerIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: 'white', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 5 },
  markerTriangle: { width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid', borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -2 },
  detailsCard: { position: 'absolute', left: 20, right: 20, zIndex: 200 },
  detailsBlur: { borderRadius: 35, padding: 28, overflow: 'hidden', elevation: 20, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 15 },
  detailsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  placeName: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  addedByRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  addedBy: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  closeDetails: { padding: 5, marginTop: -5 },
  commentBox: { padding: 18, borderRadius: 22, flexDirection: 'row', gap: 12, marginBottom: 25 },
  commentText: { flex: 1, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mainActions: { flexDirection: 'row', gap: 12 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 16, borderRadius: 20, elevation: 5 },
  navBtnText: { color: 'white', fontWeight: '900', fontSize: 16 },
  secondaryBtn: { width: 54, height: 54, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  deleteAction: { padding: 12, borderRadius: 15 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { height: '88%', borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 30, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 35 },
  modalTitle: { fontSize: 26, fontWeight: '900' },
  modalCloseBtn: { padding: 10, borderRadius: 15, backgroundColor: 'rgba(150,150,150,0.1)' },
  fieldLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 2, marginBottom: 12, opacity: 0.5 },
  locationTrigger: { flexDirection: 'row', alignItems: 'center', padding: 22, borderRadius: 22, borderWidth: 2, borderStyle: 'dashed' },
  locationTitle: { fontSize: 17, fontWeight: '800' },
  locationSub: { fontSize: 13, opacity: 0.6, marginTop: 4, fontWeight: '600' },
  inputContainer: { borderRadius: 22, paddingHorizontal: 20, paddingVertical: 18, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  input: { fontSize: 17, fontWeight: '700' },
  saveBtn: { height: 64, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 35, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
});
