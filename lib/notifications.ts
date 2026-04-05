import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { db } from './db';
import { addWeeks, addMonths, addYears, set, isAfter, startOfDay, isBefore, setDay } from 'date-fns';

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

    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    
    // Only fetch token if a valid PROJECT_ID exists (prevents crash with placeholders)
    if (projectId && !projectId.includes('77777777')) {
      try {
        token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      } catch (e) {
        console.log('Could not fetch push token (Push Notifications disabled):', e);
      }
    } else {
      console.log('Push Notifications Disabled: No valid EAS Project ID found in app.json. Local reminders and proximity alerts will still work.');
    }
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

    const routines = db.getAllSync(`SELECT * FROM timetable`) as any[];
    if (routines) {
      const DAY_MAP: Record<string, number> = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
      for (const item of routines) {
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
