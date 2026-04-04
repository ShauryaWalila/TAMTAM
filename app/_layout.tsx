import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import 'react-native-reanimated';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { MotiView, AnimatePresence } from 'moti';
import { Bell, Clock, MapPin, X, CheckCircle2 } from 'lucide-react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';

const { width } = Dimensions.get('window');

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  const [activeAlarm, setActiveAlert] = useState<any>(null);

  useEffect(() => { if (error) throw error; }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
      initNotifications();
    }
  }, [loaded]);

  const initNotifications = async () => {
    // 1. REQUEST PERMISSIONS
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }

    // 2. CONFIGURE ANDROID CHANNEL
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }

    // 3. SYNC REMINDERS
    syncGlobalReminders();
  };

  const syncGlobalReminders = async () => {
    const { data } = await supabase.from('chill_items').select('*').eq('type', 'reminder');
    if (!data) return;

    await Notifications.cancelAllScheduledNotificationsAsync();

    for (const item of data) {
      const content = item.content;
      if (content.active && content.remType === 'time' && content.start_at) {
        const trigger = new Date(content.start_at);
        if (trigger > new Date()) {
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `⏰ TAMTAM: ${item.title}`,
                body: "It's time for your shared task! ❤️",
                data: { itemId: item.id, type: 'reminder', title: item.title, remType: content.remType },
                sound: true,
              },
              trigger,
            });
          } catch (e) {
            console.error('Failed to schedule:', e);
          }
        }
      }
    }
  };

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      setActiveAlert(notification.request.content.data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const interval = setInterval(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 1000);
      setTimeout(() => clearInterval(interval), 5000);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data.itemId || data.type === 'reminder') {
        router.push('/(tabs)/chill-zone');
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

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
                <MotiView from={{ scale: 1 }} animate={{ scale: 1.2 }} transition={{ loop: true, type: 'timing', duration: 500 }} style={styles.alarmIconBox}><Bell size={40} color="white" fill="white" /></MotiView>
                <Text style={styles.alarmTitle}>{activeAlarm.title || "Shared Reminder"}</Text>
                <Text style={styles.alarmSubtitle}>Happening right now in your shared world!</Text>
                <View style={styles.alarmActions}>
                  <TouchableOpacity onPress={() => { setActiveAlert(null); router.push('/(tabs)/chill-zone'); }} style={styles.acceptBtn}><CheckCircle2 size={24} color="white" /><Text style={styles.acceptText}>OPEN TASK</Text></TouchableOpacity>
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
