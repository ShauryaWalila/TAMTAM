import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Dimensions, ActivityIndicator } from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { BlurView } from 'expo-blur';
import { Plus, GripVertical, MapPin, Utensils, Camera, Shirt, Calendar, Trash2 } from 'lucide-react-native';
import { MotiView } from 'moti';

import { MonoText } from '@/components/StyledText';
import { Text as ThemedText } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';

const { width, height } = Dimensions.get('window');

interface TripItem {
  id: string;
  name: string;
  category: string;
  sequence: number;
  notes?: string;
  images?: string[];
}

interface TripPlannerProps {
  onAddPress: () => void;
  onEditItem: (item: any) => void;
}

export default function TripPlanner({ onAddPress, onEditItem }: TripPlannerProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const [items, setItems] = useState<TripItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTripItems();
  }, []);

  const fetchTripItems = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('places')
      .select('*')
      .not('trip_id', 'is', null)
      .order('sequence', { ascending: true });
    
    if (data) setItems(data);
    setIsLoading(false);
  };

  const handleDragEnd = async ({ data }: { data: TripItem[] }) => {
    // 1. Update local state for immediate UI feedback
    const reordered = data.map((item, index) => ({ ...item, sequence: index }));
    setItems(reordered);

    // 2. Persist sequences to Supabase
    try {
      const updates = reordered.map(item => 
        supabase.from('places').update({ sequence: item.sequence }).eq('id', item.id)
      );
      await Promise.all(updates);
    } catch (e) {
      console.error("Failed to save reorder:", e);
    }
  };

    const Icon = item.category === 'eat' ? Utensils : item.category === 'activity' ? Camera : MapPin;
    
    return (
      <ScaleDecorator>
        <TouchableOpacity
          onLongPress={drag}
          onPress={() => onEditItem(item)}
          disabled={isActive}
          style={[
            styles.itemContainer,
            { backgroundColor: isActive ? Colors[colorScheme].tint : 'rgba(255,255,255,0.05)' }
          ]}
        >
          <View style={styles.itemHeader}>
            <View style={styles.dragHandle}>
              <GripVertical size={20} color={Colors[colorScheme].tabIconDefault} />
            </View>
            <View style={[styles.iconContainer, { backgroundColor: Colors[colorScheme].tint + '20' }]}>
              <Icon size={18} color={Colors[colorScheme].tint} />
            </View>
            <View style={styles.itemInfo}>
              <ThemedText style={styles.itemName} numberOfLines={1}>{item.name}</ThemedText>
              <MonoText style={styles.categoryText}>{item.category || 'Visit'}</MonoText>
            </View>
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );

  return (
    <MotiView 
      from={{ translateX: width }}
      animate={{ translateX: 0 }}
      exit={{ translateX: width }}
      style={styles.container}
    >
      <BlurView intensity={90} tint={colorScheme} style={styles.blurContainer}>
        <View style={styles.header}>
          <Calendar size={24} color={Colors[colorScheme].tint} />
          <ThemedText style={styles.title}>Itinerary</ThemedText>
        </View>

        {isLoading ? (
          <ActivityIndicator size="large" color={Colors[colorScheme].tint} style={{ marginTop: 50 }} />
        ) : (
          <DraggableFlatList
            data={items}
            onDragEnd={handleDragEnd}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No activities added yet.</Text>
              </View>
            }
          />
        )}

        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: Colors[colorScheme].tint }]}
          onPress={onAddPress}
        >
          <Plus size={24} color="white" />
          <Text style={styles.addButtonText}>Add Activity</Text>
        </TouchableOpacity>
      </BlurView>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 0,
    top: 100,
    bottom: 0,
    width: width * 0.75,
    zIndex: 1500,
  },
  blurContainer: {
    flex: 1,
    borderTopLeftRadius: 30,
    padding: 20,
    overflow: 'hidden',
    borderLeftWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  listContent: {
    paddingBottom: 100,
  },
  itemContainer: {
    borderRadius: 15,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dragHandle: {
    paddingRight: 10,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
  },
  categoryText: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 2,
  },
  emptyState: {
    marginTop: 50,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
  },
  addButton: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 20,
    elevation: 5,
  },
  addButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 10,
  },
});
