import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, FlatList, Dimensions, TextInput, KeyboardAvoidingView, Platform, Pressable, Image } from 'react-native';
import { MapPin, X, Utensils, Camera, Building2, Landmark, Plus, Map as MapIcon, Globe, Search, Tag, Sparkles, Save, Trash2, Edit3 } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');

interface BucketProps {
  tripId: string;
  userId: string;
  onSelectItem: (item: any) => void;
  tripLocation?: { lat: number; lng: number };
  tripLocationName?: string;
  mapRef?: any;
  onClose?: () => void;
}

const DEFAULT_CATEGORIES = [
  { name: 'Eating', icon: 'Utensils', color: '#FF9500' },
  { name: 'Hotels', icon: 'Building2', color: '#5856D6' },
  { name: 'Activities', icon: 'Camera', color: '#FF2D55' },
  { name: 'Visiting', icon: 'Landmark', color: '#34C759' },
];

const IconMap: any = { Utensils, Building2, Camera, Landmark, MapPin, Tag };
const BucketIcon = require('@/assets/images/bucket.png');

export default function Bucket({ tripId, userId, onSelectItem, tripLocation, tripLocationName, mapRef, onClose }: BucketProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  
  const [items, setItems] = useState<any[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('');
  
  const [showWebView, setShowWebView] = useState(false);
  const [isWebLoading, setIsWebLoading] = useState(true);
  const [lastResolvedUrl, setLastResolvedUrl] = useState('');

  // Modals State
  const [showPicker, setShowPicker] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [pendingLocation, setPendingLocation] = useState<any>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (tripId) {
      fetchCategories();
      fetchBucket();
      
      const catSub = supabase.channel(`cat-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_categories', filter: `trip_id=eq.${tripId}` }, fetchCategories)
        .subscribe();

      const itemSub = supabase.channel(`bucket-${tripId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bucket_items', filter: `trip_id=eq.${tripId}` }, fetchBucket)
        .subscribe();

      return () => { 
        supabase.removeChannel(catSub);
        supabase.removeChannel(itemSub);
      };
    }
  }, [tripId]);

  const fetchCategories = async () => {
    if (!tripId) return;
    let { data } = await supabase.from('bucket_categories').select('*').eq('trip_id', tripId).order('name', { ascending: true });
    
    if (data && data.length === 0) {
      const seed = DEFAULT_CATEGORIES.map(c => ({ 
        trip_id: tripId, 
        name: c.name, 
        icon: c.icon, 
        color: c.color, 
        is_system: true, 
        user_id: userId 
      }));
      const { data: seeded } = await supabase.from('bucket_categories').insert(seed).select();
      data = seeded || [];
    }
    
    if (data) {
      setDbCategories(data);
      if (!activeTab && data.length > 0) setActiveTab(data[0].name);
    }
  };

  const fetchBucket = async () => {
    if (!tripId) return;
    setLoading(true);
    const { data } = await supabase.from('bucket_items').select('*').eq('trip_id', tripId).order('created_at', { ascending: false });
    if (data) setItems(data);
    setLoading(false);
  };

  const reverseGeocodeAndCategorize = async (lat: number, lng: number, rawName: string) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'TAMTAM-Travel-App' } });
      const data = await res.json();
      let resolvedCategory = 'Visiting';
      const searchStr = `${rawName} ${data.display_name}`.toLowerCase();
      if (['grill', 'restaurant', 'cafe', 'food', 'dining', 'bar', 'pub', 'lounge', 'biryani'].some(k => searchStr.includes(k))) resolvedCategory = 'Eating';
      else if (['hotel', 'resort', 'stay', 'inn', 'hostel'].some(k => searchStr.includes(k))) resolvedCategory = 'Hotels';
      else if (['park', 'fun', 'adventure', 'zoo', 'beach', 'museum'].some(k => searchStr.includes(k))) resolvedCategory = 'Activities';
      return { name: rawName.split(',')[0].trim(), category: resolvedCategory, lat, lng, address: data.display_name };
    } catch (e) { return { name: rawName.split(',')[0].trim(), category: 'Visiting', lat, lng, address: '' }; }
  };

  const handleWebViewStateChange = async (navState: any) => {
    const url = navState.url;
    if (url === lastResolvedUrl || !url.includes('/place/')) return;
    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const match = url.match(coordRegex);
    const nameMatch = url.match(/\/place\/([^/]+)\//);
    if (match && nameMatch) {
      setLastResolvedUrl(url);
      const resolved = await reverseGeocodeAndCategorize(parseFloat(match[1]), parseFloat(match[2]), decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')));
      setPendingLocation(resolved);
      setShowPicker(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const saveNewItem = async (categoryName: string) => {
    if (!pendingLocation || !tripId) return;
    const { error } = await supabase.from('bucket_items').insert([{
      trip_id: tripId,
      name: pendingLocation.name,
      category: categoryName,
      latitude: pendingLocation.lat,
      longitude: pendingLocation.lng,
      type: 'place',
      notes: '' 
    }]);
    if (!error) {
      setActiveTab(categoryName);
      setShowPicker(false);
      setShowWebView(false);
      fetchBucket();
    }
  };

  const updateItem = async () => {
    if (!editingItem) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('bucket_items').update({ name: editingItem.name, notes: editingItem.notes, category: editingItem.category }).eq('id', editingItem.id);
      if (!error) { setShowEdit(false); fetchBucket(); }
    } catch (e) { Alert.alert("Error", "Update failed."); } 
    finally { setIsSaving(false); }
  };

  const activeCategoryInfo = dbCategories.find(c => c.name === activeTab) || dbCategories[0];
  const ActiveIcon = IconMap[activeCategoryInfo?.icon] || MapPin;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: '#000000' }]}>
      
      {/* 🏙️ HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSubtitle, { color: 'rgba(255,255,255,0.5)' }]}>CURRENT TRIP STAGING</Text>
          <Text style={[styles.headerTitle, { color: '#FFF' }]}>Trip Bucket</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={[styles.bucketCircle, { backgroundColor: theme.tint }]} onPress={() => setShowWebView(true)}>
            <Globe size={20} color="white" />
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={[styles.closeCircle, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
              <X size={20} color="#FFF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.tabsWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContainer}>
          {dbCategories.map(cat => {
            const isSelected = activeTab === cat.name;
            const Icon = IconMap[cat.icon] || MapPin;
            return (
              <TouchableOpacity key={cat.id} onPress={() => setActiveTab(cat.name)} style={[styles.tab, { backgroundColor: isSelected ? cat.color + '30' : 'rgba(255,255,255,0.1)' }, isSelected && { borderColor: cat.color, borderWidth: 1 }]}>
                <Icon size={18} color={isSelected ? cat.color : 'rgba(255,255,255,0.5)'} />
                <Text style={[styles.tabText, { color: isSelected ? cat.color : 'rgba(255,255,255,0.5)' }]}>{cat.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.listContainer}>
        {loading ? (
          <ActivityIndicator color="#FFF" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={items.filter(i => i.category === activeTab)}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: index * 50 }}>
                <View style={[styles.itemCard, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                  <Pressable style={styles.itemPressable} onPress={() => mapRef?.current?.animateToRegion({ latitude: item.latitude, longitude: item.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 1000)}>
                    <View style={[styles.iconBox, { backgroundColor: activeCategoryInfo?.color + '20' }]}><ActiveIcon size={18} color={activeCategoryInfo?.color} /></View>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: '#FFF' }]}>{item.name}</Text>
                      {item.notes ? <Text style={[styles.itemNote, { color: 'rgba(255,255,255,0.5)' }]} numberOfLines={2}>{item.notes}</Text> : null}
                    </View>
                  </Pressable>
                  <TouchableOpacity onPress={() => { setEditingItem({...item}); setShowEdit(true); }} style={styles.editBtn}>
                    <Edit3 size={20} color={theme.tint} />
                  </TouchableOpacity>
                </View>
              </MotiView>
            )}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<View style={styles.emptyState}><MapIcon size={54} color="white" opacity={0.1} /><Text style={{ color: 'white', opacity: 0.3, marginTop: 15, fontWeight: '700' }}>Bucket is empty.</Text></View>}
          />
        )}
      </View>

      <Modal visible={showWebView} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <BlurView intensity={90} tint="dark" style={[styles.webHeader, { paddingTop: insets.top + 10 }]}><TouchableOpacity onPress={() => setShowWebView(false)}><X size={24} color="#FFF" /></TouchableOpacity><Text style={styles.webTitle}>Google Maps Discovery</Text><View style={{ width: 40 }} /></BlurView>
          <WebView source={{ uri: `https://www.google.com/maps/search/${encodeURIComponent(activeTab + ' in ' + (tripLocationName || 'hotels'))}` }} onNavigationStateChange={handleWebViewStateChange} onLoadStart={() => setIsWebLoading(true)} onLoadEnd={() => setIsWebLoading(false)} style={{ flex: 1 }} userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1" />
          {isWebLoading && <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)' }]}><ActivityIndicator size="large" color={theme.tint} /></View>}
        </View>
      </Modal>

      <Modal visible={showPicker} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={styles.sheetContent}>
            <Text style={styles.sheetTitle}>Save {pendingLocation?.name}?</Text>
            <View style={styles.catGrid}>
              {dbCategories.map(cat => <TouchableOpacity key={cat.id} style={styles.catChip} onPress={() => saveNewItem(cat.name)}><Text style={styles.catChipText}>{cat.name}</Text></TouchableOpacity>)}
            </View>
          </MotiView>
        </View>
      </Modal>

      <Modal visible={showEdit} transparent animationType="fade">
        <View style={styles.modalOverlayCenter}>
          <BlurView intensity={100} tint="dark" style={styles.editContent}>
            <View style={styles.modalHeader}><Text style={[styles.sheetTitle, { color: '#FFF' }]}>Edit Place</Text><TouchableOpacity onPress={() => setShowEdit(false)}><X size={24} color="#FFF" /></TouchableOpacity></View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionLabel}>NAME</Text>
              <TextInput style={styles.editInput} value={editingItem?.name} onChangeText={(t) => setEditingItem({...editingItem, name: t})} />
              <Text style={[styles.sectionLabel, { marginTop: 15 }]}>NOTES</Text>
              <TextInput multiline style={[styles.editInput, { height: 80, textAlignVertical: 'top' }]} value={editingItem?.notes} onChangeText={(t) => setEditingItem({...editingItem, notes: t})} />
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.tint, marginTop: 30 }]} onPress={updateItem}><Text style={styles.actionBtnText}>Save Changes</Text></TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 20, alignItems: 'center' }} onPress={() => { Alert.alert("Delete?", "Are you sure?", [{ text: "Cancel" }, { text: "Delete", style: 'destructive', onPress: async () => { await supabase.from('bucket_items').delete().eq('id', editingItem.id); fetchBucket(); setShowEdit(false); } }]) }}><Text style={{ color: '#FF3B30', fontWeight: '800' }}>Delete Forever</Text></TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, paddingBottom: 15 },
  headerSubtitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { fontSize: 24, fontWeight: '900' },
  headerActions: { flexDirection: 'row', gap: 10 },
  bucketCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  closeCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  tabsWrapper: { maxHeight: 60, marginBottom: 15 },
  tabsContainer: { paddingHorizontal: 20, gap: 10, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 44, borderRadius: 22, gap: 8, borderWidth: 1, borderColor: 'transparent' },
  tabText: { fontSize: 14, fontWeight: '700' },
  listContainer: { flex: 1, paddingHorizontal: 20 },
  listContent: { paddingBottom: 120 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 28, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' },
  itemPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 18 },
  iconBox: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, marginLeft: 15 },
  itemName: { fontSize: 16, fontWeight: '800' },
  itemNote: { fontSize: 12, marginTop: 3, lineHeight: 16 },
  editBtn: { padding: 20 },
  emptyState: { alignItems: 'center', marginTop: 100 },
  webHeader: { height: 110, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' },
  webCloseBtn: { padding: 10, borderRadius: 20 },
  webTitle: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContent: { borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 30, paddingBottom: 50, backgroundColor: '#1a1a1a' },
  sheetHeader: { alignItems: 'center', marginBottom: 25 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 15 },
  sheetTitle: { fontSize: 22, fontWeight: '900', color: '#FFF' },
  sheetSub: { fontSize: 14, color: '#888', marginTop: 5, textAlign: 'center' },
  sectionLabel: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, marginBottom: 12, textTransform: 'uppercase' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  catChip: { backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 15 },
  catChipText: { fontSize: 14, fontWeight: '800', color: '#FFF' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 25 },
  editContent: { borderRadius: 40, padding: 30, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  editInput: { height: 60, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.05)', color: '#FFF', fontSize: 16, marginBottom: 5 },
  actionBtn: { height: 64, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  actionBtnText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
