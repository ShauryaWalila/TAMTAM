import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, ActivityIndicator, Alert, TouchableOpacity, Image, DeviceEventEmitter, TextInput, Modal, FlatList } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { format, differenceInDays, differenceInSeconds, startOfDay, addDays, nextDay, set, isAfter, isBefore, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { Heart, MessageSquare, Calendar as CalendarIcon, Bell, Clock, Quote, Sparkles, Trophy, ChevronRight, Plus, X, Trash2, Settings2, CalendarDays, CalendarRange, PenLine, Stars, Timer, ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 📅 ANNIVERSARY DATE
const ANNIVERSARY_DATE = new Date('2024-01-01'); 

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MAP: Record<string, number> = { 'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6 };

export default function DashboardScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>('');
  
  // Data States
  const [motm, setMotm] = useState<string>('Thinking of you...');
  const [nextMeet, setNextMeet] = useState<any>(null);
  const [countdown, setCountdown] = useState<string>('00:00:00');
  const [stats, setStats] = useState({ memories: 0, days: 0 });
  const [timetable, setTimetable] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Calendar States
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Management Modals
  const [isTimeModalVisible, setIsTimeModalVisible] = useState(false);
  const [isCalModalVisible, setIsCalModalVisible] = useState(false);

  useEffect(() => {
    init();
    const motmSub = supabase.channel('dashboard_motm').on('postgres_changes', { event: '*', schema: 'public', table: 'moments' }, () => fetchMOTM()).subscribe();
    const meetSub = supabase.channel('dashboard_meet').on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => fetchNextMeet()).subscribe();
    const timeSub = supabase.channel('dashboard_time').on('postgres_changes', { event: '*', schema: 'public', table: 'timetable' }, () => fetchTimetable()).subscribe();
    const calSub = supabase.channel('dashboard_cal').on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, () => fetchCalendar()).subscribe();
    const postsSub = supabase.channel('dashboard_posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchStats()).subscribe();

    return () => {
      supabase.removeChannel(motmSub);
      supabase.removeChannel(meetSub);
      supabase.removeChannel(timeSub);
      supabase.removeChannel(calSub);
      supabase.removeChannel(postsSub);
    };
  }, []);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setCurrentUserName(name);
    const partner = name?.toLowerCase() === 'pratishth' ? 'love' : 'pratishth';
    setPartnerName(partner);

    await Promise.all([fetchMOTM(partner), fetchNextMeet(), fetchStats(), fetchTimetable(), fetchCalendar()]);
    setLoading(false);
  };

  const fetchMOTM = async (pName?: string) => {
    const target = pName || partnerName;
    const { data } = await supabase.from('moments').select('message').eq('user_id', target?.toLowerCase()).maybeSingle();
    if (data) setMotm(data.message);
  };

  const fetchNextMeet = async () => {
    const { data } = await supabase.from('meetings').select('*').limit(1).maybeSingle();
    if (data) {
      setNextMeet(data);
      updateCountdown(data);
    }
  };

  const parseTime = (timeStr: string) => {
    if (!timeStr) return { h: 0, m: 0 };
    const [t, period] = timeStr.split(' ');
    let [h, m] = t.split(':').map(Number);
    if (period === 'PM' && h < 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return { h, m };
  };

  const updateCountdown = (meet: any) => {
    if (!meet) return;
    const now = new Date();
    let targetDate: Date = new Date();

    const { h, m } = parseTime(meet.time);

    if (meet.type === 'specific' && meet.date) {
      targetDate = set(new Date(meet.date), { hours: h, minutes: m, seconds: 0 });
    } else if (meet.type === 'weekly' && meet.weekday) {
      const targetDay = DAY_MAP[meet.weekday];
      targetDate = nextDay(now, targetDay as any);
      targetDate = set(targetDate, { hours: h, minutes: m, seconds: 0 });
      if (isBefore(targetDate, now)) targetDate = addDays(targetDate, 7);
    } else if (meet.type === 'monthly' && meet.day_of_month) {
      targetDate = set(now, { date: meet.day_of_month, hours: h, minutes: m, seconds: 0 });
      if (isBefore(targetDate, now)) targetDate = addDays(targetDate, 30);
    }

    const diffInSecs = differenceInSeconds(targetDate, now);
    if (diffInSecs <= 0) {
      setCountdown("REUNION! ❤️");
      return;
    }

    const days = Math.floor(diffInSecs / 86400);
    if (days >= 1) {
      setCountdown(`${days} Days Left`);
    } else {
      const hrs = Math.floor(diffInSecs / 3600);
      const mins = Math.floor((diffInSecs % 3600) / 60);
      const secs = diffInSecs % 60;
      setCountdown(`${hrs.toString().padStart(2,'0')}:${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`);
    }
  };

  const fetchStats = async () => {
    const { count } = await supabase.from('posts').select('*', { count: 'exact', head: true });
    const days = differenceInDays(new Date(), ANNIVERSARY_DATE);
    setStats({ memories: count || 0, days });
  };

  const fetchTimetable = async () => {
    const { data } = await supabase.from('timetable').select('*').order('time', { ascending: true });
    if (data) setTimetable(data);
  };

  const fetchCalendar = async () => {
    const { data } = await supabase.from('calendar_events').select('*').order('event_date', { ascending: true });
    if (data) setCalendarEvents(data);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (nextMeet) updateCountdown(nextMeet);
    }, 1000);
    return () => clearInterval(interval);
  }, [nextMeet]);

  const handleScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY <= 0) DeviceEventEmitter.emit('show-navigator');
    else if (currentY > 20) DeviceEventEmitter.emit('hide-navigator');
  };

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const selectedDayEvents = useMemo(() => {
    return calendarEvents.filter(e => isSameDay(new Date(e.event_date), selectedDate));
  }, [calendarEvents, selectedDate]);

  if (loading) {
    return <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={theme.tint} /></ThemedView>;
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView onScroll={handleScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* ✨ HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: theme.text }]}>Us,</Text>
            <Text style={[styles.subGreeting, { color: theme.tabIconDefault }]}>Forever & Always</Text>
          </View>
          <TouchableOpacity onPress={() => DeviceEventEmitter.emit('show-navigator')} style={[styles.profileCircle, { backgroundColor: theme.card }]}>
            <Sparkles color={theme.tint} size={24} />
          </TouchableOpacity>
        </View>

        {/* ⏳ COUNTDOWN */}
        <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={styles.countdownBox}>
          <LinearGradient colors={[theme.tint, theme.secondary]} start={{x:0, y:0}} end={{x:1, y:1}} style={styles.countdownCard}>
            <View style={styles.countdownHead}>
              <Clock color="white" size={16} opacity={0.8} />
              <Text style={styles.countdownLabel}>REUNION COUNTDOWN</Text>
            </View>
            <Text style={styles.countdownValue}>{countdown}</Text>
            {nextMeet?.occasion_name && <Text style={styles.occasionText}>{nextMeet.occasion_name.toUpperCase()}</Text>}
          </LinearGradient>
        </MotiView>

        {/* 💬 MESSAGE OF THE MOMENT */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Quote size={18} color={theme.tint} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Moment for us</Text>
          </View>
          <View style={[styles.motmCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.motmText, { color: theme.text }]}>"{motm}"</Text>
            <View style={styles.motmFooter}>
              <Heart size={14} color={theme.tint} fill={theme.tint} />
              <Text style={[styles.motmAuthor, { color: theme.tabIconDefault }]}>FROM {partnerName.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* 📊 STATS GRID */}
        <View style={styles.statsGrid}>
          <StatCard icon={<Heart size={24} color="#FF2D55" fill="#FF2D55" />} label="Days Together" value={stats.days} color="#FF2D55" theme={theme} />
          <StatCard icon={<MessageSquare size={24} color="#AF52DE" fill="#AF52DE" />} label="Memories" value={stats.memories} color="#AF52DE" theme={theme} />
        </View>

        {/* 📅 OUR ROUTINE */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Clock size={18} color={theme.tint} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Our Routine</Text>
            <TouchableOpacity onPress={() => setIsTimeModalVisible(true)} style={styles.manageBtn}>
              <Settings2 size={18} color={theme.tabIconDefault} />
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timetableScroll}>
            {DAYS_SHORT.map(day => (
              <View key={day} style={[styles.dayCard, { backgroundColor: theme.card }]}>
                <Text style={[styles.dayName, { color: theme.tint }]}>{day.toUpperCase()}</Text>
                <View style={styles.activityList}>
                  {timetable.filter(t => t.day === day).length > 0 ? (
                    timetable.filter(t => t.day === day).map(item => (
                      <View key={item.id} style={styles.activityItem}>
                        <Text style={[styles.activityTime, { color: theme.tabIconDefault }]}>{item.time}</Text>
                        <Text style={[styles.activityTitle, { color: theme.text }]} numberOfLines={1}>{item.activity}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.relaxText, { color: theme.tabIconDefault }]}>Relax ✨</Text>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>

        {/* 🗓️ SHARED CALENDAR */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CalendarIcon size={18} color={theme.tint} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Calendar</Text>
            <TouchableOpacity onPress={() => setIsCalModalVisible(true)} style={styles.manageBtn}>
              <Plus size={20} color={theme.tabIconDefault} />
            </TouchableOpacity>
          </View>
          
          <View style={[styles.calendarContainer, { backgroundColor: theme.card }]}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
              <Text style={[styles.calendarMonth, { color: theme.text }]}>{format(currentMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity onPress={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight size={24} color={theme.text} /></TouchableOpacity>
            </View>

            <View style={styles.weekDays}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={[styles.weekDayText, { color: theme.tabIconDefault }]}>{d}</Text>)}
            </View>

            <View style={styles.calendarGrid}>
              {calendarDays.map((day, i) => {
                const isSelected = isSameDay(day, selectedDate);
                const isCurrentMonth = day.getMonth() === currentMonth.getMonth();
                const hasEvent = calendarEvents.some(e => isSameDay(new Date(e.event_date), day));
                return (
                  <TouchableOpacity key={i} onPress={() => setSelectedDate(day)} style={[styles.dayCell, isSelected && { backgroundColor: theme.tint, borderRadius: 12 }]}>
                    <Text style={[styles.dayText, { color: isSelected ? 'white' : isCurrentMonth ? theme.text : theme.tabIconDefault + '40' }]}>{format(day, 'd')}</Text>
                    {hasEvent && <View style={[styles.eventDot, { backgroundColor: isSelected ? 'white' : theme.tint }]} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.selectedDayInfo}>
              <Text style={[styles.selectedDateText, { color: theme.text }]}>{format(selectedDate, 'EEEE, MMM do')}</Text>
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map(event => (
                  <View key={event.id} style={styles.dayEventItem}>
                    <View style={[styles.dot, { backgroundColor: theme.tint }]} />
                    <Text style={[styles.dayEventTitle, { color: theme.text }]}>{event.title}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.relaxText, { color: theme.tabIconDefault, marginLeft: 0 }]}>No plans for this day ✨</Text>
              )}
            </View>
          </View>
        </View>

      </ScrollView>

      {/* Routine Manager Modal */}
      <ManageModal visible={isTimeModalVisible} title="Our Routine" data={timetable} table="timetable" onClose={() => setIsTimeModalVisible(false)} theme={theme} colorScheme={colorScheme} fields={[{key: 'day', placeholder: 'Day (Mon, Tue...)'}, {key: 'time', placeholder: 'Time (09:00 AM)'}, {key: 'activity', placeholder: 'Activity'}]} />
      
      {/* Calendar Manager Modal */}
      <ManageModal visible={isCalModalVisible} title="Shared Calendar" data={calendarEvents} table="calendar_events" onClose={() => setIsCalModalVisible(false)} theme={theme} colorScheme={colorScheme} fields={[{key: 'title', placeholder: 'Event Title'}, {key: 'event_date', placeholder: 'Date (YYYY-MM-DD)'}]} />

    </ThemedView>
  );
}

function StatCard({ icon, label, value, color, theme }: any) {
  return (
    <View style={[styles.statCard, { backgroundColor: theme.card }]}>
      <View style={[styles.statIconBox, { backgroundColor: color + '15' }]}>{icon}</View>
      <Text style={[styles.statNum, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.tabIconDefault }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

function ManageModal({ visible, title, data, table, onClose, theme, fields, colorScheme }: any) {
  const [inputs, setFields] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (Object.keys(inputs).length < fields.length) return;
    setLoading(true);
    const { error } = await supabase.from(table).insert([{ ...inputs, user_id: 'shared' }]);
    if (!error) { setFields({}); Alert.alert('Success', 'Added! ❤️'); }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete?', 'Remove this?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => await supabase.from(table).delete().eq('id', id) }]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
          <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{title}</Text><TouchableOpacity onPress={onClose}><X size={24} color={theme.text} /></TouchableOpacity></View>
          <View style={styles.modalForm}>
            {fields.map((f: any) => (<TextInput key={f.key} style={[styles.modalInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.tint + '20' }]} placeholder={f.placeholder} placeholderTextColor={theme.tabIconDefault} value={inputs[f.key]} onChangeText={(v) => setFields({...inputs, [f.key]: v})} />))}
            <TouchableOpacity onPress={handleAdd} disabled={loading} style={[styles.addBtn, { backgroundColor: theme.tint }]}>{loading ? <ActivityIndicator color="white" /> : <><Plus size={20} color="white" /><Text style={styles.addBtnText}>Add Entry</Text></>}</TouchableOpacity>
          </View>
          <FlatList data={data} keyExtractor={i => i.id} renderItem={({item}) => (
            <View style={[styles.manageItem, { borderBottomColor: theme.tabIconDefault + '15' }]}><View style={{flex: 1}}><Text style={[styles.manageTitle, {color: theme.text}]}>{item.title || item.activity}</Text><Text style={[styles.manageSub, {color: theme.tabIconDefault}]}>{item.day || item.event_date} {item.time ? `• ${item.time}` : ''}</Text></View><TouchableOpacity onPress={() => handleDelete(item.id)}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity></View>
          )} />
        </BlurView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 120 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  greeting: { fontSize: 48, fontWeight: '900', letterSpacing: -2.5 },
  subGreeting: { fontSize: 20, fontWeight: '600', marginTop: -8 },
  profileCircle: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  countdownBox: { marginBottom: 30, borderRadius: 32, overflow: 'hidden', elevation: 12 },
  countdownCard: { padding: 25 },
  countdownHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  countdownLabel: { color: 'white', fontSize: 13, fontWeight: '900', letterSpacing: 2, opacity: 0.9 },
  countdownValue: { color: 'white', fontSize: 56, fontWeight: '900', letterSpacing: -2.5 },
  occasionText: { color: 'white', fontSize: 15, fontWeight: '800', marginTop: 5, letterSpacing: 1, opacity: 0.8 },
  section: { marginBottom: 35 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingLeft: 5 },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  manageBtn: { marginLeft: 'auto', padding: 8, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  motmCard: { borderRadius: 32, padding: 28, elevation: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 15 },
  motmText: { fontSize: 22, fontWeight: '600', lineHeight: 32, fontStyle: 'italic' },
  motmFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 20 },
  motmAuthor: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  statsGrid: { flexDirection: 'row', gap: 15, marginBottom: 35 },
  statCard: { flex: 1, borderRadius: 30, padding: 22, elevation: 3 },
  statIconBox: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  statNum: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  statLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 4 },
  timetableScroll: { gap: 15, paddingRight: 20 },
  dayCard: { width: 170, borderRadius: 28, padding: 20, minHeight: 150 },
  dayName: { fontSize: 14, fontWeight: '900', letterSpacing: 2, marginBottom: 18 },
  activityList: { gap: 14 },
  activityItem: { },
  activityTime: { fontSize: 10, fontWeight: '900', marginBottom: 2 },
  activityTitle: { fontSize: 16, fontWeight: '600' },
  relaxText: { fontSize: 14, fontWeight: '600', fontStyle: 'italic', marginLeft: 5 },
  calendarContainer: { borderRadius: 32, padding: 20, elevation: 3 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calendarMonth: { fontSize: 18, fontWeight: '800' },
  weekDays: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  weekDayText: { fontSize: 12, fontWeight: '900' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around' },
  dayCell: { width: (SCREEN_WIDTH - 80) / 7, height: 45, justifyContent: 'center', alignItems: 'center', marginBottom: 5 },
  dayText: { fontSize: 15, fontWeight: '700' },
  eventDot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 8 },
  selectedDayInfo: { marginTop: 25, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 20 },
  selectedDateText: { fontSize: 16, fontWeight: '800', marginBottom: 15 },
  dayEventItem: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dayEventTitle: { fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '85%', borderTopLeftRadius: 35, borderTopRightRadius: 35, padding: 25, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  modalForm: { gap: 12, marginBottom: 30 },
  modalInput: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '600', borderWidth: 1 },
  addBtn: { height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10 },
  addBtnText: { color: 'white', fontWeight: '900', fontSize: 17 },
  manageItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1 },
  manageTitle: { fontSize: 17, fontWeight: '700' },
  manageSub: { fontSize: 13, fontWeight: '600', marginTop: 4 }
});
