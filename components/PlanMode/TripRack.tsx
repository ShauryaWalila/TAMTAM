import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Trash2, Package, Shirt, ChevronRight, X } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

interface TripRackProps {
  tripId: string;
  userId: string;
}

export default function TripRack({ tripId, userId }: TripRackProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  
  const [hangedItems, setHangedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHangedItems();

    // Enable Realtime for the rack
    const channel = supabase
      .channel('trip_wardrobe_changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'trip_wardrobe',
        filter: `trip_id=eq.${tripId}`
      }, () => {
        fetchHangedItems();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tripId]);

  const fetchHangedItems = async () => {
    try {
      const { data, error } = await supabase
        .from('trip_wardrobe')
        .select(`
          id,
          user_id,
          wardrobe_item_id,
          wardrobe (
            name,
            category
          )
        `)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setHangedItems(data || []);
    } catch (e) {
      console.error('Rack fetch failed');
    } finally {
      setLoading(false);
    }
  };

  const removeHangedItem = async (id: string) => {
    const { error } = await supabase.from('trip_wardrobe').delete().eq('id', id);
    if (error) Alert.alert('Error', 'Could not remove item.');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Text style={styles.title}>TRIP RACK</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>{hangedItems.length}</Text></View>
      </View>

      {loading ? (
        <ActivityIndicator color={theme.tint} style={{ marginTop: 40 }} />
      ) : hangedItems.length === 0 ? (
        <View style={styles.empty}>
          <Package size={32} color="#ccc" />
          <Text style={styles.emptyText}>Empty Rack</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          <AnimatePresence>
            {hangedItems.map((item, index) => (
              <MotiView 
                key={item.id}
                from={{ opacity: 0, translateX: 50 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', delay: index * 50 }}
                style={styles.rackItem}
              >
                <View style={[styles.itemIcon, { backgroundColor: item.user_id === userId ? theme.tint + '20' : '#F2F2F7' }]}>
                  <Shirt size={16} color={item.user_id === userId ? theme.tint : '#888'} />
                </View>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.wardrobe?.name}</Text>
                  <Text style={styles.itemUser}>{item.user_id === userId ? 'You' : 'Partner'}</Text>
                </View>
                {item.user_id === userId && (
                  <TouchableOpacity onPress={() => removeHangedItem(item.id)} style={styles.removeBtn}>
                    <X size={14} color="#FF4B4B" />
                  </TouchableOpacity>
                )}
              </MotiView>
            ))}
          </AnimatePresence>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(0,0,0,0.05)', padding: 15 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#888' },
  badge: { backgroundColor: '#000', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  list: { paddingBottom: 20 },
  rackItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: '#fff', padding: 10, borderRadius: 12, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  itemIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1, marginLeft: 10 },
  itemName: { fontSize: 12, fontWeight: '700' },
  itemUser: { fontSize: 9, color: '#aaa', textTransform: 'uppercase' },
  removeBtn: { padding: 5 },
  empty: { marginTop: 40, alignItems: 'center', opacity: 0.5 },
  emptyText: { fontSize: 10, fontWeight: 'bold', marginTop: 8, color: '#888' }
});