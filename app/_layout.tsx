import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform, DeviceEventEmitter, AppState } from 'react-native';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';
import { Bell, Clock, MapPin, X, CheckCircle2 } from 'lucide-react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { syncAllNotifications, REMINDERS_CHANGED } from '@/lib/notifications';
import { processSmsInbox, redactOldSmsBodies } from '@/lib/smsParser';
import { installDebugCapture } from '@/lib/debugLog';

// Install before anything else so even module-init errors are captured.
installDebugCapture();
import { initLocationSystem } from '@/lib/location';
import { initDB } from '@/lib/db';
import { startSyncEngine, initialFullSync, setupGlobalRealtime } from '@/lib/syncEngine';
import { updateDrawingWidget, updateTouchWidget } from '@/lib/widget';
import { syncDistanceWidget, syncMeetingWidget, syncRoutineWidget } from '@/lib/widgetSync';
import * as SecureStore from 'expo-secure-store';

const { width } = Dimensions.get('window');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function RootLayout() {
  const router = useRouter();
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const [activeAlarm, setActiveAlert] = useState<any>(null);
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => { if (error) throw error; }, [error]);

  useEffect(() => {
    if (loaded && !appIsReady) {
      setAppIsReady(true);
      initApp();
    }
  }, [loaded, appIsReady]);

  const initApp = async () => {
    // 0. INITIALIZE OFFLINE DB & SYNC ENGINE
    initDB();
    startSyncEngine();
    initialFullSync(false);
    // Global realtime — single channel listens to every public.* table.
    // Any partner-side INSERT/UPDATE/DELETE upserts into local SQLite within
    // ~200 ms and fires DATA_REFRESH so visible screens re-fetch.
    setupGlobalRealtime();

    // 1. REQUEST PERMISSIONS
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get permissions for notifications!');
    }

    // 2. INITIALIZE LOCATION (FOR PROXIMITY)
    await initLocationSystem();

    // 3. CONFIGURE ANDROID CHANNEL
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    // 4. SYNC ALL NOTIFICATIONS (Reminders, Routines, Calendar)
    await syncAllNotifications();

    // 5. INITIAL WIDGET SYNC
    syncMeetingWidget();
    syncRoutineWidget();
    syncDistanceWidget();

    // 6. PROCESS ANY SMS-INBOX ROWS WAITING FOR THE PARSER
    try {
      const raw = await SecureStore.getItemAsync('user_name');
      const userName = (raw || '').trim().toLowerCase();
      if (userName) {
        await processSmsInbox(userName);
        redactOldSmsBodies(userName);
      }
    } catch {}
  };

  // Re-run the SMS parser whenever the app comes to the foreground or a
  // DATA_REFRESH event fires (new sms_inbox rows just synced down).
  useEffect(() => {
    let pending: any = null;
    const trigger = async () => {
      if (pending) return;
      pending = setTimeout(async () => {
        pending = null;
        try {
          const raw = await SecureStore.getItemAsync('user_name');
          const u = (raw || '').trim().toLowerCase();
          if (u) await processSmsInbox(u);
        } catch {}
      }, 800);
    };
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') trigger(); });
    const refreshSub = DeviceEventEmitter.addListener('DATA_REFRESH', trigger);
    return () => {
      appSub.remove();
      refreshSub.remove();
      if (pending) clearTimeout(pending);
    };
  }, []);

  useEffect(() => {
    let diaryChannel: any;
    let momentsChannel: any;
    let postsChannel: any;

    const setupWidgetSubscription = async () => {
      const user = await SecureStore.getItemAsync('user_name');
      if (!user) return;

      const partnerId = user.toLowerCase() === 'love' ? 'pratishth' : 'love';

      // 1. Diary Updates
      diaryChannel = supabase
        .channel('diary_widget_updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'user_diary', filter: `user_id=eq.${partnerId}` },
          (payload) => {
            const entry = payload.new;
            // updateTamtamWidget(`Partner: ${entry.mood} - ${entry.content.substring(0, 20)}...`);
          }
        )
        .subscribe();

      // 2. Moments (Touches)
      momentsChannel = supabase
        .channel('moments_widget_updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'moments', filter: `user_id=eq.${partnerId}` },
          (payload) => {
            const moment = payload.new;
            if (moment.message === 'sent a touch') {
              updateTouchWidget(`${partnerId === 'love' ? 'Supriya' : 'Pratishth'} touched you! ❤️`);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }
        )
        .subscribe();

      // 3. Posts (Drawings)
      postsChannel = supabase
        .channel('posts_widget_updates')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'posts', filter: `user_id=eq.${partnerId}` },
          (payload) => {
            const post = payload.new;
            if (post.type === 'draw') {
              updateDrawingWidget(post.content);
            }
          }
        )
        .subscribe();
    };

    setupWidgetSubscription();

    return () => {
      if (diaryChannel) supabase.removeChannel(diaryChannel);
      if (momentsChannel) supabase.removeChannel(momentsChannel);
      if (postsChannel) supabase.removeChannel(postsChannel);
    };
  }, []);

  // Auto-resync local notifications on every reminder mutation + on app
  // foreground. Debounced so a burst of edits triggers exactly one reschedule.
  useEffect(() => {
    let pending: any = null;
    const trigger = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => { syncAllNotifications().catch(() => {}); }, 600);
    };
    const sub = DeviceEventEmitter.addListener(REMINDERS_CHANGED, trigger);
    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') trigger();
    });
    // Re-sync when realtime delivers any partner-side reminder change.
    DeviceEventEmitter.addListener('DATA_REFRESH', trigger);
    return () => {
      sub.remove();
      appStateSub.remove();
      if (pending) clearTimeout(pending);
    };
  }, []);

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data;
      const content = notification.request.content;
      
      // Merge notification text into data for the overlay
      setActiveAlert({
        ...data,
        title: content.title,
        body: content.body
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const interval = setInterval(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 1000);
      setTimeout(() => clearInterval(interval), 5000);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data.itemId || data.type === 'reminder') {
        router.push('/(tabs)/chill-zone');
      } else if (data.type === 'routine' || data.type === 'calendar') {
        router.push('/(tabs)');
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  const getAlarmIcon = () => {
    if (!activeAlarm) return <Bell size={40} color="white" fill="white" />;
    switch (activeAlarm.type) {
      case 'routine': return <Clock size={40} color="white" />;
      case 'calendar': return <MapPin size={40} color="white" />;
      case 'memory':
      case 'wishlist': return <MapPin size={40} color="white" fill="white" />;
      default: return <Bell size={40} color="white" fill="white" />;
    }
  };

  const getAlarmColor = () => {
    if (!activeAlarm) return '#5856D6';
    switch (activeAlarm.type) {
      case 'routine': return '#5AC8FA';
      case 'calendar': return '#AF52DE';
      case 'memory': return '#FF2D55';
      case 'wishlist': return '#FF9500';
      default: return '#5856D6';
    }
  };

  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RootLayoutNav />
        <AnimatePresence>
          {activeAlarm && (
            <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.alarmOverlay}>
              <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
              <MotiView from={{ scale: 0.5, translateY: 100 }} animate={{ scale: 1, translateY: 0 }} transition={{ type: 'spring' }} style={styles.alarmCard}>
                <MotiView from={{ scale: 1 }} animate={{ scale: 1.2 }} transition={{ loop: true, type: 'timing', duration: 500 }} style={[styles.alarmIconBox, { backgroundColor: getAlarmColor() }]}>
                  {getAlarmIcon()}
                </MotiView>
                <Text style={styles.alarmTitle}>{activeAlarm.title || "Shared Reminder"}</Text>
                <Text style={styles.alarmSubtitle}>{activeAlarm.body || "Happening right now in your shared world!"}</Text>
                <View style={styles.alarmActions}>
                  <TouchableOpacity onPress={() => { 
                    const target = (activeAlarm.type === 'routine' || activeAlarm.type === 'calendar') ? '/(tabs)' : '/(tabs)/chill-zone';
                    setActiveAlert(null); 
                    router.push(target as any); 
                  }} style={styles.acceptBtn}>
                    <CheckCircle2 size={24} color={getAlarmColor()} />
                    <Text style={[styles.acceptText, { color: getAlarmColor() }]}>VIEW DETAILS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setActiveAlert(null)} style={styles.dismissBtn}><Text style={styles.dismissText}>DISMISS</Text></TouchableOpacity>
                </View>
              </MotiView>
            </MotiView>
          )}
        </AnimatePresence>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="study-hub" options={{ headerShown: false }} />
        <Stack.Screen name="diary" options={{ headerShown: false }} />
        <Stack.Screen name="widget-preview" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  alarmOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 9999, justifyContent: 'center', alignItems: 'center', padding: 20 },
  alarmCard: { width: '100%', padding: 40, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', gap: 20 },
  alarmIconBox: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#5856D6', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  alarmTitle: { color: 'white', fontSize: 32, fontWeight: '900', textAlign: 'center' },
  alarmSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 16, textAlign: 'center', paddingHorizontal: 20 },
  alarmActions: { width: '100%', gap: 15, marginTop: 20 },
  acceptBtn: { width: '100%', height: 65, borderRadius: 22, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  acceptText: { color: '#000', fontWeight: '900', fontSize: 18, letterSpacing: 1 },
  dismissBtn: { width: '100%', height: 50, alignItems: 'center', justifyContent: 'center' },
  dismissText: { color: 'rgba(255,255,255,0.4)', fontWeight: '800', fontSize: 14 }
});
