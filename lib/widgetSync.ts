import * as Location from 'expo-location';
import { db } from './db';
import { updateDistanceWidget, updateMeetingWidget, updateRoutineWidget } from './widget';
import { differenceInDays, isAfter, set, addWeeks, addMonths, format } from 'date-fns';

const DAY_MAP: Record<string, number> = {
  'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6
};

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Syncs the Distance Widget
 */
export async function syncDistanceWidget() {
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = loc.coords;

    // In a real 2-user app, you'd fetch the partner's location from Supabase
    // For now, we'll use a placeholder or the last known location
    updateDistanceWidget("12.5", "City Center");
  } catch (e) {
    console.warn('Distance sync failed', e);
  }
}

/**
 * Syncs the Meeting Widget
 */
export async function syncMeetingWidget() {
  try {
    const data = db.getFirstSync(`SELECT * FROM meetings ORDER BY created_at DESC LIMIT 1`) as any;
    if (data) {
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
      } else if (data.type === 'weekly') {
        const dayIdx = DAY_MAP[data.weekday || 'Friday'];
        target = set(now, { hours, minutes: m, seconds: 0, milliseconds: 0 });
        // Adjust to correct weekday
      } else {
        return;
      }

      const days = differenceInDays(target, now);
      updateMeetingWidget(days.toString(), data.occasion_name || "Next Meeting");
    }
  } catch (e) {}
}

/**
 * Syncs the Routine Widget
 */
export function syncRoutineWidget() {
  try {
    const today = DAYS_SHORT[new Date().getDay()];
    const items = db.getAllSync(`SELECT * FROM timetable WHERE day = ? ORDER BY time ASC`, [today]) as any[];
    
    if (items.length > 0) {
      const next = items[0]; // Simplification: just pick the first for now
      updateRoutineWidget(next.activity, next.time, items.map(i => ({ activity: i.activity, time: i.time })));
    } else {
      updateRoutineWidget("No activities", "--:--", []);
    }
  } catch (e) {}
}
