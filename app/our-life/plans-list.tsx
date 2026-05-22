import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, TextInput, Dimensions, Modal, ActivityIndicator, Alert } from 'react-native';
import { Search, Plus, Calendar, MapPin, ChevronRight, Clock, X, Save, Globe, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { format } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { View as ThemedView, Text as ThemedText } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { supabase } from '@/lib/supabase';
import SmartLocationPicker from '@/components/Map/SmartLocationPicker';

const { width, height } = Dimensions.get('window');

interface PlansListProps {
  onSelectTrip: (id: string) => void;
  onClose: () => void;
}

export default function PlansListScreen({ onSelectTrip, onClose }: PlansListProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const [plans, setPlans] = useState<any[]>([]);
  const [filteredPlans, setFilteredPlans] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newCoords, setNewCoords] = useState<{lat: number, lng: number} | null>(null);
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(addDays(new Date(), 3));
  const [isSaving, setIsSaving] = useState(false);
  
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  useEffect(() => { fetchPlans(); }, []);

  const fetchPlans = async () => {
    setIsLoading(true);
    const { data } = await supabase.from('trips').select('*').order('created_at', { ascending: false });
    if (data) { setPlans(data); setFilteredPlans(data); }
    setIsLoading(false);
  };

  const handleCreatePlan = async () => {
    if (!newTitle || !newCoords) {
      Alert.alert("Missing Info", "Please provide a trip name and pin the location on the map.");
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.from('trips').insert([{ 
        title: newTitle, 
        location_name: newLocation || 'Unknown Destination',
        latitude: newCoords.lat,
        longitude: newCoords.lng,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: 'planned' 
      }]).select().single();
      
      if (error) throw error;

      if (data) {
        setIsAddModalVisible(false);
        setNewTitle('');
        setNewLocation('');
        setNewCoords(null);
        fetchPlans();
        onSelectTrip(data.id);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save the plan.");
    } finally {
      setIsSaving(false);
    }
  };

  function addDays(date: Date, days: number) {
    var result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  const handleLongPressPlan = (item: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    Alert.alert(
      `Delete "${item.title}"?`,
      'This will permanently remove the plan and all its bucket items, days, songs, etc.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('trips').delete().eq('id', item.id);
              if (error) {
                Alert.alert('Could not delete', error.message);
                return;
              }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              fetchPlans();
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message || 'Unknown error');
            }
          },
        },
      ]
    );
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerBtn}><X size={24} color={Colors[colorScheme].text} /></TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Our Plans</ThemedText>
        <TouchableOpacity style={[styles.headerBtn, styles.addBtn, { backgroundColor: Colors[colorScheme].tint }]} onPress={() => setIsAddModalVisible(true)}>
          <Plus size={20} color="white" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredPlans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.planCard, { backgroundColor: Colors[colorScheme].card }]}
            onPress={() => onSelectTrip(item.id)}
            onLongPress={() => handleLongPressPlan(item)}
            delayLongPress={400}
            activeOpacity={0.7}
          >
            <View style={styles.cardInfo}>
              <ThemedText style={styles.planTitle}>{item.title}</ThemedText>
              <View style={styles.infoRow}>
                <MapPin size={12} color={Colors[colorScheme].tint} />
                <Text style={[styles.infoText, { color: Colors[colorScheme].text }]}>{item.location_name || 'Destination TBD'}</Text>
              </View>
            </View>
            <ChevronRight size={20} color={Colors[colorScheme].tabIconDefault} />
          </TouchableOpacity>
        )}
      />

      <Modal visible={isAddModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: Colors[colorScheme].text }]}>New Adventure</Text>
              <TouchableOpacity onPress={() => setIsAddModalVisible(false)}><X size={24} color={Colors[colorScheme].text} /></TouchableOpacity>
            </View>
            
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Plan Name</Text>
              <TextInput style={[styles.input, { color: Colors[colorScheme].text, borderColor: '#eee' }]} placeholder="e.g. Dream Trip" value={newTitle} onChangeText={setNewTitle} />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Destination</Text>
              <TextInput style={[styles.input, { color: Colors[colorScheme].text, borderColor: '#eee' }]} placeholder="Find on map or type here" value={newLocation} onChangeText={setNewLocation} />
            </View>
            
            <TouchableOpacity 
              style={[styles.locationPickerBtn, newCoords && { borderColor: Colors[colorScheme].tint, backgroundColor: Colors[colorScheme].tint + '10' }]} 
              onPress={() => setShowLocationPicker(true)}
            >
              <Globe size={20} color={newCoords ? Colors[colorScheme].tint : '#888'} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.locationPickerText, newCoords && { color: Colors[colorScheme].tint, fontWeight: 'bold' }]}>
                  {newCoords ? "Location Captured ✓" : "Find Destination on Map"}
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.dateRow}>
              <TouchableOpacity style={styles.datePicker} onPress={() => setShowStartPicker(true)}>
                <Text style={styles.label}>Starts</Text>
                <Text style={[styles.dateVal, { color: Colors[colorScheme].text }]}>{format(startDate, 'dd/MM/yy')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.datePicker} onPress={() => setShowEndPicker(true)}>
                <Text style={styles.label}>Ends</Text>
                <Text style={[styles.dateVal, { color: Colors[colorScheme].text }]}>{format(endDate, 'dd/MM/yy')}</Text>
              </TouchableOpacity>
            </View>

            {showStartPicker && <DateTimePicker value={startDate} mode="date" onChange={(e, d) => { setShowStartPicker(false); if(d) setStartDate(d); }} />}
            {showEndPicker && <DateTimePicker value={endDate} mode="date" onChange={(e, d) => { setShowEndPicker(false); if(d) setEndDate(d); }} />}

            <TouchableOpacity 
              style={[styles.saveBtn, { backgroundColor: Colors[colorScheme].tint }, (!newTitle || !newCoords) && { opacity: 0.5 }]} 
              onPress={handleCreatePlan}
              disabled={isSaving || !newTitle || !newCoords}
            >
              {isSaving ? <ActivityIndicator color="white" /> : <Text style={styles.saveBtnText}>Create Plan</Text>}
            </TouchableOpacity>
          </BlurView>
        </View>

        {/* SMART MAP CAPTURE */}
        <Modal visible={showLocationPicker} animationType="slide">
          <SmartLocationPicker 
            title="Pin Your Destination"
            onLocationCaptured={(data) => {
              setNewCoords({ lat: data.lat, lng: data.lng });
              setNewLocation(data.name);
            }}
            onClose={() => setShowLocationPicker(false)}
          />
        </Modal>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 15, paddingTop: 10 },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  headerBtn: { padding: 8 },
  addBtn: { borderRadius: 12, paddingHorizontal: 12 },
  listContent: { paddingHorizontal: 20 },
  planCard: { flexDirection: 'row', alignItems: 'center', padding: 15, borderRadius: 15, marginBottom: 10, elevation: 1 },
  cardInfo: { flex: 1 },
  planTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  infoText: { fontSize: 12, marginLeft: 5, opacity: 0.6 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { padding: 25, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', height: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  fieldLabel: { fontSize: 12, fontWeight: 'bold', color: '#888', marginBottom: 5, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: 12, padding: 15, fontSize: 16, marginBottom: 10 },
  locationPickerBtn: { flexDirection: 'row', alignItems: 'center', padding: 15, borderWidth: 1, borderColor: '#eee', borderRadius: 12, marginTop: 5 },
  locationPickerText: { color: '#888', fontSize: 14 },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  datePicker: { flex: 0.48, padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)' },
  label: { fontSize: 10, color: '#888', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 4 },
  dateVal: { fontSize: 16, fontWeight: 'bold' },
  saveBtn: { marginTop: 30, padding: 18, borderRadius: 15, alignItems: 'center' },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});
