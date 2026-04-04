import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const GEOFENCE_TASK_NAME = 'TAMTAM_PROXIMITY_ALERT';

// 🔔 Modern Notification Config
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});
export const initLocationSystem = async () => {
  try {
    // 1. Request Foreground - This usually works in Expo Go
    const { status: foreStatus } = await Location.requestForegroundPermissionsAsync();
    if (foreStatus !== 'granted') {
      console.log('Foreground location permission denied.');
      return;
    }

    // 2. Request Background - This often fails in Expo Go due to missing Info.plist keys
    try {
      const { status: backStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backStatus !== 'granted') {
        console.log('Background location permission not granted. Proximity alerts will work in foreground.');
      }
    } catch (e: any) {
      console.log('Background location request skipped or unsupported in this environment:', e.message);
      // We don't re-throw here so the rest of the app stays functional
    }

    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') return;
  } catch (error: any) {
    console.log('Location system init error:', error.message);
  }
};

let cachedRegions: any[] = [];

// 🗺️ Register Geofences
export const registerProximityAlerts = async (regions: any[]) => {
  cachedRegions = regions; // Keep for foreground fallback
  try {
    const isStarted = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
    if (isStarted) await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);

    if (regions.length === 0) return;

    const geofences = regions.map(r => ({
      identifier: JSON.stringify({ id: r.id, name: r.name, type: r.type, comments: r.comments || '' }),
      latitude: r.latitude,
      longitude: r.longitude,
      radius: 200,
      notifyOnEnter: true,
      notifyOnExit: false,
    }));

    await Location.startGeofencingAsync(GEOFENCE_TASK_NAME, geofences);
    console.log(`Registered ${regions.length} background geofences.`);
  } catch (error: any) {
    console.log('Geofencing background registration skipped:', error.message);
    console.log('Falling back to foreground location watcher...');
    startForegroundWatcher();
  }
};

let isWatcherStarted = false;
const startForegroundWatcher = async () => {
  if (isWatcherStarted) return;
  isWatcherStarted = true;

  // Manual distance check every 3 minutes while app is in foreground
  setInterval(async () => {
    if (cachedRegions.length === 0) return;
    
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = loc.coords;

      for (const region of cachedRegions) {
        const dist = getDistance(latitude, longitude, region.latitude, region.longitude);
        if (dist < 250) { // 250 meters
          await triggerProximityNotification(region);
        }
      }
    } catch (e) {
      // Ignore location fetch errors
    }
  }, 180000); // 3 minutes
};

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

const triggerProximityNotification = async (info: any) => {
  let title = "✨ Shared Memory Nearby!";
  let body = `Hey! You're near "${info.name}". ❤️`;

  if (info.type === 'wishlist') {
    title = "💫 Wishlist Alert!";
    body = `You're close to "${info.name}"! Want to check it out?`;
  } else if (info.type === 'trip_bucket') {
    title = "📍 Trip Stop Nearby!";
    body = `Your planned stop "${info.name}" is right here!`;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { id: info.id, type: info.type, title, body },
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: null,
  });
};

// 🤖 Task Definition
try {
  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data: { eventType, region }, error }: any) => {
    if (error) return;
    if (eventType === Location.GeofencingEventType.Enter) {
      const info = JSON.parse(region.identifier);
      await triggerProximityNotification(info);
    }
  });
} catch (e) {
  console.log('Task definition failed');
}
