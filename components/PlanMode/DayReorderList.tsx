import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions, TextInput, Image, ActivityIndicator, Alert } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { GripVertical, MapPin, Calendar, Clock, ChevronDown, ChevronUp, Save, Shirt, X, Trash2, Plus, Sparkles } from 'lucide-react-native';
import { format } from 'date-fns';
import { MotiView, AnimatePresence } from 'moti';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';

const { width } = Dimensions.get('window');

interface DayReorderListProps {
  tripId: string;
  days: any[];
  onReorder: (newData: any[]) => void;
  dayCounts: Record<number, number>;
  onSelectDay: (day: any) => void;
  onAddFromBucket: (dayNumber: number) => void;
}

export default function DayReorderList({ tripId, days, onReorder, dayCounts, onSelectDay, onAddFromBucket }: DayReorderListProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [dayItems, setDayItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    if (expandedDay !== null) {
      fetchDayItems(expandedDay);
    }
  }, [expandedDay]);

  const fetchDayItems = async (dayNumber: number) => {
    setLoadingItems(true);
    const { data } = await supabase
      .from('itinerary_items')
      .select('*, bucket_items(*), itinerary_outfits(wardrobe_item_id, wardrobe(*))')
      .eq('trip_id', tripId)
      .eq('day_number', dayNumber)
      .order('sequence', { ascending: true });
    
    if (data) setDayItems(data);
    setLoadingItems(false);
  };

  const handleUpdateItem = async (itemId: string, updates: any) => {
    const { error } = await supabase.from('itinerary_items').update(updates).eq('id', itemId);
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (expandedDay) fetchDayItems(expandedDay);
    }
  };

  const handleReorderItems = async (newData: any[]) => {
    setDayItems(newData);
    const updates = newData.map((item, index) => ({
      id: item.id,
      sequence: index
    }));
    
    for (const update of updates) {
      await supabase.from('itinerary_items').update({ sequence: update.sequence }).eq('id', update.id);
    }
  };

  const handleAddCustomItem = async () => {
    if (expandedDay === null) return;
    const { data, error } = await supabase
      .from('itinerary_items')
      .insert([{
        trip_id: tripId,
        day_number: expandedDay,
        sequence: dayItems.length,
        is_custom: true,
        custom_label: 'New Custom Activity'
      }]);
    
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchDayItems(expandedDay);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    Alert.alert("Delete Item", "Remove this from your itinerary?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          const { error } = await supabase.from('itinerary_items').delete().eq('id', itemId);
          if (error) {
            console.warn('itinerary_items delete failed', error);
            Alert.alert('Delete failed', error.message || 'Could not remove the item.');
            return;
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          if (expandedDay) fetchDayItems(expandedDay);
        } catch (e) {
          console.warn('itinerary_items delete threw', e);
        }
      }}
    ]);
  };

  const renderItineraryItem = ({ item, drag, isActive }: RenderItemParams<any>) => {
    const isEditing = editingItem?.id === item.id;
    const time = item.target_time ? new Date(`2000-01-01T${item.target_time}`) : new Date();

    return (
      <ScaleDecorator>
        <TouchableOpacity 
          onPress={() => onSelectDay(days.find(d => d.dayNumber === item.day_number))}
          activeOpacity={0.9}
          style={[styles.itineraryCard, { backgroundColor: isActive ? theme.tint + '10' : theme.background, borderColor: isActive ? theme.tint : theme.text + '10' }]}
        >
          <TouchableOpacity onLongPress={drag} style={styles.itineraryDragHandle}>
            <GripVertical size={18} color="#aaa" />
          </TouchableOpacity>

          <View style={styles.itineraryContent}>
            <View style={styles.itineraryHeader}>
              {item.is_custom ? (
                <TextInput
                  style={[styles.customLabelInput, { color: theme.text }]}
                  defaultValue={item.custom_label}
                  placeholder="Activity Name..."
                  onEndEditing={(e) => handleUpdateItem(item.id, { custom_label: e.nativeEvent.text })}
                />
              ) : (
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itineraryName, { color: theme.text }]} numberOfLines={1}>
                    {item.bucket_items?.name}
                  </Text>
                  {item.bucket_items?.category && (
                    <View style={styles.catBadge}>
                      <Text style={styles.catText}>{item.bucket_items.category.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              )}
              <View style={styles.itineraryActions}>
                <TouchableOpacity onPress={() => setEditingItem(isEditing ? null : item)} style={styles.actionBtn}>
                  <Clock size={16} color={item.target_time ? theme.tint : '#888'} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDeleteItem(item.id)} style={styles.actionBtn}>
                  <Trash2 size={16} color="#FF3B30" opacity={0.6} />
                </TouchableOpacity>
              </View>
            </View>

            {isEditing ? (
              <MotiView from={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} style={styles.editSection}>
                <View style={styles.timeRow}>
                  <TouchableOpacity 
                    style={[styles.timeBtn, { backgroundColor: theme.tint + '15' }]} 
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={[styles.timeText, { color: theme.tint }]}>
                      {item.target_time || 'Set Time'}
                    </Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker
                      value={time}
                      mode="time"
                      is24Hour={true}
                      themeVariant={colorScheme}
                      onChange={(e, d) => {
                        setShowTimePicker(false);
                        if (d) handleUpdateItem(item.id, { target_time: format(d, 'HH:mm') });
                      }}
                    />
                  )}
                </View>
                <TextInput
                  style={[styles.notesInput, { color: theme.text, backgroundColor: theme.text + '05' }]}
                  placeholder="Add optional comments..."
                  placeholderTextColor="#888"
                  defaultValue={item.notes}
                  onEndEditing={(e) => handleUpdateItem(item.id, { notes: e.nativeEvent.text })}
                  multiline
                />
              </MotiView>
            ) : (
              item.target_time && (
                <Text style={[styles.timeLabel, { color: theme.tint }]}>{item.target_time}</Text>
              )
            )}

            {/* Outfits Row */}
            {item.itinerary_outfits?.length > 0 && (
              <View style={styles.miniOutfitsRow}>
                {item.itinerary_outfits.map((io: any) => (
                  <View key={io.wardrobe_item_id} style={styles.miniOutfitThumb}>
                    {io.wardrobe?.image_url ? (
                      <Image source={{ uri: io.wardrobe.image_url }} style={styles.fullImg} />
                    ) : (
                      <Shirt size={10} color={theme.tint} />
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  const renderDayItem = ({ item, drag, isActive }: RenderItemParams<any>) => {
    const isExpanded = expandedDay === item.dayNumber;
    const count = dayCounts[item.dayNumber] || 0;
    
    return (
      <ScaleDecorator>
        <View style={styles.dayWrapper}>
          <TouchableOpacity
            onLongPress={drag}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setExpandedDay(isExpanded ? null : item.dayNumber);
            }}
            disabled={isActive}
            style={[
              styles.dayItem,
              { backgroundColor: isActive ? theme.tint + '20' : isExpanded ? theme.card : 'rgba(0,0,0,0.03)' },
              (isActive || isExpanded) && { borderColor: theme.tint, borderWidth: 1 }
            ]}
          >
            <View style={styles.dragHandle}>
              <GripVertical size={20} color="#aaa" />
            </View>
            
            <View style={styles.content}>
              <View>
                <Text style={styles.dayLabel}>Day {item.dayNumber}</Text>
                <Text style={[styles.dateLabel, { color: theme.text }]}>
                  {item.weekday}, {item.date ? format(item.date, 'dd MMM') : 'TBD'}
                </Text>
              </View>
              
              <View style={styles.rightInfo}>
                {count > 0 && (
                  <View style={[styles.countBadge, { backgroundColor: theme.tint + '15' }]}>
                    <MapPin size={12} color={theme.tint} />
                    <Text style={[styles.countText, { color: theme.tint }]}>{count}</Text>
                  </View>
                )}
                {isExpanded ? <ChevronUp size={20} color="#aaa" /> : <ChevronDown size={20} color="#aaa" />}
              </View>
            </View>
          </TouchableOpacity>

          <AnimatePresence>
            {isExpanded && (
              <MotiView
                from={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                style={styles.expandableContent}
              >
                {loadingItems ? (
                  <ActivityIndicator color={theme.tint} style={{ marginVertical: 20 }} />
                ) : (
                  <>
                    <DraggableFlatList
                      data={dayItems}
                      keyExtractor={(it) => it.id}
                      onDragEnd={({ data }) => handleReorderItems(data)}
                      renderItem={renderItineraryItem}
                      scrollEnabled={false}
                    />
                    
                    <View style={styles.addActionsRow}>
                      <TouchableOpacity style={[styles.addBtn, { borderColor: theme.tint + '40' }]} onPress={handleAddCustomItem}>
                        <Plus size={14} color={theme.tint} />
                        <Text style={[styles.addBtnText, { color: theme.tint }]}>Add Custom Activity</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </MotiView>
            )}
          </AnimatePresence>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <DraggableFlatList
      data={days}
      onDragEnd={({ data }) => onReorder(data)}
      keyExtractor={(item, index) => `day-${item.dayNumber}`}
      renderItem={renderDayItem}
      containerStyle={styles.container}
      contentContainerStyle={styles.listContent}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 150 },
  dayWrapper: { marginBottom: 12 },
  dayItem: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 24 },
  dragHandle: { paddingRight: 15 },
  content: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayLabel: { fontSize: 10, fontWeight: '900', color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  dateLabel: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  rightInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, gap: 4 },
  countText: { fontSize: 12, fontWeight: 'bold' },
  expandableContent: { paddingLeft: 40, paddingTop: 10, paddingBottom: 10 },
  itineraryCard: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 20, marginBottom: 8, borderWidth: 1 },
  itineraryDragHandle: { paddingRight: 10 },
  itineraryContent: { flex: 1 },
  itineraryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itineraryName: { fontSize: 14, fontWeight: '800' },
  catBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.05)', marginTop: 2 },
  catText: { fontSize: 8, fontWeight: '900', color: '#888' },
  timeLabel: { fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  miniOutfitsRow: { flexDirection: 'row', marginTop: 8, gap: 4 },
  miniOutfitThumb: { width: 20, height: 20, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  fullImg: { width: '100%', height: '100%' },
  editSection: { marginTop: 10, gap: 8 },
  timeRow: { flexDirection: 'row' },
  timeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  timeText: { fontSize: 12, fontWeight: 'bold' },
  notesInput: { padding: 10, borderRadius: 12, fontSize: 13, minHeight: 60, textAlignVertical: 'top' },
  customLabelInput: { flex: 1, fontSize: 14, fontWeight: '800', padding: 0 },
  itineraryActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionBtn: { padding: 4 },
  addActionsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 18, borderStyle: 'dashed', borderWidth: 1 },
  addBtnText: { fontSize: 12, fontWeight: '700', marginLeft: 6 }
});
