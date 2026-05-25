import React, { useEffect, useState, useRef, useMemo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Alert, Modal, TextInput, FlatList, Dimensions, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard, ActivityIndicator, DeviceEventEmitter, Pressable } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import * as SecureStore from 'expo-secure-store';
import { BookOpen, Plus, X, BrainCircuit, PenTool, LayoutDashboard, Clock, ChevronLeft, Search as SearchIcon, Calendar, Flame, MessageSquare, Check, Trash2, ChevronRight, ListChecks, Minus, Edit3, Moon, Play, Pause, Bell, Sparkles, Bot, CalendarDays, Copy, Repeat, Microscope } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import RadialNavigator from '@/components/RadialNavigator';
import { MotiView, AnimatePresence } from 'moti';
import { displayName } from '@/lib/displayName';
import { format, differenceInDays, startOfToday, eachDayOfInterval, subDays, differenceInMinutes, startOfDay, isAfter, addDays, addWeeks, addMonths, isSameDay, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns';
import DateTimePicker from '@react-native-community/datetimepicker';
import { sendStudyNotification } from '@/lib/notifications';
import { getMotivationalBoost } from '@/lib/aiEngine';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const RECURRENCE_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Daily (7d)', value: 'daily' },
  { label: 'Weekly (4w)', value: 'weekly' },
  { label: 'Monthly (3m)', value: 'monthly' }
];

export default function StudyHubDashboard() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [decks, setDecks] = useState<any[]>([]);
  const [whiteboards, setWhiteboards] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');
  const [exams, setExams] = useState<any[]>([]);
  const [habitLog, setHabitLog] = useState<any[]>([]);
  const [brainDump, setBrainDump] = useState<any[]>([]);
  const [syllabus, setSyllabus] = useState<any[]>([]);
  const [routines, setRoutines] = useState<any[]>([]);
  const [routineCounts, setRoutineCounts] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMonth, setViewMonth] = useState(new Date());

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const start = startOfWeek(monthStart);
    const monthEnd = endOfMonth(viewMonth);
    const end = endOfWeek(monthEnd);
    
    // Use eachDayOfInterval to get base days
    let days = eachDayOfInterval({ start, end });
    
    // Normalize to 42 days (6 weeks) to ensure Sunday index 0 remains stable
    if (days.length < 42) {
      const lastDay = days[days.length - 1];
      const extraNeeded = 42 - days.length;
      for (let i = 1; i <= extraNeeded; i++) {
        days.push(addDays(lastDay, i));
      }
    }
    return days;
  }, [viewMonth]);

  const [aiBoost, setAiBoost] = useState<string>('Your medical journey is a marathon, keep going! 🩺');
  const [loadingBoost, setLoadingBoost] = useState(false);

  const [isDeckModalVisible, setIsDeckModalVisible] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newDeckDesc, setNewDeckDesc] = useState('');
  const [isWhiteboardModalVisible, setIsWhiteboardModalVisible] = useState(false);
  const [newWhiteboardTitle, setNewWhiteboardTitle] = useState('');
  const [isExamModalVisible, setIsExamModalVisible] = useState(false);
  const [examTitle, setExamTitle] = useState('');
  const [examDate, setExamDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isDumpModalVisible, setIsDumpModalVisible] = useState(false);
  const [dumpContent, setDumpContent] = useState('');
  const [editingDumpId, setEditingDumpId] = useState<string | null>(null);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isActionsSheetOpen, setIsActionsSheetOpen] = useState(false);
  const [toolsOrder, setToolsOrder] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllDumps, setShowAllDumps] = useState(false);
  const [expandedDumpId, setExpandedDumpId] = useState<string | null>(null);

  const [isRoutineModalVisible, setIsRoutineModalVisible] = useState(false);
  const [routineTitle, setRoutineTitle] = useState('');
  const [routineFor, setRoutineFor] = useState<'me' | 'partner' | 'both'>('me');
  const [routineDesc, setRoutineDesc] = useState('');
  const [routineStart, setRoutineStart] = useState('09:00');
  const [routineEnd, setRoutineEnd] = useState('10:00');
  const [routineRecurrence, setRoutineRecurrence] = useState('none');
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [isCopyModalVisible, setIsCopyModalVisible] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState(subDays(new Date(), 1));
  const [showCopyDatePicker, setShowCopyDatePicker] = useState(false);

  const [isTimerRunning, setIsTimerStarted] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [selectedDuration, setSelectedDuration] = useState(25);
  const [isTimerModalVisible, setIsTimerModalVisible] = useState(false);
  const [partnerSession, setPartnerSession] = useState<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const [isNapping, setIsNapping] = useState(false);
  const [napStartTime, setNapStartTime] = useState<Date | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      if (currentUser) {
        refreshFromSQLite();
        fetchActiveSessions();
      }
    }, [currentUser])
  );

  useEffect(() => {
    init();
    
    // 🔥 LIVE REFRESH LISTENER: Updates UI instantly when AI organizes things
    const sub = DeviceEventEmitter.addListener('DATA_REFRESH', () => {
      console.log("[Dashboard] AI-Driven data refresh triggered.");
      refreshFromSQLite();
    });

    const pullAndRefresh = async (table: string) => {
      try {
        if (table === 'study_decks') {
          const { data } = await supabase.from('study_decks').select('*');
          if (data) data.forEach((d: any) => db.runSync(`INSERT OR REPLACE INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [d.id, d.title, d.description, d.color, d.user_id, d.created_at]));
        } else if (table === 'study_whiteboards') {
          const { data } = await supabase.from('study_whiteboards').select('*');
          if (data) data.forEach((b: any) => db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, [b.id, b.title, typeof b.canvas_data === 'string' ? b.canvas_data : JSON.stringify(b.canvas_data || {}), b.updated_at]));
        }
      } catch {}
      refreshFromSQLite();
    };

    const subscription = supabase.channel('study_hub_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_study_sessions' }, (payload) => {
        if (payload.eventType === 'INSERT' && payload.new.user_id !== currentUser) { sendStudyNotification(payload.new.user_id, 'started a study session! 🧠'); }
        fetchActiveSessions();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_exams' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_brain_dump' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_syllabus' }, () => refreshData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_decks' }, (payload: any) => {
        if (payload.eventType === 'DELETE') {
          db.runSync(`DELETE FROM study_decks WHERE id = ?`, [payload.old?.id]);
          refreshFromSQLite();
        } else {
          pullAndRefresh('study_decks');
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_whiteboards' }, (payload: any) => {
        if (payload.eventType === 'DELETE') {
          db.runSync(`DELETE FROM study_whiteboards WHERE id = ?`, [payload.old?.id]);
          refreshFromSQLite();
        } else {
          pullAndRefresh('study_whiteboards');
        }
      })
      .subscribe();
    return () => { subscription.unsubscribe(); sub.remove(); };
  }, [currentUser]);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    if (name) {
      const u = name.toLowerCase().trim();
      setCurrentUser(u);
      refreshFromSQLite();
      fetchData(u);
      fetchAIBoost(u);
      if (u === 'pratishth') {
        try {
          const row = db.getFirstSync(`SELECT value FROM system_config WHERE key = 'groq_api_key'`) as any;
          if (row) setGroqKey(row.value);
        } catch (e) {}
      }
      setTimeout(() => fetchActiveSessions(), 500);
    }
  };

  const fetchAIBoost = async (uid: string) => {
    setLoadingBoost(true);
    const boost = await getMotivationalBoost(uid);
    setAiBoost(boost);
    setLoadingBoost(false);
  };
  const refreshData = () => { if (currentUser) fetchData(currentUser); };

  const refreshFromSQLite = () => {
    try {
      // 🧠 SMART CLEANUP: Auto-delete exams that have already passed
      const today = startOfToday();
      const allExams = db.getAllSync(`SELECT id, exam_date FROM study_exams`) as any[];
      allExams.forEach(e => {
        const examDate = startOfDay(new Date(e.exam_date));
        if (isAfter(today, examDate)) {
          db.runSync(`DELETE FROM study_exams WHERE id = ?`, [e.id]);
          db.runSync(`DELETE FROM calendar_events WHERE id = ?`, [e.id]);
          queueSyncOperation('study_exams', e.id, 'DELETE', {});
          queueSyncOperation('calendar_events', e.id, 'DELETE', {});
        }
      });

      setDecks(db.getAllSync(`SELECT * FROM study_decks ORDER BY created_at DESC`) || []);
      setWhiteboards(db.getAllSync(`SELECT * FROM study_whiteboards ORDER BY updated_at DESC`) || []);
      setExams(db.getAllSync(`SELECT * FROM study_exams ORDER BY exam_date ASC`) || []);
      setHabitLog(db.getAllSync(`SELECT * FROM study_habit_log ORDER BY date DESC LIMIT 365`) || []);
      setBrainDump(db.getAllSync(`SELECT * FROM study_brain_dump WHERE is_processed = 0 ORDER BY created_at DESC`) || []);
      setSyllabus(db.getAllSync(`SELECT * FROM study_syllabus ORDER BY order_index ASC`) || []);
      refreshRoutinesFromSQLite();
    } catch (e) {}
  };

  const refreshRoutinesFromSQLite = () => {
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const data = db.getAllSync(`SELECT * FROM study_routines WHERE date = ? ORDER BY start_time ASC`, [dateStr]) as any[];
      setRoutines(data || []);

      // Get counts for the calendar dots (next 14 days)
      const counts: Record<string, number> = {};
      const routinesAll = db.getAllSync(`SELECT date, COUNT(*) as count FROM study_routines GROUP BY date`) as any[];
      routinesAll.forEach(r => { counts[r.date] = r.count; });
      setRoutineCounts(counts);
    } catch (e) {}
  };

  useEffect(() => {
    refreshRoutinesFromSQLite();
  }, [selectedDate]);

  const addStudyRoutine = async () => {
    if (!routineTitle.trim()) return;
    
    const baseDate = selectedDate;
    let datesToInsert = [format(baseDate, 'yyyy-MM-dd')];

    if (routineRecurrence === 'daily') {
      for (let i = 1; i < 7; i++) datesToInsert.push(format(addDays(baseDate, i), 'yyyy-MM-dd'));
    } else if (routineRecurrence === 'weekly') {
      for (let i = 1; i < 4; i++) datesToInsert.push(format(addWeeks(baseDate, i), 'yyyy-MM-dd'));
    } else if (routineRecurrence === 'monthly') {
      for (let i = 1; i < 3; i++) datesToInsert.push(format(addMonths(baseDate, i), 'yyyy-MM-dd'));
    }

    // Resolve absolute for_user from the 'me'/'partner'/'both' picker so each device can filter cleanly.
    const meLower = (currentUser || '').trim().toLowerCase();
    const partner = meLower === 'pratishth' ? 'love' : 'pratishth';
    const forUser = routineFor === 'me' ? meLower : routineFor === 'partner' ? partner : 'both';

    try {
      datesToInsert.forEach(d => {
        const id = generateUUID();
        const payload = {
          id,
          user_id: currentUser,
          title: routineTitle.trim(),
          description: routineDesc.trim(),
          start_time: routineStart,
          end_time: routineEnd,
          date: d,
          is_completed: 0,
          for_user: forUser,
          created_at: new Date().toISOString()
        };
        db.runSync(`INSERT INTO study_routines (id, user_id, title, description, start_time, end_time, date, is_completed, for_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [payload.id, payload.user_id, payload.title, payload.description, payload.start_time, payload.end_time, payload.date, payload.is_completed, payload.for_user, payload.created_at]);
        queueSyncOperation('study_routines', id, 'INSERT', payload);
      });

      setIsRoutineModalVisible(false);
      setRoutineTitle('');
      setRoutineDesc('');
      setRoutineRecurrence('none');
      setRoutineFor('me');
      refreshRoutinesFromSQLite();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {}
  };

  const deleteRoutine = (id: string) => {
    Alert.alert('Delete Task?', 'Remove this from your routine?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.runSync(`DELETE FROM study_routines WHERE id = ?`, [id]);
        queueSyncOperation('study_routines', id, 'DELETE', {});
        refreshRoutinesFromSQLite();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
    ]);
  };

  const toggleRoutineComplete = (id: string, current: number) => {
    const next = current === 1 ? 0 : 1;
    db.runSync(`UPDATE study_routines SET is_completed = ? WHERE id = ?`, [next, id]);
    queueSyncOperation('study_routines', id, 'UPDATE', { is_completed: next });
    refreshRoutinesFromSQLite();
    if (next === 1) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const copyRoutineFromDay = () => {
    try {
      const sourceDateStr = format(copySourceDate, 'yyyy-MM-dd');
      const targetDateStr = format(selectedDate, 'yyyy-MM-dd');
      
      const sourceItems = db.getAllSync(`SELECT * FROM study_routines WHERE date = ?`, [sourceDateStr]) as any[];
      
      if (sourceItems.length === 0) {
        Alert.alert('No Items', 'No routine found on the source date.');
        return;
      }

      sourceItems.forEach(item => {
        const id = generateUUID();
        const payload = { ...item, id, date: targetDateStr, is_completed: 0, created_at: new Date().toISOString() };
        delete payload.rowid;
        db.runSync(`INSERT INTO study_routines (id, user_id, title, description, start_time, end_time, date, is_completed, for_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [payload.id, payload.user_id, payload.title, payload.description, payload.start_time, payload.end_time, payload.date, payload.is_completed, payload.for_user || null, payload.created_at]);
        queueSyncOperation('study_routines', id, 'INSERT', payload);
      });

      setIsCopyModalVisible(false);
      refreshRoutinesFromSQLite();
      Alert.alert('Success', `Copied ${sourceItems.length} items to ${targetDateStr}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {}
  };

  const fetchData = async (userId: string) => {
    try {
      const { data: deckData } = await supabase.from('study_decks').select('*, study_cards(count)').order('created_at', { ascending: false });
      if (deckData) deckData.forEach(d => db.runSync(`INSERT OR REPLACE INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [d.id, d.title, d.description, d.color, d.user_id, d.created_at]));
      const { data: boardData } = await supabase.from('study_whiteboards').select('*').order('updated_at', { ascending: false });
      if (boardData) boardData.forEach(b => db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, [b.id, b.title, typeof b.canvas_data === 'string' ? b.canvas_data : JSON.stringify(b.canvas_data), b.updated_at]));
      const { data: examData } = await supabase.from('study_exams').select('*');
      if (examData) examData.forEach(e => db.runSync(`INSERT OR REPLACE INTO study_exams (id, title, exam_date, start_date, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [e.id, e.title, e.exam_date, e.start_date, e.user_id, e.created_at]));
      const { data: dumpData } = await supabase.from('study_brain_dump').select('*').eq('is_processed', 0);
      if (dumpData) dumpData.forEach(b => db.runSync(`INSERT OR REPLACE INTO study_brain_dump (id, content, user_id, is_processed, created_at) VALUES (?, ?, ?, ?, ?)`, [b.id, b.content, b.user_id, b.is_processed, b.created_at]));
      const { data: syllabusData } = await supabase.from('study_syllabus').select('*');
      if (syllabusData) syllabusData.forEach(s => db.runSync(`INSERT OR REPLACE INTO study_syllabus (id, parent_id, title, theory_status, practical_status, theory_last_reviewed, practical_last_reviewed, user_id, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [s.id, s.parent_id, s.title, s.theory_status, s.practical_status, s.theory_last_reviewed, s.practical_last_reviewed, s.user_id, s.order_index, s.created_at]));
      refreshFromSQLite();
    } catch (e) {}
  };

  const fetchActiveSessions = async () => {
    const { data } = await supabase.from('active_study_sessions').select('*');
    if (data) {
      const mySession = data.find(s => s.user_id === currentUser);
      const herSession = data.find(s => s.user_id !== currentUser);
      if (mySession) {
        if (mySession.is_paused) { setIsTimerPaused(true); setTimeLeft(mySession.time_left); setIsTimerStarted(true); } 
        else {
          const elapsed = Math.floor((new Date().getTime() - new Date(mySession.start_time).getTime()) / 1000);
          const remaining = (mySession.duration_minutes * 60) - elapsed;
          if (remaining > 0) { setTimeLeft(remaining); setSelectedDuration(mySession.duration_minutes); setIsTimerStarted(true); setIsTimerPaused(false); }
          else handleTimerComplete();
        }
      } else { setIsTimerStarted(false); setIsTimerPaused(false); }
      setPartnerSession(herSession || null);
    }
  };

  useEffect(() => {
    if (isTimerRunning && !isTimerPaused && timeLeft > 0) timerRef.current = setInterval(() => setTimeLeft(t => t - 1), 1000);
    else if (timerRef.current) clearInterval(timerRef.current);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerRunning, isTimerPaused, timeLeft]);

  const handleTimerComplete = async () => {
    setIsTimerStarted(false); setIsTimerPaused(false); setTimeLeft(selectedDuration * 60);
    await supabase.from('active_study_sessions').delete().eq('user_id', currentUser);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("🎉 Session Complete!", "Great job focusing!");
    const today = format(new Date(), 'yyyy-MM-dd');
    db.runSync(`INSERT OR IGNORE INTO study_habit_log (id, date, user_id) VALUES (?, ?, ?)`, [generateUUID(), today, currentUser]);
    db.runSync(`UPDATE study_habit_log SET focus_minutes = focus_minutes + ? WHERE date = ?`, [selectedDuration, today]);
    await supabase.from('focus_sessions').insert([{ user_id: currentUser, duration_minutes: selectedDuration }]);
    fetchActiveSessions(); refreshFromSQLite();
  };

  const toggleTimer = async () => {
    if (!isTimerRunning) {
      const { error } = await supabase.from('active_study_sessions').upsert({ user_id: currentUser, start_time: new Date().toISOString(), duration_minutes: selectedDuration, is_paused: 0 });
      if (!error) { setTimeLeft(selectedDuration * 60); setIsTimerStarted(true); setIsTimerPaused(false); setIsTimerModalVisible(false); }
    } else {
      Alert.alert("Abandon Session?", "Focus time won't be saved.", [
        { text: "Cancel" },
        { text: "Abandon", style: 'destructive', onPress: async () => {
          await supabase.from('active_study_sessions').delete().eq('user_id', currentUser);
          setIsTimerStarted(false); setIsTimerPaused(false); setTimeLeft(selectedDuration * 60); fetchActiveSessions();
        }}
      ]);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const togglePause = async () => {
    const nextPaused = !isTimerPaused;
    setIsTimerPaused(nextPaused);
    await supabase.from('active_study_sessions').update({ is_paused: nextPaused ? 1 : 0, time_left: timeLeft }).eq('user_id', currentUser);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const startNap = () => { if (isTimerRunning && !isTimerPaused) togglePause(); setIsNapping(true); setIsTimerModalVisible(false); setNapStartTime(new Date()); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };

  const endNap = async () => {
    if (!napStartTime) return;
    const end = new Date();
    const duration = differenceInMinutes(end, napStartTime);
    const id = generateUUID();
    const payload = { id, user_id: currentUser, start_time: napStartTime.toISOString(), end_time: end.toISOString(), duration_minutes: duration, created_at: end.toISOString() };
    db.runSync(`INSERT INTO study_naps (id, user_id, start_time, end_time, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [id, payload.user_id, payload.start_time, payload.end_time, payload.duration_minutes, payload.created_at]);
    queueSyncOperation('study_naps', id, 'INSERT', payload);
    setIsNapping(false); setNapStartTime(null); Alert.alert("Recovery Complete", `You rested for ${duration} minutes. Stay sharp!`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const adjustTimer = (mins: number) => { const next = Math.max(1, Math.min(180, selectedDuration + mins)); setSelectedDuration(next); setTimeLeft(next * 60); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const formatTime = (seconds: number) => { const mins = Math.floor(Math.max(0, seconds) / 60); const secs = Math.max(0, seconds) % 60; return `${mins}:${secs < 10 ? '0' : ''}${secs}`; };

  const createDeck = async () => {
    if (!newDeckTitle.trim()) return;
    const id = generateUUID();
    const payload = { id, title: newDeckTitle.trim(), description: newDeckDesc.trim(), user_id: currentUser, created_at: new Date().toISOString() };
    db.runSync(`INSERT INTO study_decks (id, title, description, user_id, created_at) VALUES (?, ?, ?, ?, ?)`, [payload.id, payload.title, payload.description, payload.user_id, payload.created_at]);
    queueSyncOperation('study_decks', payload.id, 'INSERT', payload);
    setIsDeckModalVisible(false); setNewDeckTitle(''); setNewDeckDesc(''); refreshFromSQLite();
  };

  const createWhiteboard = async () => {
    if (!newWhiteboardTitle.trim()) return;
    const id = generateUUID();
    const payload = { id, title: newWhiteboardTitle.trim(), user_id: currentUser, updated_at: new Date().toISOString() };
    db.runSync(`INSERT INTO study_whiteboards (id, title, user_id, updated_at) VALUES (?, ?, ?, ?)`, [payload.id, payload.title, payload.user_id, payload.updated_at]);
    queueSyncOperation('study_whiteboards', payload.id, 'INSERT', payload);
    setIsWhiteboardModalVisible(false); setNewWhiteboardTitle(''); refreshFromSQLite();
    router.push(`/study-hub/whiteboard/${payload.id}`);
  };

  const addExam = async () => {
    if (!examTitle.trim()) return;
    const id = generateUUID();
    const formattedDate = format(examDate, 'yyyy-MM-dd');
    const examPayload = { id, title: examTitle.trim(), exam_date: formattedDate, start_date: format(new Date(), 'yyyy-MM-dd'), user_id: currentUser, created_at: new Date().toISOString() };
    db.runSync(`INSERT INTO study_exams (id, title, exam_date, start_date, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [examPayload.id, examPayload.title, examPayload.exam_date, examPayload.start_date, examPayload.user_id, examPayload.created_at]);
    queueSyncOperation('study_exams', examPayload.id, 'INSERT', examPayload);
    const calPayload = { id, event_date: formattedDate, title: `📚 EXAM: ${examTitle.trim()}`, user_id: currentUser, frequency: 'once', created_at: new Date().toISOString() };
    db.runSync(`INSERT INTO calendar_events (id, event_date, title, user_id, frequency, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [calPayload.id, calPayload.event_date, calPayload.title, calPayload.user_id, calPayload.frequency, calPayload.created_at]);
    queueSyncOperation('calendar_events', calPayload.id, 'INSERT', calPayload);
    setIsExamModalVisible(false); setExamTitle(''); setExamDate(new Date()); refreshFromSQLite();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const addBrainDump = async () => {
    if (!dumpContent.trim()) return;
    const id = editingDumpId || generateUUID();
    const payload = { id, content: dumpContent.trim(), user_id: currentUser, is_processed: 0, created_at: new Date().toISOString() };
    if (editingDumpId) { db.runSync(`UPDATE study_brain_dump SET content = ? WHERE id = ?`, [dumpContent.trim(), id]); queueSyncOperation('study_brain_dump', id, 'UPDATE', { content: dumpContent.trim() }); }
    else { db.runSync(`INSERT INTO study_brain_dump (id, content, user_id, is_processed, created_at) VALUES (?, ?, ?, ?, ?)`, [id, payload.content, payload.user_id, payload.is_processed, payload.created_at]); queueSyncOperation('study_brain_dump', id, 'INSERT', payload); }
    setIsDumpModalVisible(false); setDumpContent(''); setEditingDumpId(null); refreshFromSQLite();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const onDateChange = (event: any, selectedDate?: Date) => { const currentDate = selectedDate || examDate; setShowDatePicker(Platform.OS === 'ios'); setExamDate(currentDate); };

  const filteredDecks = useMemo(() => {
    if (!searchQuery.trim()) return decks;
    const q = searchQuery.toLowerCase();
    return decks.filter(d => d.title?.toLowerCase().includes(q) || d.description?.toLowerCase().includes(q));
  }, [decks, searchQuery]);

  const filteredWhiteboards = useMemo(() => {
    if (!searchQuery.trim()) return whiteboards;
    const q = searchQuery.toLowerCase();
    return whiteboards.filter(w => w.title?.toLowerCase().includes(q));
  }, [whiteboards, searchQuery]);

  const heatmapData = useMemo(() => {
    const last30Days = eachDayOfInterval({ start: subDays(startOfToday(), 29), end: startOfToday() });
    return last30Days.map(date => {
      const dayStr = format(date, 'yyyy-MM-dd');
      const entry = habitLog.find(h => h.date === dayStr);
      return { date, count: entry ? (entry.completed_tasks + entry.focus_minutes / 10 + entry.cards_reviewed / 5) : 0 };
    });
  }, [habitLog]);

  const syllabusProgress = useMemo(() => {
    if (syllabus.length === 0) return 0;
    const leafNodes = syllabus.filter(item => !syllabus.some(s => s.parent_id === item.id));
    if (leafNodes.length === 0) return 0;
    const totalChecks = leafNodes.length * 2;
    const completedChecks = leafNodes.reduce((acc, curr) => {
      let count = 0;
      if (curr.theory_status === 'done' || curr.theory_status === 'revised') count++;
      if (curr.practical_status === 'done' || curr.practical_status === 'revised') count++;
      return acc + count;
    }, 0);
    return Math.round((completedChecks / totalChecks) * 100);
  }, [syllabus]);

  // ───────── TOOLS RAIL ─────────
  const defaultTools = React.useMemo(() => ([
    { key: 'syllabus',    label: 'Syllabus',    color: '#AF52DE', icon: <ListChecks size={22} color="#AF52DE" />,    onPress: () => router.push('/study-hub/syllabus'),       badge: null as number | null },
    { key: 'flashcards',  label: 'Flashcards',  color: '#FF2D55', icon: <BrainCircuit size={22} color="#FF2D55" />,  onPress: () => router.push('/study-hub'),                badge: null },
    { key: 'whiteboards', label: 'Boards',      color: '#5856D6', icon: <PenTool size={22} color="#5856D6" />,       onPress: () => setIsWhiteboardModalVisible(true),        badge: null },
    { key: 'anatomy',     label: 'Anatomy',     color: '#0AE',    icon: <BookOpen size={22} color="#0AE" />,         onPress: () => router.push('/study-hub/anatomy'),        badge: null },
    { key: 'memory',      label: 'Memory',      color: '#FFD60A', icon: <Sparkles size={22} color="#FFD60A" />,      onPress: () => router.push('/study-hub/memories'),       badge: null },
    { key: 'braindump',   label: 'Brain Dump',  color: '#34C759', icon: <Bot size={22} color="#34C759" />,           onPress: () => setIsDumpModalVisible(true),              badge: null },
  ]), [router]);

  const orderedTools = React.useMemo(() => {
    if (!toolsOrder || toolsOrder.length === 0) return defaultTools;
    const map = new Map(defaultTools.map(t => [t.key, t]));
    const out: typeof defaultTools = [];
    toolsOrder.forEach(k => { const t = map.get(k); if (t) { out.push(t); map.delete(k); } });
    map.forEach(t => out.push(t));
    return out;
  }, [defaultTools, toolsOrder]);

  React.useEffect(() => {
    try {
      const row = db.getFirstSync(`SELECT value FROM system_config WHERE key = 'study_tools_order'`) as any;
      if (row?.value) setToolsOrder(JSON.parse(row.value));
    } catch {}
  }, []);

  const promoteTool = (key: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const current = orderedTools.map(t => t.key);
    const next = [key, ...current.filter(k => k !== key)];
    setToolsOrder(next);
    try {
      const value = JSON.stringify(next);
      const now = new Date().toISOString();
      db.runSync(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('study_tools_order', ?, ?)`, [value, now]);
      queueSyncOperation('system_config', 'study_tools_order', 'UPDATE', { key: 'study_tools_order', value, updated_at: now });
    } catch {}
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}><Text style={[styles.title, { color: theme.text }]}>Study Hub</Text><Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Exam Mode Activated 🧠</Text></View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity onPress={() => { setIsSearchVisible(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[styles.headerBtn, { backgroundColor: theme.card }]}><SearchIcon size={22} color={theme.text} /></TouchableOpacity>
          <TouchableOpacity onPress={() => setIsTimerModalVisible(true)} style={[styles.headerBtn, { backgroundColor: isTimerRunning ? (isTimerPaused ? '#FFCC00' : '#FF2D55') : theme.card }]}><Clock size={22} color={isTimerRunning ? '#fff' : theme.text} /></TouchableOpacity>
          <TouchableOpacity onPress={() => setIsActionsSheetOpen(true)} style={[styles.headerBtn, { backgroundColor: theme.tint }]}><Plus size={22} color="#fff" /></TouchableOpacity>
        </View>
      </View>

      <AnimatePresence>{isSearchVisible && (<MotiView from={{ opacity: 0, translateY: -20 }} animate={{ opacity: 1, translateY: 0 }} exit={{ opacity: 0, translateY: -20 }} style={[styles.searchOverlay, { backgroundColor: theme.card }]}><SearchIcon size={18} color={theme.tabIconDefault} /><TextInput style={[styles.searchInput, { color: theme.text }]} placeholder="Search everything..." placeholderTextColor={theme.tabIconDefault} autoFocus value={searchQuery} onChangeText={setSearchQuery} /><TouchableOpacity onPress={() => { setIsSearchVisible(false); setSearchQuery(''); }} style={styles.closeSearch}><X size={20} color={theme.text} /></TouchableOpacity></MotiView>)}</AnimatePresence>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {partnerSession && partnerSession.user_id !== currentUser && (
          <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.partnerCard, { backgroundColor: '#FF2D55' }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Bell size={18} color="#fff" /><Text style={styles.partnerText}>Partner is studying right now! ❤️</Text></View></MotiView>
        )}

        <AnimatePresence>
          {(isTimerRunning || isNapping) && (
            <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} style={[styles.activeTimerCard, { backgroundColor: isNapping ? '#AF52DE' : (isTimerPaused ? '#FFCC00' : '#FF2D55') }]}>
              <View style={styles.activeTimerTop}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>{isNapping ? <Moon size={24} color="#fff" /> : <Clock size={24} color="#fff" />}<Text style={styles.activeTimerLabel}>{isNapping ? 'POWER NAP' : (isTimerPaused ? 'PAUSED' : 'FOCUSING')}</Text></View><Text style={styles.activeTimerValue}>{isNapping ? 'RECOVERING' : formatTime(timeLeft)}</Text></View>
              <View style={styles.activeTimerActions}>{isNapping ? (<TouchableOpacity onPress={endNap} style={styles.activeBtn}><Text style={styles.activeBtnText}>WAKE UP</Text></TouchableOpacity>) : (<><TouchableOpacity onPress={togglePause} style={styles.activeBtn}>{isTimerPaused ? <Play size={20} color="#fff" /> : <Pause size={20} color="#fff" />}</TouchableOpacity><TouchableOpacity onPress={toggleTimer} style={styles.activeBtn}><X size={20} color="#fff" /></TouchableOpacity></>)}</View>
            </MotiView>
          )}
        </AnimatePresence>

        <TouchableOpacity style={[styles.buddyCard, { backgroundColor: theme.card }]} onPress={() => router.push('/study-hub/buddy')}>
          <View style={styles.buddyHeader}>
            <View style={[styles.buddyAvatar, { backgroundColor: '#AF52DE15' }]}><Bot size={24} color="#AF52DE" /></View>
            <View style={{ flex: 1 }}><Text style={[styles.cardTitle, { color: theme.text, marginBottom: 2 }]}>Study Buddy</Text><Text style={styles.buddyStatus}>Always active for you</Text></View>
            <Sparkles size={18} color="#AF52DE" />
          </View>
          <View style={styles.boostContainer}>{loadingBoost ? <ActivityIndicator size="small" color="#AF52DE" /> : <Text style={styles.boostText}>"{aiBoost}"</Text>}</View>
          <View style={styles.buddyFooter}><Text style={styles.buddyAction}>TAP TO CHAT</Text><ChevronRight size={14} color="#AF52DE" /></View>
        </TouchableOpacity>

        {/* Tools rail — every feature 1 tap, no vertical clutter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolsRail}>
          {orderedTools.map(tool => (
            <TouchableOpacity
              key={tool.key}
              onPress={tool.onPress}
              onLongPress={() => promoteTool(tool.key)}
              delayLongPress={350}
              style={[styles.toolChip, { backgroundColor: theme.card }]}
              activeOpacity={0.75}
            >
              <View style={[styles.toolIconWrap, { backgroundColor: tool.color + '20' }]}>{tool.icon}</View>
              <Text style={[styles.toolChipLabel, { color: theme.text }]} numberOfLines={1}>{tool.label}</Text>
              {tool.badge != null && tool.badge > 0 && (
                <View style={[styles.toolBadge, { backgroundColor: tool.color }]}><Text style={styles.toolBadgeText}>{tool.badge}</Text></View>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Syllabus progress strip — compact, lives under the rail */}
        <TouchableOpacity style={[styles.syllabusStrip, { backgroundColor: theme.card }]} onPress={() => router.push('/study-hub/syllabus')}>
          <ListChecks size={16} color="#AF52DE" />
          <Text style={[styles.syllabusStripText, { color: theme.text }]}>Syllabus · {syllabus.length} topics</Text>
          <View style={styles.syllabusStripBar}><View style={[styles.syllabusStripFill, { width: `${syllabusProgress}%` }]} /></View>
          <Text style={[styles.syllabusStripPct, { color: '#AF52DE' }]}>{syllabusProgress}%</Text>
        </TouchableOpacity>

        {/* STUDY ROUTINE SECTION */}
        <View style={styles.sectionHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CalendarDays color={theme.tint} size={24} />
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Study Routine</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => setIsCopyModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.secondary + '20' }]}>
              <Copy size={18} color={theme.secondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsRoutineModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}>
              <Plus size={20} color={theme.tint} />
            </TouchableOpacity>
          </View>
        </View>

        {/* MONTH GRID CALENDAR */}
        <View style={[styles.calendarGridContainer, { backgroundColor: theme.card }]}>
          <View style={styles.calendarHeaderNav}>
            <TouchableOpacity onPress={() => setViewMonth(subMonths(viewMonth, 1))}><ChevronLeft size={20} color={theme.text} /></TouchableOpacity>
            <Text style={[styles.calendarMonthText, { color: theme.text }]}>{format(viewMonth, 'MMMM yyyy')}</Text>
            <TouchableOpacity onPress={() => setViewMonth(addMonths(viewMonth, 1))}><ChevronRight size={20} color={theme.text} /></TouchableOpacity>
          </View>
          
          <View style={styles.weekDaysHeader}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
              <Text key={i} style={styles.weekDayText}>{day}</Text>
            ))}
          </View>

          <View style={styles.daysGrid}>
            {calendarDays.map((date, i) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isSelected = isSameDay(date, selectedDate);
              const isCurrentMonth = date.getMonth() === viewMonth.getMonth();
              const count = routineCounts[dateStr] || 0;
              const isToday = isSameDay(date, startOfToday());

              return (
                <TouchableOpacity 
                  key={i} 
                  onPress={() => { setSelectedDate(date); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  style={[
                    styles.gridDay, 
                    isSelected && { backgroundColor: theme.tint, borderRadius: 12 },
                    !isCurrentMonth && { opacity: 0.3 }
                  ]}
                >
                  <Text style={[
                    styles.gridDayText, 
                    { color: isSelected ? '#fff' : theme.text },
                    isToday && !isSelected && { color: theme.tint, fontWeight: '900' }
                  ]}>
                    {format(date, 'd')}
                  </Text>
                  {count > 0 && (
                    <View style={[styles.gridCountBadge, { backgroundColor: isSelected ? '#fff' : theme.tint }]}>
                      <Text style={[styles.gridCountText, { color: isSelected ? theme.tint : '#fff' }]}>{count}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={[styles.routineList, { backgroundColor: theme.card }]}>
          <Text style={styles.routineDateHeader}>{isSameDay(selectedDate, startOfToday()) ? 'Today' : format(selectedDate, 'PPPP')}</Text>
          {routines.map(item => (
            <View key={item.id} style={styles.routineItem}>
              <TouchableOpacity onPress={() => toggleRoutineComplete(item.id, item.is_completed)} style={[styles.routineCheck, item.is_completed === 1 && { backgroundColor: '#34C759', borderColor: '#34C759' }]}>
                {item.is_completed === 1 && <Check size={14} color="#fff" />}
              </TouchableOpacity>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.routineTitle, { color: theme.text }, item.is_completed === 1 && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{item.title}</Text>
                  {(() => {
                    const audience = (item.for_user || item.user_id || '').toLowerCase();
                    const badge = audience === 'both' ? 'BOTH' : displayName(audience).toUpperCase();
                    return (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: theme.tint + '20' }}>
                        <Text style={{ fontSize: 9, fontWeight: '900', color: theme.tint, letterSpacing: 0.5 }}>{badge}</Text>
                      </View>
                    );
                  })()}
                </View>
                <Text style={styles.routineTime}>{item.start_time} - {item.end_time}</Text>
              </View>
              <TouchableOpacity onPress={() => deleteRoutine(item.id)}>
                <Trash2 size={16} color="#FF3B30" opacity={0.5} />
              </TouchableOpacity>
            </View>
          ))}
          {routines.length === 0 && (
            <View style={styles.emptyRoutine}>
              <Text style={styles.emptyText}>No tasks planned for this day.</Text>
            </View>
          )}
        </View>

        <View style={styles.sectionHeader}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Calendar color={theme.tint} size={24} /><Text style={[styles.sectionTitle, { color: theme.text }]}>Exam Countdown</Text></View><TouchableOpacity onPress={() => setIsExamModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}><Plus size={20} color={theme.tint} /></TouchableOpacity></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 15, paddingBottom: 10 }}>{exams.map(exam => { const daysLeft = differenceInDays(new Date(exam.exam_date), startOfToday()); return (<TouchableOpacity key={exam.id} style={[styles.examCard, { backgroundColor: theme.card }]} onLongPress={() => { Alert.alert('Delete Exam?', 'Remove this countdown?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { db.runSync(`DELETE FROM study_exams WHERE id = ?`, [exam.id]); db.runSync(`DELETE FROM calendar_events WHERE id = ?`, [exam.id]); queueSyncOperation('study_exams', exam.id, 'DELETE', {}); queueSyncOperation('calendar_events', exam.id, 'DELETE', {}); refreshFromSQLite(); }}]); }}><Text style={[styles.examTitle, { color: theme.text }]}>{exam.title}</Text><Text style={[styles.examDays, { color: theme.tint }]}>{daysLeft} Days Left</Text><View style={styles.examProgressBase}><View style={[styles.examProgressFill, { backgroundColor: theme.tint, width: `${Math.min(100, Math.max(5, (1 - daysLeft/60) * 100))}%` }]} /></View></TouchableOpacity>); })}{exams.length === 0 && <Text style={styles.emptyText}>Add your next Prof exam!</Text>}</ScrollView>

        <View style={[styles.sectionHeader, { marginTop: 30 }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Flame color="#FF9500" size={24} /><Text style={[styles.sectionTitle, { color: theme.text }]}>Consistency Heatmap</Text></View></View>
        <View style={[styles.heatmapCard, { backgroundColor: theme.card }]}><View style={styles.heatmapGrid}>{heatmapData.map((d, i) => <View key={i} style={[styles.heatmapSquare, { backgroundColor: d.count > 0 ? `rgba(52, 199, 89, ${Math.min(1, d.count/10 + 0.2)})` : theme.background }]} />)}</View><Text style={styles.heatmapLabel}>Last 30 days of medical focus</Text></View>

        <View style={[styles.sectionHeader, { marginTop: 30 }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><MessageSquare color={theme.secondary} size={24} /><Text style={[styles.sectionTitle, { color: theme.text }]}>Brain Dump Inbox</Text></View><TouchableOpacity onPress={() => { setEditingDumpId(null); setDumpContent(''); setIsDumpModalVisible(true); }} style={[styles.addBtn, { backgroundColor: theme.secondary + '20' }]}><Plus size={20} color={theme.secondary} /></TouchableOpacity></View>
        <View style={[styles.dumpCard, { backgroundColor: theme.card }]}>
          {(showAllDumps ? brainDump : brainDump.slice(0, 3)).map(item => (
            <TouchableOpacity 
              key={item.id} 
              style={styles.dumpItem} 
              onPress={() => { setExpandedDumpId(expandedDumpId === item.id ? null : item.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <Text 
                style={[styles.dumpText, { color: theme.text }]} 
                numberOfLines={expandedDumpId === item.id ? undefined : 1}
              >
                {item.content}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={() => { setEditingDumpId(item.id); setDumpContent(item.content); setIsDumpModalVisible(true); }}>
                  <Edit3 size={18} color={theme.tabIconDefault} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { db.runSync(`UPDATE study_brain_dump SET is_processed = 1 WHERE id = ?`, [item.id]); queueSyncOperation('study_brain_dump', item.id, 'UPDATE', { is_processed: 1 }); refreshFromSQLite(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
                  <Check size={18} color="#34C759" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  Alert.alert('Delete Thought?', 'This will permanently remove this brain dump.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => {
                      db.runSync(`DELETE FROM study_brain_dump WHERE id = ?`, [item.id]);
                      queueSyncOperation('study_brain_dump', item.id, 'DELETE', {});
                      refreshFromSQLite();
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    }}
                  ]);
                }}>
                  <Trash2 size={18} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
          {brainDump.length > 3 && (
            <TouchableOpacity 
              onPress={() => { setShowAllDumps(!showAllDumps); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} 
              style={styles.showMoreBtn}
            >
              <Text style={[styles.showMoreText, { color: theme.secondary }]}>
                {showAllDumps ? 'Show Less' : `See All (${brainDump.length})`}
              </Text>
            </TouchableOpacity>
          )}
          {brainDump.length === 0 && <Text style={styles.emptyText}>Inbox is clean!</Text>}
        </View>

        <View style={[styles.sectionHeader, { marginTop: 40 }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><BookOpen color={theme.tint} size={24} /><Text style={[styles.sectionTitle, { color: theme.text }]}>Flashcard Decks</Text></View><TouchableOpacity onPress={() => setIsDeckModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}><Plus size={20} color={theme.tint} /></TouchableOpacity></View>
        <View style={styles.grid}>{filteredDecks.map(deck => (<TouchableOpacity key={deck.id} style={[styles.card, { backgroundColor: theme.card, borderTopColor: deck.color || theme.tint, borderTopWidth: 4 }]} onPress={() => router.push(`/study-hub/deck/${deck.id}`)} onLongPress={() => { Alert.alert('Delete Deck?', 'Remove this deck?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { db.runSync(`DELETE FROM study_decks WHERE id = ?`, [deck.id]); queueSyncOperation('study_decks', deck.id, 'DELETE', {}); refreshFromSQLite(); }}]); }}><Text style={[styles.cardTitle, { color: theme.text }]}>{deck.title}</Text><Text style={[styles.cardSub, { color: theme.tabIconDefault }]} numberOfLines={2}>{deck.description || "No description"}</Text></TouchableOpacity>))}</View>

        <View style={[styles.sectionHeader, { marginTop: 40 }]}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><PenTool color={theme.tint} size={24} /><Text style={[styles.sectionTitle, { color: theme.text }]}>Med-Boards</Text></View><TouchableOpacity onPress={() => setIsWhiteboardModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.tint + '20' }]}><Plus size={20} color={theme.tint} /></TouchableOpacity></View>
        <View style={styles.grid}>{filteredWhiteboards.map(board => (<TouchableOpacity key={board.id} style={[styles.card, { backgroundColor: theme.card }]} onPress={() => router.push(`/study-hub/whiteboard/${board.id}`)} onLongPress={() => { Alert.alert('Delete Board?', 'Remove this board?', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { db.runSync(`DELETE FROM study_whiteboards WHERE id = ?`, [board.id]); queueSyncOperation('study_whiteboards', board.id, 'DELETE', {}); refreshFromSQLite(); }}]); }}><View style={[styles.boardThumb, { backgroundColor: theme.tint + '10' }]}><LayoutDashboard size={32} color={theme.tint} opacity={0.5} /></View><Text style={[styles.cardTitle, { color: theme.text, marginTop: 10 }]}>{board.title}</Text></TouchableOpacity>))}</View>
      </ScrollView>

      <Modal visible={isTimerModalVisible} transparent animationType="slide"><View style={styles.modalOverlay}><BlurView intensity={100} tint={colorScheme} style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Focus Engine</Text><TouchableOpacity onPress={() => setIsTimerModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><View style={styles.timerPickerMain}><View style={styles.timerValues}><View style={styles.adjustRow}><TouchableOpacity onPress={() => adjustTimer(-5)} style={styles.adjustBtn}><Minus size={24} color={theme.text} /></TouchableOpacity><Text style={styles.timerLabel}>SET MINUTES</Text><TouchableOpacity onPress={() => adjustTimer(5)} style={styles.adjustBtn}><Plus size={24} color={theme.text} /></TouchableOpacity></View><Text style={[styles.bigTimerValue, { color: theme.text }]}>{selectedDuration}:00</Text></View></View><View style={styles.presetRow}>{[25, 45, 60, 90].map(p => (<TouchableOpacity key={p} onPress={() => { setSelectedDuration(p); setTimeLeft(p * 60); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }} style={[styles.presetBtn, selectedDuration === p && { backgroundColor: theme.tint }]}><Text style={[styles.presetText, { color: selectedDuration === p ? '#fff' : theme.tabIconDefault }]}>{p}m</Text></TouchableOpacity>))}</View><View style={{ flexDirection: 'row', gap: 15 }}><TouchableOpacity onPress={toggleTimer} style={[styles.saveBtn, { backgroundColor: theme.tint, flex: 2 }]}><Text style={styles.saveBtnText}>START FOCUSING</Text></TouchableOpacity><TouchableOpacity onPress={startNap} style={[styles.saveBtn, { backgroundColor: '#AF52DE', flex: 1 }]}><Moon size={24} color="#fff" /></TouchableOpacity></View></BlurView></View></Modal>
      <Modal visible={isDumpModalVisible} transparent animationType="fade"><TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setIsDumpModalVisible(false); }}><View style={styles.modalOverlay}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}><TouchableWithoutFeedback onPress={Keyboard.dismiss}><View style={[styles.modalContent, { backgroundColor: theme.card }]}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingDumpId ? 'Edit Thought' : 'Brain Dump'}</Text><TouchableOpacity onPress={() => setIsDumpModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text, height: 120, textAlignVertical: 'top' }]} placeholder="MNEMONICS, THOUGHTS..." multiline autoFocus value={dumpContent} onChangeText={setDumpContent} /><TouchableOpacity onPress={addBrainDump} style={[styles.saveBtn, { backgroundColor: theme.secondary }]}><Text style={styles.saveBtnText}>{editingDumpId ? 'SAVE CHANGES' : 'DUMP IT'}</Text></TouchableOpacity></View></TouchableWithoutFeedback></KeyboardAvoidingView></View></TouchableWithoutFeedback></Modal>
      <Modal visible={isDeckModalVisible} transparent animationType="fade"><TouchableWithoutFeedback onPress={Keyboard.dismiss}><View style={styles.modalOverlay}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}><BlurView intensity={100} tint={colorScheme} style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>New Study Deck</Text><TouchableOpacity onPress={() => setIsDeckModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Subject" placeholderTextColor={theme.tabIconDefault} value={newDeckTitle} onChangeText={setNewDeckTitle} /><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text, height: 100, textAlignVertical: 'top' }]} placeholder="Description" placeholderTextColor={theme.tabIconDefault} multiline value={newDeckDesc} onChangeText={setNewDeckDesc} /><TouchableOpacity onPress={createDeck} style={[styles.saveBtn, { backgroundColor: theme.tint }]}><Text style={styles.saveBtnText}>Create Deck</Text></TouchableOpacity></BlurView></KeyboardAvoidingView></View></TouchableWithoutFeedback></Modal>
      <Modal visible={isWhiteboardModalVisible} transparent animationType="fade"><TouchableWithoutFeedback onPress={Keyboard.dismiss}><View style={styles.modalOverlay}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}><BlurView intensity={100} tint={colorScheme} style={styles.modalContent}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>New Med-Board</Text><TouchableOpacity onPress={() => setIsWhiteboardModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Board Name" placeholderTextColor={theme.tabIconDefault} value={newWhiteboardTitle} onChangeText={setNewWhiteboardTitle} /><TouchableOpacity onPress={createWhiteboard} style={[styles.saveBtn, { backgroundColor: theme.tint }]}><Text style={styles.saveBtnText}>Create Board</Text></TouchableOpacity></BlurView></KeyboardAvoidingView></View></TouchableWithoutFeedback></Modal>
      <Modal visible={isExamModalVisible} transparent animationType="fade"><View style={styles.modalOverlay}><BlurView intensity={100} tint={colorScheme} style={styles.modalContent}><Text style={[styles.modalTitle, { color: theme.text }]}>Add Exam</Text><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Exam Title" value={examTitle} onChangeText={setExamTitle} /><TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.dateInput, { backgroundColor: theme.background }]}><Calendar size={20} color={theme.tint} /><Text style={{ color: theme.text, fontWeight: '600', marginLeft: 10 }}>{format(examDate, 'PPP')}</Text></TouchableOpacity>{showDatePicker && (<DateTimePicker value={examDate} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={onDateChange} minimumDate={new Date()} />)}<TouchableOpacity onPress={addExam} style={[styles.saveBtn, { backgroundColor: theme.tint, marginTop: 10 }]}><Text style={styles.saveBtnText}>Add countdown</Text></TouchableOpacity><TouchableOpacity onPress={() => setIsExamModalVisible(false)}><Text style={{ textAlign: 'center', color: '#888', marginTop: 10 }}>Cancel</Text></TouchableOpacity></BlurView></View></Modal>

      {/* NEW ROUTINE MODAL */}
      <Modal visible={isRoutineModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>New Study Task</Text>
              <TouchableOpacity onPress={() => setIsRoutineModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <TextInput 
                style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} 
                placeholder="Task (e.g., Read Patho)" 
                value={routineTitle} 
                onChangeText={setRoutineTitle} 
              />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => setShowStartTimePicker(true)} style={[styles.dateInput, { backgroundColor: theme.background, flex: 1 }]}>
                  <Clock size={16} color={theme.tint} />
                  <Text style={{ color: theme.text, marginLeft: 8 }}>{routineStart}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowEndTimePicker(true)} style={[styles.dateInput, { backgroundColor: theme.background, flex: 1 }]}>
                  <Clock size={16} color={theme.tint} />
                  <Text style={{ color: theme.text, marginLeft: 8 }}>{routineEnd}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>RECURRENCE</Text>
              <View style={styles.recurrenceRow}>
                {RECURRENCE_OPTIONS.map(opt => (
                  <TouchableOpacity 
                    key={opt.value} 
                    onPress={() => setRoutineRecurrence(opt.value)}
                    style={[styles.recurrenceBtn, routineRecurrence === opt.value && { backgroundColor: theme.tint }]}
                  >
                    <Text style={[styles.recurrenceText, { color: routineRecurrence === opt.value ? '#fff' : theme.tabIconDefault }]}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {showStartTimePicker && <DateTimePicker mode="time" is24Hour value={new Date()} onChange={(e, d) => { setShowStartTimePicker(false); if (d) setRoutineStart(format(d, 'HH:mm')); }} />}
              {showEndTimePicker && <DateTimePicker mode="time" is24Hour value={new Date()} onChange={(e, d) => { setShowEndTimePicker(false); if (d) setRoutineEnd(format(d, 'HH:mm')); }} />}

              <Text style={styles.modalLabel}>FOR</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                {(['me','partner','both'] as const).map(opt => {
                  const partnerKey = (currentUser || '').toLowerCase() === 'pratishth' ? 'love' : 'pratishth';
                  const label = opt === 'me' ? displayName(currentUser) : opt === 'partner' ? displayName(partnerKey) : 'Both';
                  const active = routineFor === opt;
                  return (
                    <TouchableOpacity key={opt} onPress={() => setRoutineFor(opt)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: active ? theme.tint : theme.background, borderWidth: 1, borderColor: theme.tint + '40', alignItems: 'center' }}>
                      <Text style={{ color: active ? '#fff' : theme.text, fontWeight: '700', fontSize: 12 }}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity onPress={addStudyRoutine} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                <Text style={styles.saveBtnText}>Save Task</Text>
              </TouchableOpacity>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>

      {/* COPY ROUTINE MODAL */}
      <Modal visible={isCopyModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Copy Day Plan</Text>
              <TouchableOpacity onPress={() => setIsCopyModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <Text style={{ color: theme.tabIconDefault, marginBottom: 15 }}>Pick a source day to copy tasks from.</Text>
            <TouchableOpacity onPress={() => setShowCopyDatePicker(true)} style={[styles.dateInput, { backgroundColor: theme.background }]}>
              <Calendar size={20} color={theme.secondary} />
              <Text style={{ color: theme.text, fontWeight: '600', marginLeft: 10 }}>{format(copySourceDate, 'PPP')}</Text>
            </TouchableOpacity>
            {showCopyDatePicker && <DateTimePicker value={copySourceDate} mode="date" display="inline" onChange={(e, d) => { setShowCopyDatePicker(false); if (d) setCopySourceDate(d); }} />}
            
            <TouchableOpacity onPress={copyRoutineFromDay} style={[styles.saveBtn, { backgroundColor: theme.secondary, marginTop: 20 }]}>
              <Text style={styles.saveBtnText}>Duplicate to {format(selectedDate, 'MMM d')}</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      </Modal>

      {/* Unified "+" actions sheet — replaces scattered add buttons */}
      <Modal visible={isActionsSheetOpen} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={() => setIsActionsSheetOpen(false)}>
        <Pressable style={styles.actionsScrim} onPress={() => setIsActionsSheetOpen(false)}>
          <Pressable style={[styles.actionsCard, { backgroundColor: theme.background }]} onPress={() => {}}>
            <View style={styles.actionsHandle} />
            <Text style={[styles.actionsTitle, { color: theme.text }]}>Create something</Text>
            {[
              { label: 'Brain dump',        icon: <Bot size={20} color="#34C759" />,      color: '#34C759', open: () => setIsDumpModalVisible(true) },
              { label: 'Buddy memory',      icon: <Sparkles size={20} color="#FFD60A" />, color: '#FFD60A', open: () => router.push('/study-hub/memories') },
              { label: 'Anatomy reference', icon: <BookOpen size={20} color="#0AE" />,    color: '#0AE',    open: () => router.push('/study-hub/anatomy') },
            ].map((a, i) => (
              <TouchableOpacity key={i} onPress={() => { setIsActionsSheetOpen(false); setTimeout(a.open, 200); }} style={[styles.actionRow, { borderColor: theme.tabIconDefault + '20' }]}>
                <View style={[styles.actionIcon, { backgroundColor: a.color + '20' }]}>{a.icon}</View>
                <Text style={[styles.actionLabel, { color: theme.text }]}>{a.label}</Text>
                <ChevronRight size={18} color={theme.tabIconDefault} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setIsActionsSheetOpen(false)} style={styles.actionsCancel}>
              <Text style={{ color: theme.tabIconDefault, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <RadialNavigator />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 34, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 16, fontWeight: '600' },
  headerBtn: { width: 44, height: 44, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  searchOverlay: { position: 'absolute', top: 60, left: 20, right: 20, zIndex: 1000, height: 55, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15, elevation: 5 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 16, fontWeight: '600' },
  closeSearch: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20, paddingBottom: 100 },
  toolsRail: { gap: 12, paddingVertical: 12, paddingRight: 8 },
  toolChip: { width: 86, paddingVertical: 14, alignItems: 'center', borderRadius: 20, gap: 6, elevation: 1 },
  toolIconWrap: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  toolChipLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  toolBadge: { position: 'absolute', top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  toolBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  syllabusStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, marginTop: 4, marginBottom: 20 },
  syllabusStripText: { fontSize: 13, fontWeight: '800', flex: 0 },
  syllabusStripBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(150,150,150,0.2)', overflow: 'hidden' },
  syllabusStripFill: { height: '100%', backgroundColor: '#AF52DE', borderRadius: 3 },
  syllabusStripPct: { fontSize: 12, fontWeight: '900', minWidth: 38, textAlign: 'right' },
  actionsScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  actionsCard: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingTop: 12, paddingBottom: 36 },
  actionsHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(120,120,120,0.4)', alignSelf: 'center', marginBottom: 14 },
  actionsTitle: { fontSize: 18, fontWeight: '900', marginBottom: 14 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1 },
  actionIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
  actionsCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  syllabusCard: { padding: 20, borderRadius: 28, marginBottom: 25, elevation: 4 },
  syllabusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  progressCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  progressText: { fontSize: 12, fontWeight: '900' },
  syllabusProgressBar: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, overflow: 'hidden' },
  syllabusProgressFill: { height: '100%', borderRadius: 3 },
  activeTimerCard: { padding: 20, borderRadius: 30, marginBottom: 25, elevation: 10 },
  activeTimerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  activeTimerLabel: { color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: 2 },
  activeTimerValue: { color: 'white', fontSize: 28, fontWeight: '900' },
  activeTimerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 15, marginTop: 15 },
  activeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  timerPickerMain: { alignItems: 'center', marginVertical: 30 },
  timerValues: { alignItems: 'center' },
  bigTimerValue: { fontSize: 64, fontWeight: '900', letterSpacing: -2 },
  timerLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 2 },
  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginBottom: 10 },
  adjustBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  presetRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 30 },
  presetBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.03)' },
  presetText: { fontSize: 14, fontWeight: '800' },
  buddyCard: { padding: 20, borderRadius: 30, marginBottom: 25, elevation: 4 },
  buddyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 15 },
  buddyAvatar: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  buddyStatus: { fontSize: 11, fontWeight: '700', color: '#888' },
  boostContainer: { backgroundColor: 'rgba(0,0,0,0.02)', padding: 15, borderRadius: 20, marginBottom: 15 },
  boostText: { fontSize: 14, fontWeight: '600', color: '#555', fontStyle: 'italic', lineHeight: 20 },
  buddyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  buddyAction: { fontSize: 10, fontWeight: '900', color: '#AF52DE', letterSpacing: 1 },
  partnerCard: { padding: 15, borderRadius: 20, marginBottom: 20 },
  partnerText: { color: 'white', fontWeight: '900', fontSize: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  addBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  examCard: { width: 200, padding: 20, borderRadius: 24, elevation: 2 },
  examTitle: { fontSize: 16, fontWeight: '800', marginBottom: 5 },
  examDays: { fontSize: 20, fontWeight: '900' },
  examProgressBase: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  examProgressFill: { height: '100%', borderRadius: 3 },
  heatmapCard: { padding: 20, borderRadius: 24, marginBottom: 10 },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatmapSquare: { width: 12, height: 12, borderRadius: 2 },
  heatmapLabel: { fontSize: 10, color: '#888', marginTop: 10, textAlign: 'center' },
  dumpCard: { padding: 12, borderRadius: 24, elevation: 2 },
  dumpItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)' },
  dumpText: { flex: 1, fontSize: 14, fontWeight: '600', marginRight: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15 },
  card: { width: '47%', padding: 20, borderRadius: 24, elevation: 4 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardSub: { fontSize: 11, fontWeight: '500', opacity: 0.7 },
  boardThumb: { width: '100%', height: 80, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  statIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#888', fontStyle: 'italic', padding: 10 },
  showMoreBtn: { paddingVertical: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.03)', marginTop: 5 },
  showMoreText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  calendarGridContainer: { padding: 15, borderRadius: 24, marginBottom: 25, elevation: 2 },
  calendarHeaderNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, paddingHorizontal: 5 },
  calendarMonthText: { fontSize: 16, fontWeight: '800' },
  weekDaysHeader: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 10 },
  weekDayText: { width: '14.28%', textAlign: 'center', fontSize: 10, fontWeight: '900', color: '#888' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  gridDay: { width: '14.28%', height: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 5 },
  gridDayText: { fontSize: 14, fontWeight: '600' },
  gridCountBadge: { position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: 7, justifyContent: 'center', alignItems: 'center' },
  gridCountText: { fontSize: 8, fontWeight: '900' },
  routineList: { padding: 20, borderRadius: 24, marginBottom: 30 },
  routineDateHeader: { fontSize: 14, fontWeight: '800', color: '#888', marginBottom: 15 },
  routineItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  routineCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center' },
  routineTitle: { fontSize: 15, fontWeight: '700' },
  routineTime: { fontSize: 11, color: '#888', fontWeight: '600' },
  emptyRoutine: { alignItems: 'center', paddingVertical: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { padding: 30, borderTopLeftRadius: 40, borderTopRightRadius: 40, gap: 15 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  modalLabel: { fontSize: 10, fontWeight: '900', color: '#888', marginTop: 10, letterSpacing: 1 },
  recurrenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 5 },
  recurrenceBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.03)' },
  recurrenceText: { fontSize: 11, fontWeight: '800' },
  input: { padding: 20, borderRadius: 20, fontSize: 16, fontWeight: '600' },
  dateInput: { padding: 20, borderRadius: 20, flexDirection: 'row', alignItems: 'center' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
