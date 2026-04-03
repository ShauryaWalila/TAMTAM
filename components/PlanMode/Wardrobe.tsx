import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Dimensions, Pressable, Image } from 'react-native';
import { Shirt, Plus, X, Check, Trash2, Edit3, ChevronRight, ChevronDown, Package, Type, AlignLeft, Tags, Search, Eye, Layers, Sparkles } from 'lucide-react-native';

const HangerIcon = require('@/assets/images/clothes-hanger.png');
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width, height } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 60) / 2;

interface WardrobeProps {
  userId: string;
  tripId?: string;
  onClose?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isReadOnly?: boolean;
  isSettingsMode?: boolean;
}

export default function Wardrobe({ userId, tripId, onClose, onDragStart, onDragEnd, isReadOnly, isSettingsMode }: WardrobeProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [items, setItems] = useState<any[]>([]);
  const [hungItemIds, setHungItemIds] = useState<string[]>([]);
  const [dbCategories, setDbCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAddMode] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<string[]>([]);
  const [isCatDropdownOpen, setIsCatDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const isSelectionMode = true;

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const bunchScale = useSharedValue(1);
  const isArmed = useSharedValue(0);
  const isDragging = useSharedValue(0);
  const [isDraggingBunch, setIsDraggingBunch] = useState(false);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<any | null>(null);
  const [formName, setFormName] = useState('');
  const [formCat, setFormCat] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchWardrobe();
      fetchCategories();
      if (tripId) {
        fetchHungItems();
        const channel = supabase.channel(`wardrobe_hung_${tripId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_wardrobe', filter: `trip_id=eq.${tripId}` }, () => fetchHungItems())
          .subscribe();
        return () => { supabase.removeChannel(channel); };
      }
    }
  }, [userId, tripId]);

  const fetchWardrobe = async () => {
    setLoading(true);
    try {
      // Revert to user-centric master wardrobe
      const { data, error } = await supabase
        .from('wardrobe')
        .select('*')
        .order('category', { ascending: true })
        .eq('user_id', userId)
        .eq('is_in_wardrobe', true);

      if (error) throw error;
      setItems(data || []);
      if (data && data.length > 0 && expandedCategories.length === 0) {
        setExpandedCategories([data[0].category || 'Uncategorized']);
      }
    } catch (e: any) {
      console.error('Fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchHungItems = async () => {
    if (!tripId) return;
    try {
      const { data } = await supabase.from('trip_wardrobe').select('wardrobe_item_id').eq('trip_id', tripId);   
      setHungItemIds(data?.map(d => d.wardrobe_item_id) || []);
    } catch (e) { console.error('Failed to fetch hung items'); }
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('wardrobe_categories').select('*').order('name', { ascending: true }); 
    if (data) setDbCategories(data);
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  const groupedItems = useMemo(() => {
    return items.reduce((acc: any, item) => {
      const cat = item.category || 'Uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {});
  }, [items]);

  const filteredCategories = useMemo(() => {
    if (!searchTerm) return dbCategories;
    return dbCategories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [dbCategories, searchTerm]);

  const handleBatchAction = async () => {
    if (selectedItems.length === 0) return;
    setSubmitting(true);
    try {
      if (!isSettingsMode) {
        const payload = selectedItems.map(itemId => ({ trip_id: tripId, wardrobe_item_id: itemId, user_id: userId }));
        await supabase.from('trip_wardrobe').upsert(payload, { onConflict: 'trip_id,wardrobe_item_id' });       
      } else {
        await supabase.from('wardrobe').update({ is_in_wardrobe: false }).in('id', selectedItems);
      }
      setSelectedItems([]);
      fetchWardrobe();
      if (!isSettingsMode) fetchHungItems();
    } catch (e: any) { Alert.alert('Error', 'Action failed.'); } finally { setSubmitting(false); }
  };

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
      const threshold = width * 0.25;
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
      const threshold = width * 0.25;
      if (event.translationX > threshold) runOnJS(handleBatchAction)();
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
    opacity: (selectedItems.length > 0 && !isSettingsMode) ? 1 : 0,
    elevation: isDragging.value ? 25 : 15,
  }));

  const dropZoneStyle = useAnimatedStyle(() => ({
    opacity: withSpring(isDragging.value ? 0.6 : 0),
    transform: [{ scale: withSpring(isArmed.value ? 1.1 : 1) }],
  }));

  const selectAll = () => {
    const selectableItems = items.filter(i => !hungItemIds.includes(i.id));
    if (selectedItems.length > 0) setSelectedItems([]);
    else setSelectedItems(selectableItems.map(i => i.id));
  };

  const handleSave = async () => {
    if (!formName || !formCat) return;
    setSubmitting(true);
    try {
      const payload = { user_id: userId, name: formName, category: formCat, description: formDesc, is_in_wardrobe: true };
      if (editingItemId) await supabase.from('wardrobe').update(payload).eq('id', editingItemId);
      else await supabase.from('wardrobe').insert([payload]);
      setEditingItemId(null); setIsAddMode(false); resetForm(); fetchWardrobe();
    } catch (e: any) { Alert.alert('Error', 'Failed to save.'); } finally { setSubmitting(false); }
  };

  const resetForm = () => {
    setFormName(''); setFormCat(''); setFormDesc(''); setIsCatDropdownOpen(false); setSearchTerm('');
  };

  const startEdit = (item: any) => {
    setEditingItemId(item.id); setFormName(item.name); setFormCat(item.category);
    setFormDesc(item.description || ''); setIsAddMode(true);
  };

  const handleCatSelect = (name: string) => {
    setFormCat(name);
    setIsCatDropdownOpen(false);
  };

  const toggleItemSelection = (id: string) => {
    if (hungItemIds.includes(id)) return;
    setSelectedItems(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerSubtitle, { color: theme.tabIconDefault }]}>{isSettingsMode ? 'MASTER WARDROBE' : 'PLANNING RACK'}</Text>
          <Text style={[styles.headerTitle, { color: '#1a1a1a' }]}>Wardrobe</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          {items.length > 0 && (
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: theme.tint }]} onPress={selectAll}>   
              <Text style={{ color: theme.tint, fontSize: 10, fontWeight: 'bold' }}>{selectedItems.length > 0 ? 'DESELECT' : 'ALL'}</Text>
            </TouchableOpacity>
          )}
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeCircle}>
              <X size={20} color="#000" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={theme.tint} /></View>
      ) : items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Package size={48} color={theme.tabIconDefault} opacity={0.3} />
          <Text style={styles.emptyText}>No active clothes.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listPadding}>
          {Object.keys(groupedItems).map((cat, idx) => (
            <MotiView key={cat} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: idx * 100 }} style={styles.categorySection}>
              <TouchableOpacity style={styles.categoryHeader} onPress={() => toggleCategory(cat)}>
                <View style={styles.catLabelRow}><Tags size={14} color={theme.tint} /><Text style={[styles.categoryName, { color: '#555' }]}>{cat.toUpperCase()}</Text></View>
                <View style={[styles.badge, { backgroundColor: theme.tint + '15' }]}><Text style={[styles.badgeText, { color: theme.tint }]}>{groupedItems[cat].length}</Text></View>
              </TouchableOpacity>
              <AnimatePresence>
                {expandedCategories.includes(cat) && (
                  <MotiView from={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'timing', duration: 250 }} style={styles.itemsGrid}>
                    {groupedItems[cat].map((item: any) => {
                      const isSelected = selectedItems.includes(item.id);
                      const isHung = hungItemIds.includes(item.id);
                      return (
                        <Pressable key={item.id} onPress={() => toggleItemSelection(item.id)} style={[styles.itemCard, isSelected && { borderColor: theme.tint, borderWidth: 2, backgroundColor: theme.tint + '05' }, isHung && { opacity: 0.6, backgroundColor: 'rgba(0,0,0,0.02)' }]}>
                          <View style={styles.cardHeader}>
                            {isHung ? (
                              <View style={[styles.checkbox, { borderColor: theme.tint + '40', backgroundColor: theme.tint + '10' }]}>
                                <Image source={HangerIcon} style={[styles.hangedIcon, { tintColor: theme.tint }]} />
                              </View>
                            ) : (
                              <View style={[styles.checkbox, isSelected && { backgroundColor: theme.tint, borderColor: theme.tint }]}>{isSelected && <Check size={10} color="white" />}</View>
                            )}
                            <TouchableOpacity onPress={() => setViewingItem(item)} style={styles.viewBtn}><Eye size={16} color={theme.tint} /></TouchableOpacity>
                          </View>
                          <Text style={[styles.itemName, { color: isHung ? '#888' : '#222' }]} numberOfLines={2}>{item.name}</Text>
                        </Pressable>
                      );
                    })}
                  </MotiView>
                )}
              </AnimatePresence>
            </MotiView>
          ))}
        </ScrollView>
      )}

      {/* BUNCH DRAG OVERLAY */}
      {!isSettingsMode && (
        <AnimatePresence>
          {selectedItems.length > 0 && (
            <View style={styles.bunchWrapper} pointerEvents="none">
              <Animated.View style={[styles.dropZone, dropZoneStyle]}>
                <ChevronRight size={32} color="#34C759" />
                <Shirt size={48} color="#34C759" opacity={0.3} />
              </Animated.View>
              <GestureDetector gesture={panGesture}>
                <Animated.View style={[styles.bunchContainer, animatedBunchStyle]} pointerEvents="auto">
                  <Layers size={24} color="white" /><Text style={styles.bunchCount}>{selectedItems.length}</Text>
                </Animated.View>
              </GestureDetector>
            </View>
          )}
        </AnimatePresence>
      )}

      {/* Detail Modals */}
      <AnimatePresence>
        {viewingItem && (
          <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} style={StyleSheet.absoluteFill}>
            <BlurView intensity={80} tint={colorScheme} style={styles.modalBackdrop}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}><Text style={styles.modalTitle}>Item Details</Text><TouchableOpacity onPress={() => setViewingItem(null)} style={styles.closeBtn}><X size={20} color="#000" /></TouchableOpacity></View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>NAME</Text><Text style={styles.detailValue}>{viewingItem.name}</Text></View>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>CATEGORY</Text><View style={styles.detailBadge}><Text style={styles.detailBadgeText}>{viewingItem.category}</Text></View></View>
                  <View style={styles.detailRow}><Text style={styles.detailLabel}>DESCRIPTION</Text><Text style={styles.detailValue}>{viewingItem.description || 'No description provided.'}</Text></View>
                </ScrollView>
              </View>
            </BlurView>
          </MotiView>
        )}
      </AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, paddingTop: 80 },
  headerSubtitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { fontSize: 24, fontWeight: '900' },
  closeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  secondaryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listPadding: { paddingHorizontal: 20, paddingBottom: 150 },
  categorySection: { marginBottom: 15 },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  catLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryName: { fontSize: 12, fontWeight: '800' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 10, fontWeight: 'bold' },
  itemsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, paddingVertical: 15 },
  itemCard: { width: COLUMN_WIDTH, backgroundColor: '#fff', borderRadius: 20, padding: 15, borderWidth: 1, borderColor: '#f0f0f0', elevation: 3, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  hangedIcon: { width: 14, height: 14, resizeMode: 'contain' },
  viewBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  itemName: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
  emptyText: { marginTop: 15, color: '#888', fontWeight: 'bold' },
  bunchWrapper: { position: 'absolute', bottom: 40, left: 0, right: 0, height: 150, alignItems: 'center', zIndex: 1000 },    
  bunchContainer: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', elevation: 20, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20 },
  bunchCount: { color: 'white', fontSize: 18, fontWeight: '900', marginTop: 2 },
  dropZone: { position: 'absolute', right: 30, width: 100, height: 100, borderRadius: 50, borderStyle: 'dashed', borderWidth: 3, borderColor: '#34C759', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(52, 199, 89, 0.05)' },
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { width: '100%', maxHeight: '85%', borderRadius: 40, padding: 30, backgroundColor: '#fff', elevation: 25, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 30 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  detailRow: { marginBottom: 20 },
  detailLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1, marginBottom: 8 },
  detailValue: { fontSize: 16, color: '#222', fontWeight: '500', lineHeight: 22 },
  detailBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.05)' },
  detailBadgeText: { fontSize: 12, fontWeight: '700', color: '#666' },
});
