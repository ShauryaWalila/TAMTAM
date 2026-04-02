import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform, Alert } from 'react-native';

const GEOFENCE_TASK_NAME = 'TAMTAM_PROXIMITY_ALERT';

// 🔔 Modern Notification Config
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // Legacy
    shouldPlaySound: true,
    shouldSetBadge: true,
    // Modern replacements
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const initLocationSystem = async () => {
  try {
    const { status: foreStatus } = await Location.requestForegroundPermissionsAsync();
    if (foreStatus !== 'granted') return;

    // Background location needs extra care in Expo Go
    const { status: backStatus } = await Location.requestBackgroundPermissionsAsync();
    if (backStatus !== 'granted') {
      console.log('Background location permission not granted. Proximity alerts will only work while app is open.');
    }

    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') return;
  } catch (error: any) {
    console.log('Location system init suppressed:', error.message);
    // Suppress the Info.plist error in Expo Go while still allowing the app to run
  }
};

// 🗺️ Register Geofences
export const registerProximityAlerts = async (regions: any[]) => {
  try {
    // Geofencing is a "Native" feature that is limited in Expo Go
    // We try to start it, but wrap in try/catch so it doesn't crash the app
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
  } catch (error: any) {
    console.log('Geofencing registration skipped (likely Expo Go limitation):', error.message);
  }
};

// 🤖 Task Definition (Must be defined at the top level of the JS bundle)
try {
  TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data: { eventType, region }, error }: any) => {
    if (error) return;

    if (eventType === Location.GeofencingEventType.Enter) {
      const info = JSON.parse(region.identifier);
      
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
          data: { id: info.id },
          sound: true,
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger: null,
      });
    }
  });
} catch (e) {
  console.log('Task definition failed (usually double definition during reload)');
}
