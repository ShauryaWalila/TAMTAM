import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Modal, FlatList, Dimensions, TextInput, KeyboardAvoidingView, Platform, Pressable, Image, DeviceEventEmitter } from 'react-native';
import { MapPin, X, Utensils, Camera, Building2, Landmark, Plus, Map as MapIcon, ChevronRight, Globe, Search, Tag, Sparkles, Save, Trash2, Edit3, Bell, BellOff, BellRing } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';
import { registerProximityAlerts } from '@/lib/location';

const { width, height } = Dimensions.get('window');

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
  const isDark = colorScheme === 'dark';
  
  const textColor = theme.text;
  const secondaryText = isDark ? '#A1A1AA' : '#666666'; 
  const unselectedTabBg = isDark ? '#2C2C2E' : '#E5E5EA';
  
  const [items, setItems] = useState<any[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('');
  
  const [showWebView, setShowWebView] = useState(false);

  // Modals State
  const [showPicker, setShowPicker] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [pendingLocation, setPendingLocation] = useState<any>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (tripId && userId) {
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
  }, [tripId, userId]);

  useEffect(() => {
    // Update active geofences when items change
    const alertItems = items.filter(i => i.is_alert_enabled && i.latitude && i.longitude);
    registerProximityAlerts(alertItems.map(i => ({ ...i, type: 'trip_bucket' })));
  }, [items]);

  const fetchCategories = async () => {
    let { data } = await supabase.from('bucket_categories').select('*').eq('trip_id', tripId).order('name', { ascending: true });
    if (data && data.length === 0) {
      const seed = DEFAULT_CATEGORIES.map(c => ({ ...c, trip_id: tripId, is_system: true, user_id: userId }));
      const { data: seeded } = await supabase.from('bucket_categories').insert(seed).select();
      data = seeded || [];
    }
    if (data) {
      setDbCategories(data);
      if (!activeTab && data.length > 0) setActiveTab(data[0].name);
    }
  };

  const fetchBucket = async () => {
    setLoading(true);
    const { data } = await supabase.from('bucket_items').select('*').eq('trip_id', tripId);
    if (data) setItems(data);
    setLoading(false);
  };

  const toggleAlert = async (item: any) => {
    const newValue = !item.is_alert_enabled;
    const { error } = await supabase.from('bucket_items').update({ is_alert_enabled: newValue }).eq('id', item.id);
    if (!error) {
      // Logic handled by useEffect real-time refresh
    }
  };

  const deleteItem = async (id: string) => {
    Alert.alert(
      "Delete Place?",
      "Are you sure you want to permanently remove this place from your trip bucket?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive", 
          onPress: async () => {
            const { error } = await supabase.from('bucket_items').delete().eq('id', id);
            if (!error) {
              fetchBucket();
              setShowEdit(false);
            }
          }
        }
      ]
    );
  };

  const createAndSave = async (isEditing: boolean = false) => {
    if (!newCatName.trim()) return;
    setIsSaving(true);
    try {
      const newCat = { name: newCatName.trim(), icon: 'Tag', color: '#666666', trip_id: tripId, user_id: userId };
      const { data } = await supabase.from('bucket_categories').insert([newCat]).select().single();
      const finalCatName = data?.name || newCatName.trim();
      
      if (isEditing) {
        setEditingItem({...editingItem, category: finalCatName});
      } else {
        await saveNewItem(finalCatName);
      }
      setNewCatName('');
    } catch (e) { Alert.alert("Error", "Could not create category."); } 
    finally { setIsSaving(false); }
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

      const cleanName = rawName.split(',')[0].trim();

      return {
        name: cleanName,
        category: resolvedCategory,
        lat,
        lng,
        address: data.display_name
      };
    } catch (e) {
      return { name: rawName.split(',')[0].trim(), category: 'Visiting', lat, lng, address: '' };
    }
  };

  const onLocationCaptured = async (data: { name: string, lat: number, lng: number }) => {
    const resolved = await reverseGeocodeAndCategorize(data.lat, data.lng, data.name);
    setPendingLocation(resolved);
    setShowPicker(true);
  };

  const saveNewItem = async (categoryName: string) => {
    if (!pendingLocation) return;
    const { error } = await supabase.from('bucket_items').insert([{
      trip_id: tripId,
      name: pendingLocation.name,
      category: categoryName,
      latitude: pendingLocation.lat,
      longitude: pendingLocation.lng,
      notes: '' 
    }]);

    if (!error) {
      setActiveTab(categoryName);
      setShowPicker(false);
      setShowWebView(false);
      setPendingLocation(null);
      fetchBucket();
    }
  };

  const updateItem = async () => {
    if (!editingItem) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from('bucket_items').update({
        name: editingItem.name,
        notes: editingItem.notes,
        category: editingItem.category
      }).eq('id', editingItem.id);

      if (!error) {
        setShowEdit(false);
        fetchBucket();
      }
    } catch (e) { Alert.alert("Error", "Update failed."); }
    finally { setIsSaving(false); }
  };

  const handleItemPress = (item: any) => {
    if (mapRef?.current && item.latitude && item.longitude) {
      onSelectItem(item);
      mapRef.current.animateToRegion({
        latitude: item.latitude,
        longitude: item.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  };

  const activeCategoryInfo = dbCategories.find(c => c.name === activeTab) || dbCategories[0];
  const ActiveIcon = IconMap[activeCategoryInfo?.icon] || MapPin;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSubtitle, { color: secondaryText }]}>SHARED STAGING AREA</Text>
          <Text style={[styles.headerTitle, { color: textColor }]}>Trip Bucket</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <TouchableOpacity style={[styles.bucketCircle, { backgroundColor: theme.tint }]} onPress={() => setShowWebView(true)}>
            <Image source={BucketIcon} style={{ width: 20, height: 20, tintColor: 'white', resizeMode: 'contain' }} />
          </TouchableOpacity>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={[styles.closeCircle, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
              <X size={20} color={textColor} />
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
              <TouchableOpacity key={cat.id} onPress={() => setActiveTab(cat.name)} style={[styles.tab, { backgroundColor: isSelected ? cat.color + (isDark ? '30' : '20') : unselectedTabBg }, isSelected && { borderColor: cat.color, borderWidth: 1 }]}>
                <Icon size={18} color={isSelected ? cat.color : secondaryText} />
                <Text style={[styles.tabText, { color: isSelected ? cat.color : secondaryText }]}>{cat.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.listContainer}>
        {loading ? (
          <ActivityIndicator color={theme.tint} style={{ marginTop: 40 }} />
        ) : items.filter(i => i.category === activeTab).length === 0 ? (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.emptyState}>
            <MapIcon size={54} color={secondaryText} opacity={0.2} />
            <Text style={[styles.emptyText, { color: textColor }]}>{activeTab} is empty</Text>
            <TouchableOpacity onPress={() => setShowWebView(true)} style={[styles.addBtn, { borderColor: theme.tint }]}>
              <Plus size={16} color={theme.tint} /><Text style={{ color: theme.tint, fontWeight: 'bold', marginLeft: 5 }}>Explore Map</Text>
            </TouchableOpacity>
          </MotiView>
        ) : (
          <FlatList
            data={items.filter(i => i.category === activeTab)}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: index * 100 }}>
                <View style={[styles.itemCard, { backgroundColor: theme.card }]}>
                  <Pressable style={styles.itemPressable} onPress={() => handleItemPress(item)}>
                    <View style={[styles.iconBox, { backgroundColor: activeCategoryInfo?.color + '15' }]}><ActiveIcon size={18} color={activeCategoryInfo?.color} /></View>
                    <View style={styles.itemInfo}>
                      <Text style={[styles.itemName, { color: textColor }]}>{item.name}</Text>
                      {item.notes ? <Text style={[styles.itemNote, { color: secondaryText }]} numberOfLines={2}>{item.notes}</Text> : null}
                    </View>
                  </Pressable>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => toggleAlert(item)} style={[styles.alertBtn, { backgroundColor: item.is_alert_enabled ? theme.tint + '20' : 'transparent' }]}>
                      {item.is_alert_enabled ? <BellRing size={20} color={theme.tint} /> : <BellOff size={20} color={secondaryText} opacity={0.5} />}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setEditingItem({...item}); setShowEdit(true); }} style={styles.editBtn}>
                      <Edit3 size={20} color={theme.tint} />
                    </TouchableOpacity>
                  </View>
                </View>
              </MotiView>
            )}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>

      {/* Picker Modal */}
      <Modal visible={showPicker} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.pickerOverlay}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowPicker(false)} />
            <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.sheetContent, { backgroundColor: theme.card }]}>
              <View style={styles.sheetHeader}>
                <View style={styles.handle} />
                <Text style={[styles.sheetTitle, { color: textColor }]}>Place Detected!</Text>
                <Text style={[styles.sheetSub, { color: secondaryText }]}>{pendingLocation?.name}</Text>
              </View>
              <Text style={styles.sectionLabel}>Select Category</Text>
              <View style={styles.catGrid}>
                {dbCategories.map(cat => (
                  <TouchableOpacity key={cat.id} style={[styles.catChip, { backgroundColor: theme.background }]} onPress={() => saveNewItem(cat.name)}>
                    {pendingLocation?.category === cat.name && <Sparkles size={14} color="#FFD700" style={{ marginRight: 5 }} />}
                    <Text style={[styles.catChipText, { color: textColor }]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Quick Add Category</Text>
              <View style={[styles.quickAddRow, { backgroundColor: theme.background }]}>
                <TextInput style={[styles.quickAddInput, { color: textColor }]} placeholder="New category name..." placeholderTextColor={secondaryText} value={newCatName} onChangeText={setNewCatName} />
                <TouchableOpacity style={[styles.quickAddBtn, { backgroundColor: theme.tint }]} onPress={() => createAndSave(false)} disabled={!newCatName.trim() || isSaving}>
                  {isSaving ? <ActivityIndicator size="small" color="white" /> : <Plus size={24} color="white" />}
                </TouchableOpacity>
              </View>
            </MotiView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEdit} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={styles.modalOverlayCenter}>
            <BlurView intensity={100} tint={colorScheme} style={[styles.editContent, { backgroundColor: theme.card }]}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.sheetTitle, { color: textColor }]}>Edit Place</Text>
                  <TouchableOpacity onPress={() => setShowEdit(false)}><X size={24} color={textColor} /></TouchableOpacity>
                </View>
                
                <Text style={styles.sectionLabel}>Display Name</Text>
                <TextInput style={[styles.editInput, { backgroundColor: theme.background, color: textColor }]} value={editingItem?.name} onChangeText={(t) => setEditingItem({...editingItem, name: t})} />
                
                <Text style={[styles.sectionLabel, { marginTop: 15 }]}>Personal Notes</Text>
                <TextInput multiline style={[styles.editInput, { backgroundColor: theme.background, color: textColor, height: 80, textAlignVertical: 'top' }]} placeholder="Add details, what to order, etc..." placeholderTextColor={secondaryText} value={editingItem?.notes} onChangeText={(t) => setEditingItem({...editingItem, notes: t})} />
                
                <Text style={[styles.sectionLabel, { marginTop: 15 }]}>Change Category</Text>
                <View style={styles.catGrid}>
                  {dbCategories.map(cat => (
                    <TouchableOpacity key={cat.id} style={[styles.catChip, { backgroundColor: editingItem?.category === cat.name ? cat.color + '20' : theme.background, borderColor: editingItem?.category === cat.name ? cat.color : 'transparent', borderWidth: 1 }]} onPress={() => setEditingItem({...editingItem, category: cat.name})}>
                      <Text style={[styles.catChipText, { color: textColor }]}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 15 }]}>Add New Category</Text>
                <View style={[styles.quickAddRow, { backgroundColor: theme.background }]}>
                  <TextInput style={[styles.quickAddInput, { color: textColor }]} placeholder="Type new name..." placeholderTextColor={secondaryText} value={newCatName} onChangeText={setNewCatName} />
                  <TouchableOpacity style={[styles.quickAddBtn, { backgroundColor: theme.tint }]} onPress={() => createAndSave(true)} disabled={!newCatName.trim() || isSaving}>
                    {isSaving ? <ActivityIndicator size="small" color="white" /> : <Plus size={24} color="white" />}
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 25 }}>
                  <TouchableOpacity style={[styles.actionBtn, { flex: 1, backgroundColor: theme.tint }]} onPress={updateItem}>
                    {isSaving ? <ActivityIndicator color="white" /> : <><Save size={20} color="white" /><Text style={styles.actionBtnText}>Save Changes</Text></>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#FF4B4B20' }]} onPress={() => deleteItem(editingItem.id)}>
                    <Trash2 size={20} color="#FF4B4B" />
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </BlurView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* SMART MAP CAPTURE */}
      <Modal visible={showWebView} animationType="slide">
        <SmartLocationPicker 
          title="Google Maps Discovery"
          onLocationCaptured={onLocationCaptured}
          onClose={() => setShowWebView(false)}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, paddingTop: 80 },
  headerSubtitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { fontSize: 24, fontWeight: '900' },
  bucketCircle: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  closeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  tabsWrapper: { maxHeight: 60, marginBottom: 15 },
  tabsContainer: { paddingHorizontal: 20, gap: 10, alignItems: 'center' },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, height: 44, borderRadius: 22, gap: 8 },
  tabText: { fontSize: 14, fontWeight: '700' },
  listContainer: { flex: 1, paddingHorizontal: 20 },
  listContent: { paddingBottom: 120 },
  itemCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 28, marginBottom: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, overflow: 'hidden' },
  itemPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 18 },
  iconBox: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, marginLeft: 15 },
  itemName: { fontSize: 17, fontWeight: '700' },
  itemNote: { fontSize: 12, marginTop: 3, lineHeight: 16 },
  cardActions: { flexDirection: 'row', alignItems: 'center' },
  alertBtn: { padding: 15, borderRadius: 15 },
  editBtn: { padding: 15 },
  emptyState: { alignItems: 'center', marginTop: 60 },
  emptyText: { marginTop: 15, fontSize: 16, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 20, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20 },
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  editContent: { borderRadius: 32, padding: 25, overflow: 'hidden', maxHeight: '90%' },
  sheetContent: { borderTopLeftRadius: 35, borderTopRightRadius: 35, padding: 25, paddingBottom: 40 },
  sheetHeader: { alignItems: 'center', marginBottom: 20 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.1)', marginBottom: 15 },
  sheetTitle: { fontSize: 20, fontWeight: '900' },
  sheetSub: { fontSize: 14, marginTop: 4, fontWeight: '500', textAlign: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: '#888', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 1 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 15 },
  catChipText: { fontSize: 14, fontWeight: '700' },
  quickAddRow: { flexDirection: 'row', alignItems: 'center', padding: 5, paddingLeft: 15, borderRadius: 20, height: 60, marginTop: 5 },
  quickAddInput: { flex: 1, marginLeft: 10, fontSize: 16, fontWeight: '600' },
  quickAddBtn: { width: 50, height: 50, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  editInput: { borderRadius: 15, padding: 15, fontSize: 16, fontWeight: '600', marginBottom: 5 },
  actionBtn: { height: 55, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  actionBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }
});
