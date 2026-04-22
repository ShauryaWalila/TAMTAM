import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Dimensions, Pressable, Modal, Image } from 'react-native';
import { Shirt, Plus, X, Check, Trash2, Edit3, ChevronDown, Tags, Type, AlignLeft, Briefcase, CheckCircle2, Package, Eye, ArrowRight, Download, ChevronRight, Layers } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HORIZONTAL_PADDING = 20;
const GRID_GAP = 12;
const CARD_WIDTH = (SCREEN_WIDTH - (HORIZONTAL_PADDING * 2) - GRID_GAP) / 2;
const CARD_HEIGHT = 100; 

const HANGER_ICON = require('@/assets/images/clothes-hanger.png');

interface WardrobeProps {
  userId: string;
  tripId?: string;
  isSettingsMode?: boolean;
  onClose?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export default function Wardrobe({ userId, tripId, isSettingsMode, onClose, onDragStart, onDragEnd }: WardrobeProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  
  const [items, setItems] = useState<any[]>([]);
  const [tripHangedIds, setTripHangedIds] = useState<string[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAddMode] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  
  // Selection Logic
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // View/Edit State
  const [viewingItem, setViewingItem] = useState<any | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formCat, setFormCat] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Drag Gesture States
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const bunchScale = useSharedValue(1);
  const isArmed = useSharedValue(0);
  const isDragging = useSharedValue(0);
  const [isDraggingBunch, setIsDraggingBunch] = useState(false);

  useEffect(() => {
    fetchWardrobe();
    const sub = supabase.channel(`wardrobe_realtime`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wardrobe' }, fetchWardrobe)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_wardrobe' }, fetchWardrobe)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [tripId]);

  const fetchWardrobe = async () => {
    setLoading(true);
    // 1. Fetch all wardrobe items
    const { data: wardrobeData } = await supabase.from('wardrobe').select('*').eq('is_in_wardrobe', true).order('created_at', { ascending: false });
    if (wardrobeData) setItems(wardrobeData);

    // 2. Fetch categories
    const { data: catData } = await supabase.from('wardrobe_categories').select('*').order('name');
    if (catData) {
      setDbCategories(catData);
      if (expandedCategories.length === 0) setExpandedCategories(catData.map(c => c.name));
    }

    // 3. Fetch items already hanged for this trip
    if (tripId) {
      const { data: tripItems } = await supabase.from('trip_wardrobe').select('wardrobe_item_id').eq('trip_id', tripId);
      if (tripItems) setTripHangedIds(tripItems.map(ti => ti.wardrobe_item_id));
    }
    setLoading(false);
  };

  const handleHangSelected = async () => {
    if (!tripId || selectedIds.length === 0) return;
    
    setSubmitting(true);
    try {
      const inserts = selectedIds.map(itemId => ({
        trip_id: tripId,
        wardrobe_item_id: itemId,
        user_id: userId
      }));

      const { error } = await supabase.from('trip_wardrobe').insert(inserts);
      if (error) throw error;

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSelectedIds([]); // Clear selection
      fetchWardrobe();
    } catch (e: any) {
      Alert.alert('Error', 'Failed to hang items. Check if they were already added.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelection = (itemId: string) => {
    if (tripHangedIds.includes(itemId)) return; // Already hanged
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds(prev => {
      if (prev.includes(itemId)) return prev.filter(id => id !== itemId);
      return [...prev, itemId];
    });
  };

  const handleSave = async () => {
    if (!formName.trim() || !formCat) return Alert.alert('Required', 'Name and Category are needed.');
    setSubmitting(true);
    try {
      const payload = { user_id: userId, name: formName.trim(), category: formCat, description: formDesc.trim(), is_in_wardrobe: true, target_user: userId };
      const { error } = editingItemId ? await supabase.from('wardrobe').update(payload).eq('id', editingItemId) : await supabase.from('wardrobe').insert([payload]);
      if (error) throw error;
      setIsAddMode(false); setEditingItemId(null); resetForm(); fetchWardrobe();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSubmitting(false); }
  };

  const resetForm = () => { setFormName(''); setFormCat(''); setFormDesc(''); };

  const deleteItem = async (id: string) => {
    Alert.alert('Permanent Delete', 'Continue?', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('wardrobe').delete().eq('id', id); setIsAddMode(false); setEditingItemId(null); fetchWardrobe(); } }
    ]);
  };

  const groupedItems = useMemo(() => {
    return items.reduce((acc: any, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});
  }, [items]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  // Drag Gesture
  const panGesture = Gesture.Pan()
    .enabled(!isSettingsMode)
    .onBegin(() => {
      isDragging.value = withSpring(1);
      bunchScale.value = withSpring(1.15);
      runOnJS(setIsDraggingBunch)(true);
      if (onDragStart) runOnJS(onDragStart)();
    })
    .onUpdate((event) => {
      dragX.value = event.translationX;
      dragY.value = event.translationY;
      const threshold = SCREEN_WIDTH * 0.25;
      if (event.translationX > threshold) {
        if (isArmed.value === 0) {
          isArmed.value = withSpring(1);
          bunchScale.value = withSpring(1.3);
        }
      } else {
        if (isArmed.value === 1) {
          isArmed.value = withSpring(0);
          bunchScale.value = withSpring(1.15);
        }
      }
    })
    .onEnd((event) => {
      const threshold = SCREEN_WIDTH * 0.25;
      if (event.translationX > threshold) runOnJS(handleHangSelected)();
      dragX.value = withSpring(0);
      dragY.value = withSpring(0);
      bunchScale.value = withSpring(1);
      isArmed.value = withSpring(0);
      isDragging.value = withSpring(0);
      runOnJS(setIsDraggingBunch)(false);
      if (onDragEnd) runOnJS(onDragEnd)();
    });

  const animatedBunchStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }, { scale: bunchScale.value }, { rotate: `${dragX.value * 0.05}deg` }],
    backgroundColor: isArmed.value ? '#34C759' : theme.tint,
    opacity: (selectedIds.length > 0 && !isSettingsMode) ? 1 : 0,
    elevation: isDragging.value ? 25 : 15,
  }));

  const dropZoneStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isDragging.value ? 0.6 : 0),
    transform: [{ scale: withSpring(isArmed.value ? 1.1 : 1) }],
  }));

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* 🏙️ HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.headerSubtitle, { color: theme.tabIconDefault }]}>{isSettingsMode ? 'MASTER WARDROBE' : 'COLLECTION'}</Text>
            <Text style={styles.headerTitle}>Wardrobe Sets</Text>
          </View>
          <View style={styles.headerActions}>
            {isSettingsMode && (
              <TouchableOpacity style={[styles.addCircle, { backgroundColor: '#000' }]} onPress={() => { resetForm(); setEditingItemId(null); setIsAddMode(true); }}>
                <Plus size={22} color="white" />
              </TouchableOpacity>
            )}
            {onClose && (
              <TouchableOpacity style={[styles.closeBtnCircle, { backgroundColor: '#f5f5f5' }]} onPress={onClose}>
                <X size={22} color="#000" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* BUNCH DRAG OVERLAY */}
        {!isSettingsMode && (
          <AnimatePresence>
            {selectedIds.length > 0 && (
              <View style={styles.bunchWrapper} pointerEvents="none">
                <Animated.View style={[styles.dropZone, dropZoneStyle]}>
                  <ChevronRight size={32} color="#34C759" />
                  <Shirt size={48} color="#34C759" opacity={0.3} />
                </Animated.View>
                <GestureDetector gesture={panGesture}>
                  <Animated.View style={[styles.bunchContainer, animatedBunchStyle]} pointerEvents="auto">
                    <Layers size={24} color="white" />
                    <Text style={styles.bunchCount}>{selectedIds.length}</Text>
                  </Animated.View>
                </GestureDetector>
              </View>
            )}
          </AnimatePresence>
        )}

        {loading && items.length === 0 ? (
          <View style={styles.centered}><ActivityIndicator color={theme.tint} /></View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listPadding}>
            {Object.keys(groupedItems).map((cat) => (
              <View key={cat} style={styles.categorySection}>
                <TouchableOpacity style={styles.categoryHeader} onPress={() => toggleCategory(cat)}>
                  <View style={styles.catLabelRow}><Tags size={14} color={theme.tint} /><Text style={styles.categoryName}>{cat.toUpperCase()}</Text></View>
                  <View style={[styles.badge, { backgroundColor: theme.tint + '15' }]}><Text style={[styles.badgeText, { color: theme.tint }]}>{groupedItems[cat].length}</Text></View>
                </TouchableOpacity>

                <AnimatePresence>
                  {expandedCategories.includes(cat) && (
                    <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.itemsGrid}>
                      {groupedItems[cat].map((item: any) => {
                        const isHanged = tripHangedIds.includes(item.id);
                        const isSelected = selectedIds.includes(item.id);
                        
                        return (
                          <TouchableOpacity 
                            key={item.id} 
                            activeOpacity={0.8}
                            onPress={() => tripId ? toggleSelection(item.id) : setViewingItem(item)}
                            style={[
                              styles.itemCard, 
                              isSelected && { borderColor: theme.tint, borderWidth: 2, backgroundColor: theme.tint + '05' },
                              isHanged && { backgroundColor: '#f9f9f9', borderColor: '#eee' }
                            ]}
                          >
                            <View style={styles.cardTop}>
                              <TouchableOpacity onPress={() => setViewingItem(item)} style={styles.actionIcon}><Eye size={16} color={theme.tint} /></TouchableOpacity>
                              {isSettingsMode && (
                                <TouchableOpacity onPress={() => { setEditingItemId(item.id); setFormName(item.name); setFormCat(item.category); setFormDesc(item.description || ''); setIsAddMode(true); }} style={styles.actionIcon}><Edit3 size={16} color="#666" /></TouchableOpacity>
                              )}
                            </View>
                            
                            <View style={styles.cardMain}>
                              <Text style={[styles.itemName, isHanged && { color: '#aaa' }]} numberOfLines={2}>{item.name}</Text>
                              <View style={styles.statusIndicator}>
                                {isHanged ? (
                                  <Image source={HANGER_ICON} style={styles.statusHanger} />
                                ) : isSelected ? (
                                  <CheckCircle2 size={16} color={theme.tint} />
                                ) : null}
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </MotiView>
                  )}
                </AnimatePresence>
              </View>
            ))}
          </ScrollView>
        )}

        {/* MODALS REMAIN UNCHANGED */}
        <Modal visible={!!viewingItem} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.viewModalContent}>
              <View style={styles.modalHeader}><Text style={styles.viewModalTitle}>Item Details</Text><TouchableOpacity onPress={() => setViewingItem(null)} style={styles.viewCloseBtn}><X size={24} color="#000" /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.infoBlock}><Text style={styles.infoLabel}>NAME</Text><Text style={styles.infoValue}>{viewingItem?.name}</Text></View>
                <View style={styles.infoBlock}><Text style={styles.infoLabel}>CATEGORY / SET</Text><Text style={styles.infoValue}>{viewingItem?.category?.toUpperCase()}</Text></View>
                <View style={[styles.infoBlock, { borderBottomWidth: 0 }]}><Text style={styles.infoLabel}>NOTES & DESCRIPTION</Text><Text style={styles.infoDesc}>{viewingItem?.description || 'No notes added.'}</Text></View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={isAdding} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
              <View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingItemId ? 'Edit Item' : 'New Set'}</Text><TouchableOpacity onPress={() => setIsAddMode(false)}><X size={24} color="#000" /></TouchableOpacity></View>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.inputLabel}>NAME</Text>
                <TextInput style={styles.premiumInput} placeholder="e.g. Silk Evening Gown" value={formName} onChangeText={setFormName} />
                <Text style={styles.inputLabel}>DESCRIPTION</Text>
                <TextInput style={[styles.premiumInput, { height: 100, textAlignVertical: 'top', paddingTop: 15 }]} value={formDesc} onChangeText={setFormDesc} multiline />
                <Text style={styles.inputLabel}>CATEGORY</Text>
                <View style={styles.gridPicker}>{dbCategories.map(c => <TouchableOpacity key={c.id} onPress={() => setFormCat(c.name)} style={[styles.miniChip, formCat === c.name && { backgroundColor: theme.tint }]}><Text style={[styles.miniChipText, formCat === c.name && { color: 'white' }]}>{c.name}</Text></TouchableOpacity>)}</View>
                <View style={{ marginTop: 30, gap: 15 }}>
                  <TouchableOpacity onPress={handleSave} style={[styles.saveBtnFull, { backgroundColor: theme.tint }]}>{submitting ? <ActivityIndicator color="white" /> : <><Check size={20} color="white" /><Text style={styles.saveBtnText}>Save Changes</Text></>}</TouchableOpacity>
                  {editingItemId && <TouchableOpacity onPress={() => deleteItem(editingItemId)} style={styles.deleteBtnFull}><Trash2 size={18} color="#FF3B30" /><Text style={styles.deleteText}>Delete Item</Text></TouchableOpacity>}
                </View>
              </ScrollView>
            </BlurView>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, paddingBottom: 15 },
  headerSubtitle: { fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: '#000', marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  addCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  closeBtnCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listPadding: { paddingHorizontal: HORIZONTAL_PADDING, paddingBottom: 100 },
  categorySection: { marginBottom: 10 },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  catLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryName: { fontSize: 13, fontWeight: '800', color: '#444' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  itemsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, paddingVertical: 15 },
  itemCard: { width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: '#fff', borderRadius: 22, padding: 12, borderWidth: 1, borderColor: '#f0f0f0', elevation: 3, justifyContent: 'space-between' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  actionIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  cardMain: { flex: 1, justifyContent: 'flex-end', position: 'relative' },
  itemName: { fontSize: 13, fontWeight: '800', color: '#222' },
  statusIndicator: { position: 'absolute', bottom: 0, right: 0 },
  statusHanger: { width: 20, height: 20, tintColor: '#000', resizeMode: 'contain', opacity: 0.8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  viewModalContent: { height: '60%', borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 35, backgroundColor: '#FFF', elevation: 25 },
  viewModalTitle: { fontSize: 22, fontWeight: '900', color: '#000' },
  viewCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  infoBlock: { paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1.5, marginBottom: 8 },
  infoValue: { fontSize: 18, fontWeight: '800', color: '#000' },
  infoDesc: { fontSize: 16, fontWeight: '500', color: '#444', lineHeight: 24 },
  modalContent: { height: '85%', borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 30, backgroundColor: '#fff' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  inputLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1.5, marginBottom: 10, marginTop: 20 },
  premiumInput: { height: 60, borderRadius: 18, paddingHorizontal: 20, fontWeight: '700', fontSize: 16, backgroundColor: '#f9f9f9', color: '#000' },
  gridPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#f0f0f0' },
  miniChipText: { fontSize: 12, fontWeight: '800' },
  saveBtnFull: { height: 64, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
  deleteBtnFull: { height: 50, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#FF3B30' },
  deleteText: { color: '#FF3B30', fontSize: 14, fontWeight: '800' },
  bunchWrapper: { position: 'absolute', bottom: 40, left: 0, right: 0, height: 150, alignItems: 'center', zIndex: 1000 },    
  bunchContainer: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20 },
  bunchCount: { color: 'white', fontSize: 18, fontWeight: '900', marginTop: 2 },
  dropZone: { position: 'absolute', right: 30, width: 100, height: 100, borderRadius: 50, borderStyle: 'dashed', borderWidth: 3, borderColor: '#34C759', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(52, 199, 89, 0.05)' },
});
