import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, Modal, TextInput, ActivityIndicator, Alert, TouchableOpacity, Image, DeviceEventEmitter, Platform } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView, AnimatePresence } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Heart, Calendar, MessageCircle, MapPin, ChevronRight, ChevronLeft, Sparkles, MessageSquareHeart, Clock, Plus, X, Trash2, Settings2, ChevronDown, CalendarDays, CalendarRange, Utensils, Compass, Navigation } from 'lucide-react-native';
import * as Location from 'expo-location';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, withRepeat, withSequence, Easing } from 'react-native-reanimated';
import { recordOwnLocation, getPartnerLocation, bearingDeg, distanceMeters, formatDistance, ago } from '@/lib/partnerLocation';
import { 
  differenceInSeconds, format, isAfter, isBefore, addWeeks, addMonths, subMonths, set, setDay, 
  startOfDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, 
  isSameMonth, isSameDay, addYears, differenceInYears, differenceInDays, addDays 
} from 'date-fns';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID, isTombstoned } from '@/lib/db';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import LottieView from 'lottie-react-native';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { syncAllNotifications } from '@/lib/notifications';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 📅 RELATIONSHIP START DATE
const ANNIVERSARY_DATE = new Date(2023, 10, 10); // Nov 10, 2023

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MAP: Record<string, number> = {
  'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6
};

const FREQUENCIES = [
  { id: 'once', label: 'Once', icon: '✨' },
  { id: 'weekly', label: 'Weekly', icon: '📅' },
  { id: 'monthly', label: 'Monthly', icon: '🌙' },
  { id: 'yearly', label: 'Yearly', icon: '🎂' },
];

const HOURS = Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, '0'));
const PERIODS = ['AM', 'PM'];

interface TimetableEvent {
  id: string;
  day: string;
  time: string;
  end_time?: string;
  activity: string;
  user_id: string;
}

interface CalendarEvent {
  id: string;
  event_date: string;
  title: string;
  user_id: string;
  frequency: 'once' | 'weekly' | 'monthly' | 'yearly';
}

export default function DashboardScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState<string>('');
  
  // Data States
  const [motm, setMotm] = useState<string>('Thinking of you soon...');
  const [nextMeetingDate, setNextMeetingDate] = useState<Date | null>(null);
  const [meetingOccasion, setMeetingOccasion] = useState<string | null>(null);
  const [countdownText, setCountdownText] = useState('Meeting you soon');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [stats, setStats] = useState({ memories: 0 });
  const [timetable, setTimetable] = useState<TimetableEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Relationship Calculation
  const now = new Date();
  const yearsTogether = differenceInYears(now, ANNIVERSARY_DATE);
  const daysTogether = differenceInDays(now, addYears(ANNIVERSARY_DATE, yearsTogether));
  const ourDaysText = `${yearsTogether}Y ${daysTogether}D`;

  // Next upcoming anniversary (from anniversaries table)
  const [nextAnniv, setNextAnniv] = useState<{ name: string; date: Date; daysAway: number } | null>(null);
  React.useEffect(() => {
    try {
      const rows = db.getAllSync(`SELECT * FROM anniversaries`) as any[];
      if (!rows || rows.length === 0) { setNextAnniv(null); return; }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let best: { name: string; date: Date; daysAway: number } | null = null;
      for (const r of rows) {
        const d = new Date(r.date);
        const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate());
        const next = thisYear < today ? new Date(today.getFullYear() + 1, d.getMonth(), d.getDate()) : thisYear;
        const daysAway = Math.ceil((next.getTime() - today.getTime()) / 86400000);
        if (!best || daysAway < best.daysAway) best = { name: r.name, date: next, daysAway };
      }
      setNextAnniv(best);
    } catch { setNextAnniv(null); }
  }, []);

  // --- Routine States ---
  const [selectedDay, setSelectedDay] = useState(DAYS_SHORT[new Date().getDay() === 0 ? 6 : new Date().getDay() - 1]);
  const [showTimetableModal, setShowTimetableModal] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newActivity, setNewActivity] = useState('');

  // --- Calendar States ---
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [newCalendarTitle, setNewCalendarTitle] = useState('');
  const [newCalendarFreq, setNewCalendarFreq] = useState<'once' | 'weekly' | 'monthly' | 'yearly'>('once');
  
  // --- Common Picker States ---
  const [showPicker, setShowPicker] = useState<'start' | 'end' | null>(null);
  const [selHour, setSelHour] = useState('09');
  const [selMin, setSelMin] = useState('00');
  const [selPeriod, setSelPeriod] = useState('AM');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!partnerName) return;

    // Setup Realtime Channels that also update local SQLite
    const motmSub = supabase.channel('db_motm').on('postgres_changes', { event: '*', schema: 'public', table: 'moments' }, (p) => {
      if (p.eventType === 'UPDATE' || p.eventType === 'INSERT') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO moments (id, created_at, message, user_id) VALUES (?, ?, ?, ?)`, 
          [n.id, n.created_at, n.message, n.user_id]);
      }
      fetchMOTM(partnerName);
    }).subscribe();

    const meetSub = supabase.channel('db_meet').on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, (p) => {
      if (p.eventType === 'INSERT' || p.eventType === 'UPDATE') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, recurring_type, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.type, n.date, n.recurring_type, n.occasion_name, n.user_id, n.weekday, n.day_of_month, n.time, n.is_recurring ? 1 : 0, n.frequency]);
      } else if (p.eventType === 'DELETE') {
        db.runSync(`DELETE FROM meetings WHERE id = ?`, [p.old.id]);
      }
      fetchNextMeet();
    }).subscribe();

    const timeSub = supabase.channel('db_time').on('postgres_changes', { event: '*', schema: 'public', table: 'timetable' }, (p) => {
      if (p.eventType !== 'DELETE') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO timetable (id, created_at, day, time, end_time, activity, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.day, n.time, n.end_time, n.activity, n.user_id]);
      } else {
        db.runSync(`DELETE FROM timetable WHERE id = ?`, [p.old.id]);
      }
      fetchTimetable();
    }).subscribe();

    const calSub = supabase.channel('db_cal').on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, (p) => {
      if (p.eventType !== 'DELETE') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO calendar_events (id, created_at, event_date, title, user_id, frequency) VALUES (?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.event_date, n.title, n.user_id, n.frequency]);
      } else {
        db.runSync(`DELETE FROM calendar_events WHERE id = ?`, [p.old.id]);
      }
      fetchCalendarEvents();
    }).subscribe();

    const postsSub = supabase.channel('db_posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchStats()).subscribe();

    const refreshSub = DeviceEventEmitter.addListener('refresh-dashboard', () => {
      fetchNextMeet();
      fetchMOTM(partnerName);
      fetchTimetable();
      fetchCalendarEvents();
      fetchStats();
    });

    return () => {
      supabase.removeChannel(motmSub);
      supabase.removeChannel(meetSub);
      supabase.removeChannel(timeSub);
      supabase.removeChannel(calSub);
      supabase.removeChannel(postsSub);
      refreshSub.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [partnerName]);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setCurrentUserName(name);
    const partner = name?.toLowerCase() === 'pratishth' ? 'love' : 'pratishth';
    setPartnerName(partner);

    // Initial load from SQLite
    fetchMOTM(partner);
    fetchNextMeet();
    fetchStats();
    fetchTimetable();
    fetchCalendarEvents();

    // Background fetch to sync SQLite with Supabase
    syncRemoteToLocal(partner);
    setLoading(false);
  };

  const syncRemoteToLocal = async (pName: string) => {
    try {
      // Sync Moments
      const { data: mData } = await supabase.from('moments').select('*');
      if (mData) mData.forEach(m => db.runSync(`INSERT OR REPLACE INTO moments (id, message, user_id, created_at) VALUES (?, ?, ?, ?)`, [m.id, m.message, m.user_id, m.created_at]));
      
      // Sync Meetings
      const { data: mtData } = await supabase.from('meetings').select('*');
      if (mtData) mtData.forEach(n => db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, recurring_type, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [n.id, n.created_at, n.type, n.date, n.recurring_type, n.occasion_name, n.user_id, n.weekday, n.day_of_month, n.time, n.is_recurring ? 1 : 0, n.frequency]));

      // Sync Timetable
      const { data: ttData } = await supabase.from('timetable').select('*');
      if (ttData) ttData.forEach(n => db.runSync(`INSERT OR REPLACE INTO timetable (id, created_at, day, time, end_time, activity, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [n.id, n.created_at, n.day, n.time, n.end_time, n.activity, n.user_id]));

      // Sync Calendar
      const { data: cData } = await supabase.from('calendar_events').select('*');
      if (cData) cData.forEach(n => db.runSync(`INSERT OR REPLACE INTO calendar_events (id, created_at, event_date, title, user_id, frequency) VALUES (?, ?, ?, ?, ?, ?)`, 
        [n.id, n.created_at, n.event_date, n.title, n.user_id, n.frequency]));

      // Refresh state after sync
      fetchMOTM(pName);
      fetchNextMeet();
      fetchTimetable();
      fetchCalendarEvents();
      fetchStats();
    } catch (e) {}
  };

  const fetchMOTM = async (pName?: string) => {
    const target = pName || partnerName;
    if (!target) return;
    try {
      const data = db.getFirstSync(`SELECT message FROM moments WHERE LOWER(user_id) = LOWER(?) ORDER BY created_at DESC LIMIT 1`, [target]) as any;
      if (data) setMotm(data.message);
    } catch (e) {}
  };

  const fetchNextMeet = async () => {
    try {
      const data = db.getFirstSync(`SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1`) as any;
      if (data) {
        calculateNextDate({ ...data, is_recurring: data.is_recurring === 1 });
        setMeetingOccasion(data.occasion_name || null);
      } else {
        setCountdownText('Meeting you soon');
      }
    } catch (e) {}
  };

  const calculateNextDate = (data: any) => {
    const now = new Date();
    let target: Date;

    const meetingTimeStr = data.time || '12:00 AM';
    const timeParts = meetingTimeStr.split(' ');
    const [h, m] = timeParts[0].split(':').map(Number);
    const period = timeParts[1];
    let hours = h;
    if (period === 'PM' && h !== 12) hours += 12;
    if (period === 'AM' && h === 12) hours = 0;

    if (data.type === 'specific' && data.date) {
      target = set(new Date(data.date), { hours, minutes: m, seconds: 0, milliseconds: 0 });
      if (!isAfter(target, now)) {
        if (!data.is_recurring) {
          setNextMeetingDate(null);
          setCountdownText('Meeting you soon');
          return;
        } else {
          while (!isAfter(target, now)) {
            target = addMonths(target, 12);
          }
        }
      }
    } else if (data.type === 'weekly') {
      const dayIdx = DAY_MAP[data.weekday || 'Friday'];
      target = setDay(now, dayIdx, { weekStartsOn: 0 });
      target = set(target, { hours, minutes: m, seconds: 0, milliseconds: 0 });
      if (!isAfter(target, now)) {
        target = addWeeks(target, 1);
      }
    } else if (data.type === 'monthly') {
      target = set(now, { date: data.day_of_month || 1, hours, minutes: m, seconds: 0, milliseconds: 0 });
      if (!isAfter(target, now)) {
        target = addMonths(target, 1);
      }
    } else {
      return;
    }

    setNextMeetingDate(target);
    startCountdown(target);
  };

  const startCountdown = (target: Date) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const update = () => {
      const now = new Date();
      const diffSeconds = differenceInSeconds(target, now);
      if (diffSeconds <= 0) {
        setCountdownText('It is time! ❤️');
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      const days = Math.floor(diffSeconds / (3600 * 24));
      if (days >= 1) {
        setCountdownText(`${days} Days Left`);
      } else {
        const hrs = Math.floor(diffSeconds / 3600).toString().padStart(2, '0');
        const mins = Math.floor((diffSeconds % 3600) / 60).toString().padStart(2, '0');
        const secs = (diffSeconds % 60).toString().padStart(2, '0');
        setCountdownText(`${hrs}:${mins}:${secs}`);
      }
    };
    update();
    timerRef.current = setInterval(update, 1000);
  };

  const fetchStats = async () => {
    try {
      const data = db.getFirstSync(`SELECT COUNT(*) as count FROM posts`) as any;
      setStats({ memories: data?.count || 0 });

      const { count } = await supabase.from('posts').select('*', { count: 'exact', head: true });
      if (count !== undefined) {
        setStats({ memories: count });
        const { data: pData } = await supabase.from('posts').select('*');
        if (pData) pData.forEach(p => {
          if (isTombstoned('posts', p.id)) return;
          db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.id, p.created_at, p.type, p.content, p.user_id, JSON.stringify(p.reactions), p.seen_by ? p.seen_by.join(',') : '']);
        });
      }
    } catch (e) {}
  };

  const fetchTimetable = async () => {
    try {
      const data = db.getAllSync(`SELECT * FROM timetable ORDER BY time ASC`) as any[];
      if (data) setTimetable(data);
    } catch (e) {}
  };

  const fetchCalendarEvents = async () => {
    try {
      const data = db.getAllSync(`SELECT * FROM calendar_events ORDER BY event_date ASC`) as any[];
      if (data) setCalendarEvents(data);
    } catch (e) {}
  };

  // --- Routine Logic ---
  const timeToMinutes = (timeStr: string) => {
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  const addRoutineEvent = async () => {
    if (!newTime || !newActivity || !currentUserName) {
      Alert.alert('Incomplete', 'Please set at least a start time and activity.');
      return;
    }
    if (newEndTime) {
      const startMins = timeToMinutes(newTime);
      const endMins = timeToMinutes(newEndTime);
      if (endMins <= startMins) {
        Alert.alert('Invalid Time', 'End time must be after the start time.');
        return;
      }
    }
    setIsSaving(true);
    const id = generateUUID();
    const payload = {
      id,
      day: selectedDay,
      time: newTime,
      end_time: newEndTime || null,
      activity: newActivity,
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO timetable (id, day, time, end_time, activity, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.day, payload.time, payload.end_time, payload.activity, payload.user_id, payload.created_at]);
      
      queueSyncOperation('timetable', payload.id, 'INSERT', payload);

      setNewTime(''); setNewEndTime(''); setNewActivity('');
      fetchTimetable();
      syncAllNotifications();
    } catch (e) {
      console.warn('Routine add error', e);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRoutineEvent = async (id: string) => {
    Alert.alert('Delete?', 'Remove activity?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        db.runSync(`DELETE FROM timetable WHERE id = ?`, [id]);
        queueSyncOperation('timetable', id, 'DELETE', {});
        fetchTimetable();
        syncAllNotifications();
      } catch (e) {}
    }}]);
  };

  // --- Calendar Logic ---
  const isEventOnDay = (event: CalendarEvent, date: Date) => {
    const eventDate = new Date(event.event_date);
    if (isSameDay(eventDate, date)) return true;
    if (isBefore(date, startOfDay(eventDate))) return false;
    if (event.frequency === 'weekly') return eventDate.getDay() === date.getDay();
    if (event.frequency === 'monthly') return eventDate.getDate() === date.getDate();
    if (event.frequency === 'yearly') return eventDate.getDate() === date.getDate() && eventDate.getMonth() === date.getMonth();
    return false;
  };

  const addCalendarEvent = async () => {
    if (!newCalendarTitle || !currentUserName) return;
    setIsSaving(true);
    const id = generateUUID();
    const payload = {
      id,
      event_date: format(selectedCalendarDate, 'yyyy-MM-dd'),
      title: newCalendarTitle,
      frequency: newCalendarFreq,
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO calendar_events (id, event_date, title, frequency, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.event_date, payload.title, payload.frequency, payload.user_id, payload.created_at]);
      
      queueSyncOperation('calendar_events', payload.id, 'INSERT', payload);

      setNewCalendarTitle(''); setNewCalendarFreq('once');
      setShowCalendarModal(false);
      fetchCalendarEvents();
      syncAllNotifications();
    } catch (e) {}
    setIsSaving(false);
  };

  const deleteCalendarEvent = async (id: string) => {
    Alert.alert('Delete?', 'Remove event?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        db.runSync(`DELETE FROM calendar_events WHERE id = ?`, [id]);
        queueSyncOperation('calendar_events', id, 'DELETE', {});
        fetchCalendarEvents();
        syncAllNotifications();
      } catch (e) {}
    }}]);
  };

  const confirmTime = () => {
    const timeStr = `${selHour}:${selMin} ${selPeriod}`;
    if (showPicker === 'start') setNewTime(timeStr);
    else if (showPicker === 'end') setNewEndTime(timeStr);
    setShowPicker(null);
  };

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const start = startOfWeek(monthStart);
    const monthEnd = endOfMonth(currentMonth);
    const end = endOfWeek(monthEnd);
    let days = eachDayOfInterval({ start, end });
    if (days.length < 42) {
      const lastDay = days[days.length - 1];
      const extraNeeded = 42 - days.length;
      for (let i = 1; i <= extraNeeded; i++) {
        days.push(addDays(lastDay, i));
      }
    }
    return days;
  }, [currentMonth]);

  const selectedDayEvents = calendarEvents.filter(e => isEventOnDay(e, selectedCalendarDate));

  if (loading) {
    return <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}><ActivityIndicator size="large" color={theme.tint} /></ThemedView>;
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]}>
        
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.greeting, { color: theme.text }]}>Hello, TAMTAM</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Thinking of you today</Text>
          </View>
          <TouchableOpacity onPress={() => DeviceEventEmitter.emit('show-navigator')}>
            <LottieView autoPlay loop source={{ uri: 'https://assets9.lottiefiles.com/packages/lf20_at6mscsc.json' }} style={styles.lottieHeart} />
          </TouchableOpacity>
        </View>

        {/* Countdown */}
        <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', delay: 100 }}>
          <LinearGradient colors={[theme.tint, theme.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.countdownCard}>
            <Sparkles color="rgba(255,255,255,0.3)" size={60} style={styles.sparkleIcon} />
            <Text style={styles.countdownTitle}>{meetingOccasion || 'Next Time We Meet'}</Text>
            <Text style={[styles.countdownValue, countdownText.includes(':') && { fontFamily: 'SpaceMono-Regular' }]}>{countdownText}</Text>
            <View style={styles.meetingInfo}>
              <Calendar color="#FFF" size={16} />
              <Text style={styles.meetingDate}>{nextMeetingDate ? format(nextMeetingDate, 'MMMM do, yyyy') : 'Meeting you soon'}</Text>
            </View>
          </LinearGradient>
        </MotiView>

        {/* MOTM */}
        <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', delay: 300 }} style={styles.momentCardWrapper}>
          <BlurView intensity={colorScheme === 'dark' ? 40 : 80} tint={colorScheme} style={[styles.momentCard, { borderColor: theme.tint + '40', borderWidth: 1 }]}>
            <View style={styles.momentHeader}>
              <MessageSquareHeart color={theme.tint} size={22} />
              <Text style={[styles.momentTitle, { color: theme.tabIconDefault }]}>Message of the Moment</Text>
            </View>
            <Text style={[styles.momentBody, { color: theme.text }]}>"{motm}"</Text>
            <View style={styles.motmFooter}>
              <Heart size={14} color={theme.tint} fill={theme.tint} />
              <Text style={[styles.motmAuthor, { color: theme.tabIconDefault }]}>FROM {partnerName.toUpperCase()}</Text>
            </View>
          </BlurView>
        </MotiView>

        {/* Stats */}
        <View style={styles.statsRow}>
          <SummaryCard title="Our Days" value={ourDaysText} icon={<Heart color={theme.tint} size={20} fill={theme.tint} />} theme={theme} />
          <PartnerCompassCard theme={theme} currentUser={currentUserName || ''} partnerName={partnerName || ''} />
        </View>

        {/* --- DIET SECTION --- */}
        {/* <View style={styles.section}>
          <TouchableOpacity 
            onPress={() => DeviceEventEmitter.emit('show-navigator')} // Or direct navigation if preferred
            activeOpacity={0.7} 
            style={[styles.spaceButton, { backgroundColor: theme.card }]}
          >
            <View style={styles.spaceLeft}>
              <View style={[styles.spaceIcon, { backgroundColor: 'rgba(255, 45, 85, 0.1)' }]}>
                <Utensils color="#FF2D55" size={24} />
              </View>
              <View style={{ backgroundColor: 'transparent' }}>
                <Text style={[styles.spaceTitle, { color: theme.text }]}>Diet Plan</Text>
                <Text style={[styles.spaceSubtitle, { color: theme.tabIconDefault }]}>Track routine & nutrition</Text>
              </View>
            </View>
            <ChevronRight color={theme.tabIconDefault} size={20} />
          </TouchableOpacity>
        </View> */}

        {/* --- RESTORED ROUTINE SECTION --- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Our Routine</Text>
            <TouchableOpacity onPress={() => setShowTimetableModal(true)} style={[styles.setupButton, { backgroundColor: theme.tint + '15' }]}>
              <Settings2 color={theme.tint} size={18} />
              <Text style={[styles.setupText, { color: theme.tint }]}>Setup</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.daySelector}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {DAYS_SHORT.map(day => (
                <Pressable key={day} onPress={() => setSelectedDay(day)} style={[styles.dayPill, { backgroundColor: theme.card }, selectedDay === day && { backgroundColor: theme.tint }]}>
                  <Text style={[styles.dayText, { color: theme.tabIconDefault }, selectedDay === day && { color: '#FFF' }]}>{day}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <View style={styles.eventContainer}>
            {timetable.filter(e => e.day === selectedDay).length === 0 ? (
              <View style={[styles.emptyEvents, { backgroundColor: theme.card }]}><Clock color={theme.tabIconDefault} size={32} opacity={0.5} /><Text style={[styles.emptyText, { color: theme.tabIconDefault }]}>Relax today ✨</Text></View>
            ) : (
              timetable.filter(e => e.day === selectedDay).map((event, index) => (
                <MotiView key={event.id} from={{ opacity: 0, translateX: -20 }} animate={{ opacity: 1, translateX: 0 }} transition={{ delay: index * 50 }} style={[styles.eventCard, { backgroundColor: theme.card }]}>
                  <View style={[styles.timeStrip, { backgroundColor: theme.tint }]} />
                  <View style={styles.eventInfo}>
                    <Text style={[styles.eventTime, { color: theme.tabIconDefault }]}>{event.time}{event.end_time ? ` — ${event.end_time}` : ''}</Text>
                    <Text style={[styles.eventActivity, { color: theme.text }]}>{event.activity}</Text>
                  </View>
                  <View style={[styles.userBadge, { backgroundColor: theme.tint + '10' }]}><Text style={{ color: theme.tint, fontSize: 10, fontWeight: '800' }}>{currentUserName ? (event.user_id === currentUserName.toLowerCase() ? 'ME' : partnerName.charAt(0).toUpperCase()) : 'L'}</Text></View>
                </MotiView>
              ))
            )}
          </View>
        </View>

        {/* --- RESTORED CALENDAR SECTION --- */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Calendar</Text>
            <TouchableOpacity onPress={() => setShowCalendarModal(true)} style={[styles.setupButton, { backgroundColor: theme.tint + '15' }]}>
              <Plus color={theme.tint} size={18} /><Text style={[styles.setupText, { color: theme.tint }]}>Event</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.calendarContainer, { backgroundColor: theme.card }]}>
            <View style={styles.calendarHeader}>
              <TouchableOpacity onPress={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft color={theme.text} size={24} /></TouchableOpacity>
              <Text style={[styles.monthText, { color: theme.text }]}>{format(currentMonth, 'MMMM yyyy')}</Text>
              <TouchableOpacity onPress={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight color={theme.text} size={24} /></TouchableOpacity>
            </View>
            <View style={styles.weekDaysRow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Text key={i} style={[styles.weekDayText, { color: theme.tabIconDefault }]}>{d}</Text>)}
            </View>
            <View style={styles.daysGrid}>
              {calendarDays.map((day, i) => {
                const isSelected = isSameDay(day, selectedCalendarDate);
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const hasEvents = calendarEvents.some(e => isEventOnDay(e, day));
                return (
                  <Pressable key={i} onPress={() => setSelectedCalendarDate(day)} style={[styles.dayCell, isSelected && { backgroundColor: theme.tint }, !isCurrentMonth && { opacity: 0.3 }]}>
                    <Text style={[styles.dayCellText, { color: isSelected ? '#FFF' : theme.text }]}>{format(day, 'd')}</Text>
                    {hasEvents && !isSelected && <View style={[styles.eventDot, { backgroundColor: theme.tint }]} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.dayEventsContainer}>
            <Text style={[styles.dayEventsTitle, { color: theme.tabIconDefault }]}>{format(selectedCalendarDate, 'MMMM do')}</Text>
            {selectedDayEvents.length === 0 ? <Text style={[styles.noEventsText, { color: theme.tabIconDefault }]}>No events for this day</Text> : (
              selectedDayEvents.map(event => (
                <View key={event.id} style={[styles.calendarEventCard, { backgroundColor: theme.card }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.calendarEventTitle, { color: theme.text }]}>{event.title}</Text>
                    <Text style={{ fontSize: 10, color: theme.tabIconDefault, marginTop: 2 }}>{event.frequency.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteCalendarEvent(event.id)}><Trash2 color="#FF3B30" size={16} /></TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      {/* --- RESTORED OVERLAYS (Stable View Hierarchy) --- */}
      <AnimatePresence>
        {/* Routine Setup */}
        {showTimetableModal && (
          <MotiView key="routineOverlay" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowTimetableModal(false)} />
              <MotiView from={{ translateY: 300, scale: 0.9 }} animate={{ translateY: 0, scale: 1 }} exit={{ translateY: 300, scale: 0.9 }} style={[styles.modalContent, { backgroundColor: theme.card, borderColor: theme.tabIconDefault + '30', borderWidth: 1 }]}>
                <View style={styles.modalHeader}>
                  <View style={{ backgroundColor: 'transparent' }}><Text style={[styles.modalTitle, { color: theme.text }]}>Manage Routine</Text><Text style={[styles.modalSubtitle, { color: theme.tabIconDefault }]}>Add or remove daily tasks</Text></View>
                  <TouchableOpacity onPress={() => setShowTimetableModal(false)} style={styles.closeBtn}><X color={theme.text} size={24} /></TouchableOpacity>
                </View>
                <View style={[styles.addEventBox, { backgroundColor: theme.background, borderColor: theme.tabIconDefault + '20' }]}>
                  <TouchableOpacity onPress={() => setShowPicker('start')} style={styles.pickerTrigger}><View style={styles.inputGroup}><Clock color={theme.tint} size={18} /><Text style={[styles.pickerValue, { color: newTime ? theme.text : theme.tabIconDefault }]}>{newTime || 'Start Time'}</Text></View><ChevronDown color={theme.tabIconDefault} size={18} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowPicker('end')} style={styles.pickerTrigger}><View style={styles.inputGroup}><Clock color={theme.tint} size={18} /><Text style={[styles.pickerValue, { color: newEndTime ? theme.text : theme.tabIconDefault }]}>{newEndTime || 'End Time (Optional)'}</Text></View><ChevronDown color={theme.tabIconDefault} size={18} /></TouchableOpacity>
                  <View style={[styles.inputGroup, styles.activityInput]}><MessageCircle color={theme.tint} size={18} /><TextInput style={[styles.input, { color: theme.text }]} placeholder="What's happening?" placeholderTextColor={theme.tabIconDefault} value={newActivity} onChangeText={setNewActivity} /></View>
                  <TouchableOpacity onPress={addRoutineEvent} disabled={isSaving} style={[styles.addBtn, { backgroundColor: theme.tint }]}>{isSaving ? <ActivityIndicator size="small" color="#FFF" /> : <><Plus color="#FFF" size={20} /><Text style={styles.addBtnText}>Add to {selectedDay}</Text></>}</TouchableOpacity>
                </View>
                <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                  {timetable.filter(e => e.day === selectedDay).map(event => (
                    <View key={event.id} style={[styles.manageCard, { backgroundColor: theme.background }]}><View style={{ backgroundColor: 'transparent' }}><Text style={[styles.manageTime, { color: theme.tint }]}>{event.time}{event.end_time ? ` — ${event.end_time}` : ''}</Text><Text style={[styles.manageActivity, { color: theme.text }]}>{event.activity}</Text></View><TouchableOpacity onPress={() => deleteRoutineEvent(event.id)} style={styles.deleteBtn}><Trash2 color="#FF3B30" size={18} /></TouchableOpacity></View>
                  ))}
                </ScrollView>
              </MotiView>
            </View>
          </MotiView>
        )}

        {/* Calendar Setup */}
        {showCalendarModal && (
          <MotiView key="calendarOverlay" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowCalendarModal(false)} />
              <MotiView from={{ translateY: 300, scale: 0.9 }} animate={{ translateY: 0, scale: 1 }} exit={{ translateY: 300, scale: 0.9 }} style={[styles.modalContent, { backgroundColor: theme.card, borderColor: theme.tabIconDefault + '30', borderWidth: 1 }]}>
                <View style={styles.modalHeader}>
                  <View style={{ backgroundColor: 'transparent' }}><Text style={[styles.modalTitle, { color: theme.text }]}>Add Event</Text><Text style={[styles.modalSubtitle, { color: theme.tabIconDefault }]}>{format(selectedCalendarDate, 'MMMM do, yyyy')}</Text></View>
                  <TouchableOpacity onPress={() => setShowCalendarModal(false)} style={styles.closeBtn}><X color={theme.text} size={24} /></TouchableOpacity>
                </View>
                <View style={[styles.addEventBox, { backgroundColor: theme.background, borderColor: theme.tabIconDefault + '20' }]}>
                  <View style={[styles.inputGroup, styles.activityInput, { marginBottom: 12 }]}><Calendar color={theme.tint} size={18} /><TextInput style={[styles.input, { color: theme.text }]} placeholder="Event Title" placeholderTextColor={theme.tabIconDefault} value={newCalendarTitle} onChangeText={setNewCalendarTitle} autoFocus /></View>
                  <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginBottom: 8 }]}>FREQUENCY</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                    {FREQUENCIES.map(f => (<TouchableOpacity key={f.id} onPress={() => setNewCalendarFreq(f.id as any)} style={[styles.freqBtn, { backgroundColor: theme.card, flex: 1 }, newCalendarFreq === f.id && { backgroundColor: theme.tint }]}><Text style={{ fontSize: 16 }}>{f.icon}</Text><Text style={[styles.freqLabel, { color: newCalendarFreq === f.id ? '#FFF' : theme.text, fontSize: 10 }]}>{f.label}</Text></TouchableOpacity>))}
                  </View>
                  <TouchableOpacity onPress={addCalendarEvent} disabled={isSaving} style={[styles.addBtn, { backgroundColor: theme.tint }]}>{isSaving ? <ActivityIndicator size="small" color="#FFF" /> : <><Plus color="#FFF" size={20} /><Text style={styles.addBtnText}>Save Event</Text></>}</TouchableOpacity>
                </View>
              </MotiView>
            </View>
          </MotiView>
        )}

        {/* Shared Time Picker */}
        {showPicker && (
          <MotiView key="timePickerOverlay" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={[StyleSheet.absoluteFill, { zIndex: 1000 }]}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.timePickerBox, { backgroundColor: theme.card }]}>
                <Text style={[styles.pickerTitle, { color: theme.text }]}>Select Time</Text>
                <View style={styles.pickerWheelRow}>
                  <Wheel data={HOURS} selected={selHour} onSelect={setSelHour} theme={theme} />
                  <Text style={{ fontSize: 24, fontWeight: '800', color: theme.text }}>:</Text>
                  <Wheel data={MINUTES} selected={selMin} onSelect={setSelMin} theme={theme} />
                  <Wheel data={PERIODS} selected={selPeriod} onSelect={setSelPeriod} theme={theme} />
                </View>
                <View style={styles.pickerActions}>
                  <TouchableOpacity onPress={() => setShowPicker(null)} style={styles.cancelBtn}><Text style={[styles.cancelText, { color: theme.tabIconDefault }]}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={confirmTime} style={[styles.confirmBtn, { backgroundColor: theme.tint }]}><Text style={styles.confirmText}>Set Time</Text></TouchableOpacity>
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
        <TouchableOpacity key={item} onPress={() => onSelect(item)} style={[styles.wheelItem, selected === item && { backgroundColor: theme.tint + '20', borderRadius: 10 }]}><Text style={[styles.wheelText, { color: selected === item ? theme.tint : theme.text }]}>{item}</Text></TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function SummaryCard({ title, value, icon, theme }: any) {
  return (
    <View style={[styles.summaryCard, { backgroundColor: theme.card }]}>
      <View style={styles.summaryHeader}>{icon}<Text style={[styles.summaryTitle, { color: theme.tabIconDefault }]}>{title}</Text></View>
      <Text style={[styles.summaryValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

function PartnerCompassCard({ theme, currentUser, partnerName }: any) {
  const [distance, setDistance] = React.useState<number | null>(null);
  const [updated, setUpdated] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<'waiting' | 'no-perm' | 'locked' | 'ready'>('waiting');
  const [expanded, setExpanded] = React.useState(false);
  const [partnerCoord, setPartnerCoord] = React.useState<{ lat: number; lng: number } | null>(null);
  const needleRotation = useSharedValue(0); // animated needle angle
  const pulse = useSharedValue(1);
  const targetBearingRef = React.useRef<number | null>(null);
  const headingRef = React.useRef(0);

  // Distance → color bucket. Drives needle / centre dot / distance text so
  // the user gets a single-glance "how close" signal.
  const proximityColor = React.useMemo(() => {
    if (distance == null) return '#FF2D55';
    if (distance < 200) return '#FF2D55';     // very close — pink
    if (distance < 2000) return '#FF9500';    // walking distance — amber
    if (distance < 20000) return '#34C759';   // mint — short drive
    return '#5AC8FA';                          // far — steel blue
  }, [distance]);

  const eta = React.useMemo(() => {
    if (distance == null) return null;
    if (distance < 1500) {
      const minutes = Math.max(1, Math.round(distance / 80));
      return `~${minutes} min walk`;
    }
    const minutes = Math.max(1, Math.round(distance / 600));
    return `~${minutes} min drive`;
  }, [distance]);

  // Stale = partner hasn't pinged in > 5 minutes.
  const isStale = React.useMemo(() => {
    if (!updated) return false;
    const t = new Date(updated).getTime();
    return Date.now() - t > 5 * 60 * 1000;
  }, [updated]);

  // Smooth pulse on the partner avatar dot.
  React.useEffect(() => {
    pulse.value = withRepeat(withSequence(
      withTiming(1.15, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      withTiming(1.0,  { duration: 900, easing: Easing.inOut(Easing.quad) })
    ), -1, false);
  }, []);

  const applyRotation = () => {
    if (targetBearingRef.current == null) return;
    const raw = ((targetBearingRef.current - headingRef.current) + 360) % 360;
    // Take shortest rotation path so it never spins all the way around.
    const delta = ((raw - (needleRotation.value % 360)) + 540) % 360 - 180;
    needleRotation.value = withTiming(needleRotation.value + delta, { duration: 280, easing: Easing.out(Easing.cubic) });
  };

  React.useEffect(() => {
    if (!currentUser) return;
    let headingSub: any = null;
    let posInterval: any = null;
    let recomputeInterval: any = null;
    let realtimeChan: any = null;
    let live = true;

    (async () => {
      try {
        const { status: pstatus } = await Location.requestForegroundPermissionsAsync();
        if (pstatus !== 'granted') { if (live) setStatus('no-perm'); return; }

        const writeMine = async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            recordOwnLocation(currentUser, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? undefined);
          } catch {}
        };
        await writeMine();
        posInterval = setInterval(writeMine, 60 * 1000);

        headingSub = await Location.watchHeadingAsync((h: any) => {
          if (!live) return;
          const deg = h?.trueHeading != null && h.trueHeading >= 0 ? h.trueHeading : (h?.magHeading ?? 0);
          headingRef.current = deg < 0 ? deg + 360 : deg;
          applyRotation();
        });

        const recompute = async () => {
          try {
            const me = await Location.getLastKnownPositionAsync();
            if (!me) return;
            const partner = getPartnerLocation(partnerName);
            if (!partner) { if (live) { setStatus('waiting'); targetBearingRef.current = null; } return; }
            const b = bearingDeg(me.coords.latitude, me.coords.longitude, partner.latitude, partner.longitude);
            const d = distanceMeters(me.coords.latitude, me.coords.longitude, partner.latitude, partner.longitude);
            if (!live) return;
            targetBearingRef.current = b;
            setDistance(d);
            setUpdated(partner.updated_at);
            setPartnerCoord({ lat: partner.latitude, lng: partner.longitude });
            setStatus('ready');
            applyRotation();
          } catch {}
        };
        await recompute();
        recomputeInterval = setInterval(recompute, 15 * 1000);

        realtimeChan = supabase.channel('partner-locations').on('postgres_changes',
          { event: '*', schema: 'public', table: 'partner_locations', filter: `user_id=eq.${partnerName}` },
          (payload: any) => {
            const row = payload.new || payload.record;
            if (!row || !live) return;
            db.runSync(
              `INSERT OR REPLACE INTO partner_locations (user_id, latitude, longitude, accuracy, updated_at) VALUES (?, ?, ?, ?, ?)`,
              [row.user_id, row.latitude, row.longitude, row.accuracy ?? null, row.updated_at]
            );
            recompute();
          }
        ).subscribe();
      } catch {}
    })();

    return () => {
      live = false;
      if (headingSub?.remove) headingSub.remove();
      if (posInterval) clearInterval(posInterval);
      if (recomputeInterval) clearInterval(recomputeInterval);
      if (realtimeChan) supabase.removeChannel(realtimeChan);
    };
  }, [currentUser, partnerName]);

  const needleStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${needleRotation.value}deg` }] }));
  const pulseStyle  = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const initial = (partnerName || 'P').charAt(0).toUpperCase();

  const openInMaps = () => {
    if (!partnerCoord) return;
    const url = Platform.OS === 'ios'
      ? `maps://?daddr=${partnerCoord.lat},${partnerCoord.lng}`
      : `geo:${partnerCoord.lat},${partnerCoord.lng}?q=${partnerCoord.lat},${partnerCoord.lng}`;
    require('react-native').Linking.openURL(url).catch(() => {});
  };

  const openLocationSettings = () => {
    require('react-native').Linking.openSettings?.().catch(() => {});
  };

  const a11y = distance != null && updated
    ? `Partner ${formatDistance(distance)} away, ${ago(updated)}`
    : 'Partner location not available yet';

  return (
    <>
      {/* Minimal tile — matches SummaryCard footprint so the row stays the
          same height as "Our Days". Just an arrow + distance. Full compass
          lives inside the tap-to-expand modal. */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => { try { (require('expo-haptics').impactAsync as any)?.((require('expo-haptics').ImpactFeedbackStyle as any).Light); } catch {} setExpanded(true); }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={[styles.summaryCard, { backgroundColor: theme.card }]}
      >
        <View style={styles.summaryHeader}>
          <Compass color={proximityColor} size={20} />
          <Text style={[styles.summaryTitle, { color: theme.tabIconDefault }]} numberOfLines={1}>FIND {(partnerName || 'PARTNER').toUpperCase()}</Text>
        </View>
        <View style={compassStyles.miniRow}>
          {status === 'ready' ? (
            <Animated.View style={[compassStyles.miniArrowWrap, needleStyle, isStale && { opacity: 0.55 }]}>
              <Navigation size={22} color={proximityColor} fill={proximityColor} />
            </Animated.View>
          ) : (
            <View style={compassStyles.miniArrowWrap}>
              <Compass size={20} color={theme.tabIconDefault} />
            </View>
          )}
          <Text style={[styles.summaryValue, { color: proximityColor, marginLeft: 8 }]} numberOfLines={1}>
            {distance != null ? formatDistance(distance) : '—'}
          </Text>
        </View>
        {(eta || updated) && (
          <Text style={[compassStyles.miniSub, { color: isStale ? '#FF9500' : theme.tabIconDefault }]} numberOfLines={1}>
            {eta ? eta : ''}{eta && updated ? ' · ' : ''}{updated ? `${isStale ? '• ' : ''}${ago(updated)}` : ''}
          </Text>
        )}
      </TouchableOpacity>

      <Modal visible={expanded} transparent animationType="fade" onRequestClose={() => setExpanded(false)}>
        <Pressable style={compassStyles.modalScrim} onPress={() => setExpanded(false)}>
          <Pressable style={[compassStyles.modalCard, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={[compassStyles.modalTag, { color: proximityColor }]}>FINDING</Text>
                <Text style={[compassStyles.modalTitle, { color: theme.text }]}>{partnerName || 'Partner'}</Text>
              </View>
              <TouchableOpacity onPress={() => setExpanded(false)}><X size={22} color={theme.tabIconDefault} /></TouchableOpacity>
            </View>

            <View style={compassStyles.modalDial}>
              <View style={[compassStyles.modalRing, { borderColor: theme.text + '25' }]} />
              {['N','E','S','W'].map((c, i) => (
                <Text key={c} style={[compassStyles.modalCardinal, {
                  color: c === 'N' ? proximityColor : theme.tabIconDefault,
                  top: i === 0 ? 10 : i === 2 ? undefined : '46%',
                  bottom: i === 2 ? 10 : undefined,
                  left: i === 3 ? 14 : i === 1 ? undefined : '47%',
                  right: i === 1 ? 14 : undefined,
                }]}>{c}</Text>
              ))}
              {status === 'ready' && (
                <Animated.View style={[compassStyles.modalNeedleWrap, needleStyle]}>
                  <View style={[compassStyles.modalNeedleHead, { borderBottomColor: proximityColor }]} />
                  <View style={[compassStyles.modalNeedleTail, { borderTopColor: proximityColor + '4D' }]} />
                </Animated.View>
              )}
              <Animated.View style={[compassStyles.modalCenterDot, pulseStyle, { backgroundColor: proximityColor }]}>
                <Text style={compassStyles.modalCenterInitial}>{initial}</Text>
              </Animated.View>
            </View>

            <View style={compassStyles.modalStatsRow}>
              <View style={{ alignItems: 'center' }}>
                <Text style={[compassStyles.modalStatValue, { color: proximityColor }]}>{distance != null ? formatDistance(distance) : '—'}</Text>
                <Text style={[compassStyles.modalStatLabel, { color: theme.tabIconDefault }]}>DISTANCE</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={[compassStyles.modalStatValue, { color: theme.text }]}>{eta ? eta.replace('~', '').split(' ')[0] : '—'}</Text>
                <Text style={[compassStyles.modalStatLabel, { color: theme.tabIconDefault }]}>{eta ? eta.split(' ').slice(1).join(' ').toUpperCase() : 'ETA'}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={[compassStyles.modalStatValue, { color: isStale ? '#FF9500' : theme.text }]}>{updated ? ago(updated) : '—'}</Text>
                <Text style={[compassStyles.modalStatLabel, { color: theme.tabIconDefault }]}>UPDATED</Text>
              </View>
            </View>

            {status === 'no-perm' ? (
              <TouchableOpacity onPress={openLocationSettings} style={[compassStyles.modalCta, { backgroundColor: '#FF9500' }]}>
                <Text style={compassStyles.modalCtaText}>OPEN LOCATION SETTINGS</Text>
              </TouchableOpacity>
            ) : partnerCoord ? (
              <TouchableOpacity onPress={openInMaps} style={[compassStyles.modalCta, { backgroundColor: proximityColor }]}>
                <Text style={compassStyles.modalCtaText}>OPEN IN MAPS</Text>
              </TouchableOpacity>
            ) : (
              <Text style={{ color: theme.tabIconDefault, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                Waiting for partner to share location...
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const compassStyles = StyleSheet.create({
  card: { flex: 1, marginLeft: 10, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'space-between' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  label: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  dial: { width: 92, height: 92, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  ring: { position: 'absolute', width: 92, height: 92, borderRadius: 46, borderWidth: 1.5 },
  cardinal: { position: 'absolute', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  needleWrap: { width: 80, height: 80, justifyContent: 'center', alignItems: 'center', position: 'absolute' },
  needleHead: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 28, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FF2D55', position: 'absolute', top: 6 },
  needleTail: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 24, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: 'rgba(255,45,85,0.3)', position: 'absolute', bottom: 8 },
  centerDot: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' },
  centerInitial: { color: '#fff', fontWeight: '900', fontSize: 12 },
  idle: { fontSize: 10, fontWeight: '800', textAlign: 'center' },
  distance: { marginTop: 10, fontSize: 16, fontWeight: '900' },
  age: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  eta: { fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.2 },
  // Minimal-tile bits (live alongside the "Our Days" SummaryCard on home).
  miniRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  miniArrowWrap: { width: 26, height: 26, justifyContent: 'center', alignItems: 'center' },
  miniSub: { fontSize: 11, fontWeight: '700', marginTop: 4, letterSpacing: 0.2 },
  modalScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 28, padding: 22, gap: 18 },
  modalTag: { fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  modalDial: { width: 220, height: 220, alignSelf: 'center', justifyContent: 'center', alignItems: 'center' },
  modalRing: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 2 },
  modalCardinal: { position: 'absolute', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
  modalNeedleWrap: { width: 200, height: 200, justifyContent: 'center', alignItems: 'center', position: 'absolute' },
  modalNeedleHead: { width: 0, height: 0, borderLeftWidth: 12, borderRightWidth: 12, borderBottomWidth: 70, borderLeftColor: 'transparent', borderRightColor: 'transparent', position: 'absolute', top: 12 },
  modalNeedleTail: { width: 0, height: 0, borderLeftWidth: 12, borderRightWidth: 12, borderTopWidth: 60, borderLeftColor: 'transparent', borderRightColor: 'transparent', position: 'absolute', bottom: 16 },
  modalCenterDot: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  modalCenterInitial: { color: '#fff', fontWeight: '900', fontSize: 22 },
  modalStatsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 6 },
  modalStatValue: { fontSize: 20, fontWeight: '900' },
  modalStatLabel: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: 4 },
  modalCta: { paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  modalCtaText: { color: '#fff', fontWeight: '900', letterSpacing: 0.6 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 120 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, backgroundColor: 'transparent' },
  greeting: { fontSize: 32, fontWeight: '800', letterSpacing: -1, backgroundColor: 'transparent' },
  subtitle: { fontSize: 18, marginTop: 4, fontWeight: '500', backgroundColor: 'transparent' },
  lottieHeart: { width: 80, height: 80 },
  countdownCard: { padding: 24, borderRadius: 32, marginBottom: 30, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 },
  sparkleIcon: { position: 'absolute', right: -10, top: -10 },
  countdownTitle: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, backgroundColor: 'transparent' },
  countdownValue: { color: '#FFF', fontSize: 36, fontWeight: '900', marginVertical: 8, backgroundColor: 'transparent' },
  meetingInfo: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'transparent' },
  meetingDate: { color: '#FFF', fontWeight: '600', fontSize: 14, backgroundColor: 'transparent' },
  momentCardWrapper: { borderRadius: 28, overflow: 'hidden', marginBottom: 35, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5 },
  momentCard: { padding: 24 },
  momentHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8, backgroundColor: 'transparent' },
  momentTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, backgroundColor: 'transparent' },
  momentBody: { fontSize: 19, fontWeight: '700', fontStyle: 'italic', lineHeight: 26, letterSpacing: -0.2, backgroundColor: 'transparent' },
  motmFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', paddingTop: 20 },
  motmAuthor: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 35, backgroundColor: 'transparent' },
  summaryCard: { flex: 0.48, padding: 20, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, backgroundColor: 'transparent' },
  summaryTitle: { fontSize: 12, fontWeight: '700', marginLeft: 6, textTransform: 'uppercase', backgroundColor: 'transparent' },
  summaryValue: { fontSize: 26, fontWeight: '800', backgroundColor: 'transparent' },
  section: { marginBottom: 35, backgroundColor: 'transparent' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18, paddingLeft: 5, backgroundColor: 'transparent' },
  sectionTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, backgroundColor: 'transparent' },
  setupButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 6 },
  setupText: { fontSize: 13, fontWeight: '700' },
  daySelector: { marginBottom: 16, backgroundColor: 'transparent' },
  dayPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 16, minWidth: 60, alignItems: 'center' },
  dayText: { fontSize: 14, fontWeight: '700' },
  eventContainer: { gap: 12, backgroundColor: 'transparent' },
  eventCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  timeStrip: { width: 4, height: '100%', borderRadius: 2, marginRight: 16 },
  eventInfo: { flex: 1, backgroundColor: 'transparent' },
  eventTime: { fontSize: 12, fontWeight: '700', marginBottom: 2, backgroundColor: 'transparent' },
  eventActivity: { fontSize: 16, fontWeight: '600', backgroundColor: 'transparent' },
  userBadge: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  emptyEvents: { padding: 32, borderRadius: 24, alignItems: 'center', gap: 12, borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(150,150,150,0.2)' },
  emptyText: { fontSize: 14, fontWeight: '600', backgroundColor: 'transparent' },
  spaceButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 15, elevation: 3 },
  spaceLeft: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'transparent' },
  spaceIcon: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  spaceTitle: { fontSize: 17, fontWeight: '700', backgroundColor: 'transparent' },
  spaceSubtitle: { fontSize: 14, fontWeight: '500', backgroundColor: 'transparent' },
  calendarContainer: { borderRadius: 32, padding: 20, elevation: 3 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, backgroundColor: 'transparent' },
  monthText: { fontSize: 18, fontWeight: '800' },
  weekDaysRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, backgroundColor: 'transparent' },
  weekDayText: { width: '14.28%', textAlign: 'center', fontSize: 12, fontWeight: '800' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'transparent' },
  dayCell: { width: '14.28%', height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10, marginBottom: 4 },
  dayCellText: { fontSize: 14, fontWeight: '600' },
  eventDot: { width: 4, height: 4, borderRadius: 2, position: 'absolute', bottom: 6 },
  dayEventsContainer: { paddingHorizontal: 4, backgroundColor: 'transparent', marginTop: 20 },
  dayEventsTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12 },
  noEventsText: { fontSize: 14, fontStyle: 'italic' },
  calendarEventCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 8 },
  calendarEventTitle: { fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { width: '90%', borderRadius: 32, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, backgroundColor: 'transparent' },
  modalTitle: { fontSize: 24, fontWeight: '800', backgroundColor: 'transparent' },
  modalSubtitle: { fontSize: 14, fontWeight: '600', backgroundColor: 'transparent' },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' },
  addEventBox: { padding: 16, borderRadius: 24, gap: 12, marginBottom: 24, borderWidth: 1 },
  pickerTrigger: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.1)', padding: 12, borderRadius: 12 },
  pickerValue: { fontSize: 15, fontWeight: '600' },
  inputGroup: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  activityInput: { backgroundColor: 'rgba(150,150,150,0.1)', padding: 12, borderRadius: 12 },
  input: { flex: 1, height: 30, fontSize: 15, fontWeight: '600' },
  inputLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' },
  addBtn: { height: 50, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  addBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  listLabel: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12, backgroundColor: 'transparent' },
  manageCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 8 },
  manageTime: { fontSize: 12, fontWeight: '800', backgroundColor: 'transparent' },
  manageActivity: { fontSize: 15, fontWeight: '600', backgroundColor: 'transparent' },
  deleteBtn: { padding: 8, backgroundColor: 'transparent' },
  timePickerBox: { width: SCREEN_WIDTH * 0.85, padding: 24, borderRadius: 32, alignItems: 'center', gap: 20 },
  pickerTitle: { fontSize: 20, fontWeight: '800' },
  pickerWheelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 150 },
  wheel: { width: 60 },
  wheelItem: { paddingVertical: 10, alignItems: 'center' },
  wheelText: { fontSize: 20, fontWeight: '700' },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  cancelBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  cancelText: { fontWeight: '700' },
  confirmBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  confirmText: { color: '#FFF', fontWeight: '800' },
  freqBtn: { paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  freqLabel: { fontWeight: '800' },
});
