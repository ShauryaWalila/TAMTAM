import React, { useState, useEffect } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, ActivityIndicator, Alert, TouchableOpacity, TextInput } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView, AnimatePresence } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Calendar, Clock, ChevronDown, Save, Repeat, Star, X, CalendarDays, CalendarRange } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { format, getDaysInMonth, set } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const DAYS_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = [new Date().getFullYear().toString(), (new Date().getFullYear() + 1).toString()];

const FREQUENCIES = [
  { id: 'once', label: 'Once', icon: '✨' },
  { id: 'weekly', label: 'Weekly', icon: '📅' },
  { id: 'biweekly', label: 'Bi-weekly', icon: '⏳' },
  { id: 'monthly', label: 'Monthly', icon: '🌙' },
];

export default function NextMeetScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [type, setType] = useState<'specific' | 'weekly' | 'monthly'>('specific');
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedWeekday, setSelectedWeekday] = useState(DAYS_FULL[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]);
  const [selectedDayOfMonth, setSelectedDayOfMonth] = useState(new Date().getDate().toString());
  const [meetingTime, setMeetingTime] = useState('06:00 PM');
  const [occasionName, setOccasionName] = useState('');
  const [frequency, setFrequency] = useState('once');
  
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [meetingId, setMeetingId] = useState<string | null>(null);

  // Time Picker States
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [selHour, setSelHour] = useState('06');
  const [selMin, setSelMin] = useState('00');
  const [selPeriod, setSelPeriod] = useState('PM');

  // Date Picker States
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selDay, setSelDay] = useState(new Date().getDate().toString().padStart(2, '0'));
  const [selMonth, setSelMonth] = useState(MONTHS[new Date().getMonth()]);
  const [selYear, setSelYear] = useState(new Date().getFullYear().toString());

  useEffect(() => {
    const init = async () => {
      const name = await SecureStore.getItemAsync('user_name');
      setCurrentUserName(name);
      fetchCurrentMeeting();
    };
    init();
  }, []);

  const fetchCurrentMeeting = async () => {
    try {
      // 1. Try local first
      const local = db.getFirstSync(`SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1`) as any;
      if (local) {
        applyMeetingData(local);
      }

      // 2. Background remote fetch
      const { data } = await supabase.from('meetings').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (data) {
        applyMeetingData(data);
        // Cache it
        db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, recurring_type, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [data.id, data.created_at, data.type, data.date, data.recurring_type, data.occasion_name, data.user_id, data.weekday, data.day_of_month, data.time, data.is_recurring ? 1 : 0, data.frequency]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFetching(false);
    }
  };

  const applyMeetingData = (data: any) => {
    setMeetingId(data.id);
    setType(data.type as any || 'specific');
    if (data.date) {
      setSelectedDate(data.date);
      const d = new Date(data.date);
      setSelDay(d.getDate().toString().padStart(2, '0'));
      setSelMonth(MONTHS[d.getMonth()]);
      setSelYear(d.getFullYear().toString());
    }
    setSelectedWeekday(data.weekday || 'Friday');
    setSelectedDayOfMonth(data.day_of_month?.toString() || '15');
    setMeetingTime(data.time || '06:00 PM');
    setOccasionName(data.occasion_name || '');
    const isRec = typeof data.is_recurring === 'boolean' ? data.is_recurring : data.is_recurring === 1;
    setFrequency(data.frequency || (isRec ? 'weekly' : 'once'));
  };

  const handleSave = async () => {
    if (!currentUserName) return;
    setLoading(true);
    const id = meetingId || generateUUID();
    const payload: any = {
      id,
      type,
      date: type === 'specific' ? selectedDate : null,
      weekday: type === 'weekly' ? selectedWeekday : null,
      day_of_month: type === 'monthly' ? parseInt(selectedDayOfMonth) : null,
      time: meetingTime,
      occasion_name: occasionName,
      frequency,
      is_recurring: frequency !== 'once',
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString()
    };

    try {
      // 1. Save local
      db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.created_at, payload.type, payload.date, payload.occasion_name, payload.user_id, payload.weekday, payload.day_of_month, payload.time, payload.is_recurring ? 1 : 0, payload.frequency]);
      
      // 2. Queue sync
      queueSyncOperation('meetings', payload.id, 'UPDATE', payload);

      Alert.alert('Success ❤️', 'Your next meeting is set!', [{ text: 'Awesome', onPress: () => router.back() }]);
    } catch (error: any) {
      console.warn('Meeting save error', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmTime = () => {
    setMeetingTime(`${selHour}:${selMin} ${selPeriod}`);
    setShowTimePicker(false);
  };

  const confirmDate = () => {
    const monthIdx = MONTHS.indexOf(selMonth);
    const dateStr = `${selYear}-${(monthIdx + 1).toString().padStart(2, '0')}-${selDay.padStart(2, '0')}`;
    setSelectedDate(dateStr);
    setShowDatePicker(false);
  };

  if (fetching) {
    return <ThemedView style={styles.container}><ActivityIndicator size="large" color={theme.tint} /></ThemedView>;
  }

  return (
    <ThemedView style={{ flex: 1, paddingTop: insets.top }}>
      <TouchableOpacity 
        onPress={() => router.back()} 
        style={[styles.closeButton, { backgroundColor: theme.card }]}
      >
        <X color={theme.text} size={24} />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text }]}>Next Reunion</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Design your next shared moment</Text>
        </View>

        <View style={[styles.typeSelector, { backgroundColor: theme.card }]}>
          <TouchableOpacity onPress={() => setType('specific')} style={[styles.typeBtn, type === 'specific' && { backgroundColor: theme.tint }]}>
            <Calendar color={type === 'specific' ? '#FFF' : theme.tabIconDefault} size={18} />
            <Text style={[styles.typeText, { color: type === 'specific' ? '#FFF' : theme.tabIconDefault }]}>Date</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setType('weekly')} style={[styles.typeBtn, type === 'weekly' && { backgroundColor: theme.tint }]}>
            <CalendarDays color={type === 'weekly' ? '#FFF' : theme.tabIconDefault} size={18} />
            <Text style={[styles.typeText, { color: type === 'weekly' ? '#FFF' : theme.tabIconDefault }]}>Weekly</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setType('monthly')} style={[styles.typeBtn, type === 'monthly' && { backgroundColor: theme.tint }]}>
            <CalendarRange color={type === 'monthly' ? '#FFF' : theme.tabIconDefault} size={18} />
            <Text style={[styles.typeText, { color: type === 'monthly' ? '#FFF' : theme.tabIconDefault }]}>Monthly</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formContainer}>
          <AnimatePresence mode="wait">
            {type === 'specific' && (
              <MotiView key="specific" from={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} style={styles.typeForm}>
                <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.triggerField, { backgroundColor: theme.card }]}>
                  <View>
                    <Text style={[styles.label, { color: theme.tabIconDefault }]}>CHOOSE DATE</Text>
                    <Text style={[styles.triggerValue, { color: theme.text }]}>{format(new Date(selectedDate), 'MMMM do, yyyy')}</Text>
                  </View>
                  <Calendar color={theme.tint} size={24} />
                </TouchableOpacity>
              </MotiView>
            )}

            {type === 'weekly' && (
              <MotiView key="weekly" from={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} style={styles.typeForm}>
                <View style={[styles.inputGroup, { backgroundColor: theme.card }]}>
                  <Text style={[styles.label, { color: theme.tabIconDefault }]}>DAY OF THE WEEK</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
                    {DAYS_FULL.map(d => (
                      <TouchableOpacity key={d} onPress={() => setSelectedWeekday(d)} style={[styles.dayPill, { backgroundColor: theme.background }, selectedWeekday === d && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.dayPillText, { color: theme.text }, selectedWeekday === d && { color: '#FFF' }]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </MotiView>
            )}

            {type === 'monthly' && (
              <MotiView key="monthly" from={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} style={styles.typeForm}>
                <View style={[styles.inputGroup, { backgroundColor: theme.card }]}>
                  <Text style={[styles.label, { color: theme.tabIconDefault }]}>DAY OF THE MONTH</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
                    {Array.from({ length: 31 }, (_, i) => (i + 1).toString()).map(d => (
                      <TouchableOpacity key={d} onPress={() => setSelectedDayOfMonth(d)} style={[styles.dayPill, { backgroundColor: theme.background, minWidth: 44, alignItems: 'center' }, selectedDayOfMonth === d && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.dayPillText, { color: theme.text }, selectedDayOfMonth === d && { color: '#FFF' }]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              </MotiView>
            )}
          </AnimatePresence>

          <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: 100 }}>
            <TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.triggerField, { backgroundColor: theme.card, marginTop: 16 }]}>
              <View>
                <Text style={[styles.label, { color: theme.tabIconDefault }]}>MEETING TIME</Text>
                <Text style={[styles.triggerValue, { color: theme.text }]}>{meetingTime}</Text>
              </View>
              <Clock color={theme.tint} size={24} />
            </TouchableOpacity>

            <View style={[styles.inputGroup, { backgroundColor: theme.card, marginTop: 16 }]}>
              <Text style={[styles.label, { color: theme.tabIconDefault }]}>OCCASION (OPTIONAL)</Text>
              <TextInput style={[styles.input, { color: theme.text }]} placeholder="e.g. Our Anniversary" placeholderTextColor={theme.tabIconDefault + '80'} value={occasionName} onChangeText={setOccasionName} />
            </View>

            <View style={[styles.inputGroup, { backgroundColor: theme.card, marginTop: 16 }]}>
              <Text style={[styles.label, { color: theme.tabIconDefault }]}>FREQUENCY</Text>
              <View style={styles.freqRow}>
                {FREQUENCIES.map(f => (
                  <TouchableOpacity key={f.id} onPress={() => setFrequency(f.id)} style={[styles.freqBtn, { backgroundColor: theme.background }, frequency === f.id && { backgroundColor: theme.tint }]}>
                    <Text style={styles.freqIcon}>{f.icon}</Text>
                    <Text style={[styles.freqLabel, { color: theme.text }, frequency === f.id && { color: '#FFF' }]}>{f.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </MotiView>
        </View>

        <TouchableOpacity onPress={handleSave} disabled={loading} style={[styles.saveBtn, { backgroundColor: theme.tint, opacity: loading ? 0.7 : 1 }]}>
          {loading ? <ActivityIndicator color="#FFF" /> : <><Save size={20} color="#FFF" /><Text style={styles.saveBtnText}>Save Reunion</Text></>}
        </TouchableOpacity>
      </ScrollView>

      {/* Shared Picker Overlay Logic */}
      <AnimatePresence>
        {(showTimePicker || showDatePicker) && (
          <MotiView key="pickerOverlay" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.pickerBox, { backgroundColor: theme.card }]}>
                <Text style={[styles.pickerTitle, { color: theme.text }]}>{showTimePicker ? 'Select Time' : 'Select Date'}</Text>
                <View style={styles.pickerWheelRow}>
                  {showTimePicker ? (
                    <>
                      <Wheel data={HOURS} selected={selHour} onSelect={setSelHour} theme={theme} />
                      <Text style={{ fontSize: 24, fontWeight: '800', color: theme.text }}>:</Text>
                      <Wheel data={MINUTES} selected={selMin} onSelect={setSelMin} theme={theme} />
                      <Wheel data={PERIODS} selected={selPeriod} onSelect={setSelPeriod} theme={theme} />
                    </>
                  ) : (
                    <>
                      <Wheel data={Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'))} selected={selDay} onSelect={setSelDay} theme={theme} />
                      <Wheel data={MONTHS} selected={selMonth} onSelect={setSelMonth} theme={theme} />
                      <Wheel data={YEARS} selected={selYear} onSelect={setSelYear} theme={theme} />
                    </>
                  )}
                </View>
                <View style={styles.pickerActions}>
                  <TouchableOpacity onPress={() => { setShowTimePicker(false); setShowDatePicker(false); }} style={styles.cancelBtn}><Text style={[styles.cancelText, { color: theme.tabIconDefault }]}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={showTimePicker ? confirmTime : confirmDate} style={[styles.confirmBtn, { backgroundColor: theme.tint }]}><Text style={styles.confirmText}>Set {showTimePicker ? 'Time' : 'Date'}</Text></TouchableOpacity>
                </View>
              </MotiView>
            </View>
          </MotiView>
        )}
      </AnimatePresence>
    </ThemedView>
  );
}

function Wheel({ data, selected, onSelect, theme }: any) {
  return (
    <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
      {data.map((item: string) => (
        <TouchableOpacity key={item} onPress={() => onSelect(item)} style={[styles.wheelItem, selected === item && { backgroundColor: theme.tint + '20', borderRadius: 10 }]}>
          <Text style={[styles.wheelText, { color: selected === item ? theme.tint : theme.text }]}>{item}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, paddingBottom: 60 },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, marginTop: 4, fontWeight: '500' },
  typeSelector: { flexDirection: 'row', padding: 6, borderRadius: 16, marginBottom: 24 },
  typeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, gap: 6 },
  typeText: { fontSize: 13, fontWeight: '800' },
  formContainer: { minHeight: 400 },
  typeForm: { gap: 16 },
  inputGroup: { padding: 16, borderRadius: 20, gap: 8 },
  triggerField: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20 },
  triggerValue: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  label: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  input: { fontSize: 18, fontWeight: '700', padding: 0 },
  dayPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, marginRight: 8 },
  dayPillText: { fontSize: 14, fontWeight: '700' },
  freqRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  freqBtn: { flex: 1, minWidth: '45%', paddingVertical: 12, borderRadius: 12, alignItems: 'center', gap: 4 },
  freqIcon: { fontSize: 18 },
  freqLabel: { fontSize: 13, fontWeight: '700' },
  saveBtn: { height: 62, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  saveBtnText: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pickerBox: { width: SCREEN_WIDTH * 0.9, padding: 24, borderRadius: 32, alignItems: 'center', gap: 20 },
  pickerTitle: { fontSize: 20, fontWeight: '800' },
  pickerWheelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 180 },
  wheel: { width: 70 },
  wheelItem: { paddingVertical: 12, alignItems: 'center' },
  wheelText: { fontSize: 18, fontWeight: '700' },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  cancelBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  cancelText: { fontWeight: '700' },
  confirmBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  confirmText: { color: '#FFF', fontWeight: '800' },
  closeButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
