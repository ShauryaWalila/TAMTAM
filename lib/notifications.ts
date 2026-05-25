import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, DeviceEventEmitter } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { db } from './db';
import { addWeeks, addMonths, addYears, set, isAfter, startOfDay, isBefore, setDay } from 'date-fns';
import * as SecureStore from 'expo-secure-store';

// Single event channel. Any time a reminder-source row is created / edited /
// deleted, callers should emit 'reminders-changed' — a debounced listener
// (registered in app/_layout.tsx) calls syncAllNotifications.
export const REMINDERS_CHANGED = 'reminders-changed';
export const emitRemindersChanged = () => {
  try { DeviceEventEmitter.emit(REMINDERS_CHANGED); } catch {}
};

export async function registerForPushNotificationsAsync() {
  let token;
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Notification permissions not granted');
      return;
    }

    // Remote push (Expo Push Service / APNs) requires the `aps-environment`
    // entitlement, which a free Apple Developer account cannot sign. Skip the
    // push-token registration entirely. LOCAL notifications (scheduled time,
    // calendar, and geofence-triggered) still work fine - they go through
    // UNUserNotificationCenter which is free.
    // const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    // if (projectId && !projectId.includes('77777777')) {
    //   try { token = (await Notifications.getExpoPushTokenAsync({ projectId })).data; } catch (e) {}
    // }
  } else {
    // alert('Must use physical device for Push Notifications');
  }

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return token;
}

export async function syncAllNotifications() {
  console.log('Syncing all notifications from local DB...');
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const scheduleMap: Record<string, { starts: any[], ends: any[] }> = {};

  const addToMap = (time: Date, item: any, isStart: boolean) => {
    const key = time.toISOString().substring(0, 16); // Minute precision
    if (!scheduleMap[key]) scheduleMap[key] = { starts: [], ends: [] };
    if (isStart) scheduleMap[key].starts.push(item);
    else scheduleMap[key].ends.push(item);
  };

  try {
    // 1. GATHER ALL EVENTS FROM LOCAL SQLITE
    const reminders = db.getAllSync(`SELECT * FROM chill_items WHERE type = 'reminder'`) as any[];
    if (reminders) {
      for (const item of reminders) {
        let content = item.content;
        if (typeof content === 'string') { try { content = JSON.parse(content); } catch(e) {} }
        if (content.active && content.remType === 'time' && content.start_at) {
          addToMap(new Date(content.start_at), { ...item, title: item.title, type: 'reminder' }, true);
          if (content.end_at) addToMap(new Date(content.end_at), { ...item, title: item.title, type: 'reminder' }, false);
        }
      }
    }

    // Resolve current device user for audience filter. Schedule a routine row
    // only if its for_user matches this device, partner-set-for-me, or 'both'.
    // Legacy rows (for_user IS NULL) default to creator (user_id).
    let me = '';
    try { me = (await SecureStore.getItemAsync('user_name')) || ''; } catch {}
    me = me.trim().toLowerCase();

    const routines = db.getAllSync(`SELECT * FROM timetable`) as any[];
    if (routines) {
      const DAY_MAP: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
      for (const item of routines) {
        const audience = (item.for_user || item.user_id || '').trim().toLowerCase();
        // Only schedule on this device if the row is targeted at me or both.
        if (me && audience !== me && audience !== 'both') continue;

        const dayIdx = DAY_MAP[item.day];
        if (dayIdx === undefined) continue;
        const [time, period] = item.time.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;

        let d = set(new Date(), { hours, minutes, seconds: 0, milliseconds: 0 });
        d = setDay(d, dayIdx, { weekStartsOn: 0 });
        if (!isAfter(d, now)) d = addWeeks(d, 1);

        addToMap(d, { ...item, title: item.activity, type: 'routine' }, true);
      }
    }

    const calEvents = db.getAllSync(`SELECT * FROM calendar_events`) as any[];
    if (calEvents) {
      for (const item of calEvents) {
        const d = set(new Date(item.event_date), { hours: 9, minutes: 0 });
        if (isAfter(d, now)) addToMap(d, { ...item, type: 'calendar' }, true);
      }
    }

    // ── MEETINGS (couple meet-ups, anniversaries-as-meeting, etc.)
    try {
      const meetings = db.getAllSync(`SELECT * FROM meetings`) as any[];
      for (const m of meetings || []) {
        if (!m.date) continue;
        const base = new Date(m.date);
        const [hh, mm] = (m.time || '09:00').split(':').map((x: string) => parseInt(x, 10));
        const d = set(base, { hours: hh || 9, minutes: mm || 0, seconds: 0, milliseconds: 0 });
        if (isAfter(d, now)) addToMap(d, { ...m, title: m.occasion_name || 'Meeting', type: 'meeting' }, true);
      }
    } catch {}

    // ── STUDY ROUTINES (audience-filtered same as timetable)
    try {
      const sroutines = db.getAllSync(`SELECT * FROM study_routines WHERE date IS NOT NULL AND (is_completed IS NULL OR is_completed = 0)`) as any[];
      for (const r of sroutines || []) {
        if (!r.date) continue;
        const audience = (r.for_user || r.user_id || '').trim().toLowerCase();
        if (me && audience !== me && audience !== 'both') continue;

        const base = new Date(r.date);
        const [hh, mm] = (r.start_time || '09:00').split(':').map((x: string) => parseInt(x, 10));
        const d = set(base, { hours: hh || 9, minutes: mm || 0, seconds: 0, milliseconds: 0 });
        if (isAfter(d, now)) addToMap(d, { ...r, title: r.title || 'Study task', type: 'study_routine' }, true);
      }
    } catch {}

    // ── STUDY EXAMS (T-1-day countdown + day-of)
    try {
      const exams = db.getAllSync(`SELECT * FROM study_exams WHERE exam_date IS NOT NULL`) as any[];
      for (const e of exams || []) {
        const examDay = startOfDay(new Date(e.exam_date));
        const dayOf  = set(examDay, { hours: 8, minutes: 0 });
        const dayBef = set(addWeeks(examDay, 0), { hours: 18, minutes: 0 });
        dayBef.setDate(dayBef.getDate() - 1);
        if (isAfter(dayBef, now)) addToMap(dayBef, { ...e, title: `Exam tomorrow: ${e.title}`, type: 'exam' }, true);
        if (isAfter(dayOf, now))  addToMap(dayOf,  { ...e, title: `Exam today: ${e.title}`,    type: 'exam' }, true);
      }
    } catch {}

    // ── DIET PLANS (meal-time reminders for today + tomorrow only — keeps
    //    iOS 64-pending-notification budget under control)
    try {
      const todayStr = now.toISOString().slice(0, 10);
      const tomorrow = new Date(now.getTime() + 86400000);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      const plans = db.getAllSync(
        `SELECT * FROM diet_plans WHERE date IN (?, ?) AND (is_eaten IS NULL OR is_eaten = 0) AND meal_time IS NOT NULL`,
        [todayStr, tomorrowStr]
      ) as any[];
      for (const p of plans || []) {
        const base = new Date(p.date);
        const [hh, mm] = (p.meal_time || '09:00').split(':').map((x: string) => parseInt(x, 10));
        const d = set(base, { hours: hh || 9, minutes: mm || 0, seconds: 0, milliseconds: 0 });
        if (isAfter(d, now)) addToMap(d, { ...p, title: 'Meal time', type: 'diet' }, true);
      }
    } catch {}

    // ── ANNIVERSARIES (yearly recurring couple milestones)
    try {
      const anns = db.getAllSync(`SELECT * FROM anniversaries`) as any[];
      for (const a of anns || []) {
        if (!a.date) continue;
        const base = new Date(a.date);
        // Compute the next occurrence (this year or next).
        let next = new Date(now.getFullYear(), base.getMonth(), base.getDate(), 9, 0, 0);
        if (next < now) next = new Date(now.getFullYear() + 1, base.getMonth(), base.getDate(), 9, 0, 0);
        addToMap(next, { ...a, title: `Anniversary: ${a.name}`, type: 'anniversary' }, true);
      }
    } catch {}
  } catch (err) {
    console.warn('Sync notifications local read error', err);
  }

  // 2. SCHEDULE SMART NOTIFICATIONS
  let scheduledCount = 0;
  for (const [timeStr, events] of Object.entries(scheduleMap)) {
    const triggerDate = new Date(timeStr);
    if (triggerDate <= now) continue;

    const secondsFromNow = Math.floor((triggerDate.getTime() - now.getTime()) / 1000);
    let title = "TAMTAM Update";
    let body = "";

    if (events.starts.length > 0 && events.ends.length > 0) {
      const finished = events.ends.map(e => e.title).join(', ');
      const starting = events.starts.map(s => s.title).join(', ');
      title = "🔄 Smart Handover";
      body = `${finished} finished! Time for ${starting}! ✨`;
    } else if (events.starts.length > 0) {
      title = events.starts.length > 1 ? "🚀 Multiple Starts" : `⏰ Starting: ${events.starts[0].title}`;
      body = events.starts.length > 1 ? `Time for: ${events.starts.map(s => s.title).join(', ')}` : "Starting right now! ❤️";
    } else if (events.ends.length > 0) {
      title = `✅ Finished: ${events.ends[0].title}`;
      body = "Well done! This task is now complete. ✨";
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { type: 'smart_update', events },
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: Platform.OS === 'ios'
        ? { type: 'timeInterval', seconds: Math.max(1, secondsFromNow), repeats: false } as any
        : { type: 'calendar', year: triggerDate.getFullYear(), month: triggerDate.getMonth(), day: triggerDate.getDate(), hour: triggerDate.getHours(), minute: triggerDate.getMinutes(), repeats: false } as any,
    });
    scheduledCount++;
  }

  console.log(`Sync complete. Scheduled ${scheduledCount} smart notification windows.`);
}

export async function sendStudyNotification(userName: string, message: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Study Alert! 🧠",
        body: `${userName} ${message}`,
        data: { type: 'study_session' },
        sound: true,
        priority: Notifications.AndroidImportance.MAX,
      },
      trigger: null, // Send immediately
    });
  } catch (e) {
    console.warn('Failed to send study notification', e);
  }
}
