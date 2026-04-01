import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MapPin, Utensils, Camera, Landmark, Plus, Clock, ChevronRight } from 'lucide-react-native';
import { MotiView } from 'moti';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

interface DayTimelineProps {
  tripId: string;
  day: any;
  onAddPress: () => void;
}

const IconMap: any = { eat: Utensils, activity: Camera, visit: Landmark, hotel: MapPin };

export default function DayTimeline({ tripId, day, onAddPress }: DayTimelineProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDayItems();
  }, [tripId, day]);

  const fetchDayItems = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('trip_id', tripId)
      .eq('day_number', day.dayNumber)
      .order('sequence', { ascending: true });
    
    if (data) setItems(data);
    setLoading(false);
  };

  if (loading) return <ActivityIndicator color={theme.tint} style={{ marginTop: 40 }} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.container}>
      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Clock size={48} color="#ccc" opacity={0.5} />
          <Text style={styles.emptyText}>Nothing planned for Day {day.dayNumber}</Text>
          <TouchableOpacity onPress={onAddPress} style={[styles.addInline, { borderColor: theme.tint }]}>
            <Plus size={16} color={theme.tint} />
            <Text style={{ color: theme.tint, fontWeight: 'bold', marginLeft: 5 }}>Add from Bucket</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.timeline}>
          {items.map((item, index) => {
            const Icon = IconMap[item.category] || MapPin;
            return (
              <View key={item.id} style={styles.timelineItem}>
                <View style={styles.lineIndicator}>
                  <View style={[styles.dot, { backgroundColor: theme.tint }]} />
                  {index !== items.length - 1 && <View style={styles.line} />}
                </View>
                
                <MotiView 
                  from={{ opacity: 0, translateX: -10 }} 
                  animate={{ opacity: 1, translateX: 0 }} 
                  transition={{ delay: index * 100 }}
                  style={[styles.itemCard, { backgroundColor: 'rgba(0,0,0,0.03)' }]}
                >
                  <View style={[styles.iconBox, { backgroundColor: theme.tint + '15' }]}>
                    <Icon size={18} color={theme.tint} />
                  </View>
                  <View style={styles.info}>
                    <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.timeLabel}>Planned for {day.weekday}</Text>
                  </View>
                  <ChevronRight size={18} color="#ccc" />
                </MotiView>
              </View>
            );
          })}
          
          <TouchableOpacity onPress={onAddPress} style={styles.addMoreBtn}>
            <View style={styles.lineIndicator}>
              <View style={[styles.dot, { backgroundColor: '#ccc' }]} />
            </View>
            <Text style={styles.addMoreText}>+ Add more from bucket</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 50,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    marginTop: 15,
    color: '#888',
    fontWeight: '600',
  },
  addInline: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  timeline: {
    marginTop: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    minHeight: 80,
  },
  lineIndicator: {
    width: 30,
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    zIndex: 2,
    marginTop: 20,
  },
  line: {
    position: 'absolute',
    top: 30,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  itemCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 20,
    marginBottom: 15,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    marginLeft: 15,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
  timeLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  addMoreText: {
    marginLeft: 10,
    color: '#888',
    fontWeight: '600',
    fontSize: 14,
  }
});
