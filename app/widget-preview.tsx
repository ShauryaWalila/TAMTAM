import React from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Image, Dimensions } from 'react-native';
import { Text } from '@/components/Themed';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Hand, Clock, MapPin, Calendar, Sparkles } from 'lucide-react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WIDGET_SMALL = (SCREEN_WIDTH - 60) / 2;
const WIDGET_MEDIUM = SCREEN_WIDTH - 40;

export default function WidgetPreviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.headerTitle}>Widget Gallery</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color={theme.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.sectionTitle, { color: theme.tabIconDefault }]}>HOME SCREEN PREVIEW</Text>
        <Text style={styles.description}>These are how your widgets will look on your iOS home screen.</Text>

        <View style={styles.grid}>
          {/* 1. Drawing Widget */}
          <View style={styles.widgetWrapper}>
            <Text style={styles.widgetLabel}>Drawing (Small)</Text>
            <View style={[styles.widgetBase, styles.smallWidget, { overflow: 'hidden' }]}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=500&auto=format&fit=crop' }} 
                style={StyleSheet.absoluteFill} 
              />
              <View style={styles.drawingOverlay}>
                <Text style={styles.drawingBadge}>Latest Drawing</Text>
              </View>
            </View>
          </View>

          {/* 2. Touch Widget */}
          <View style={styles.widgetWrapper}>
            <Text style={styles.widgetLabel}>Touch (Small)</Text>
            <View style={[styles.widgetBase, styles.smallWidget, { backgroundColor: '#FFF0F5', padding: 15, justifyContent: 'center', alignItems: 'center' }]}>
              <Hand size={32} color="#FF2D55" fill="#FF2D55" />
              <Text style={styles.touchText}>Partner touched you! ❤️</Text>
              <Text style={styles.touchTime}>10:45 AM</Text>
            </View>
          </View>

          {/* 3. Distance Widget */}
          <View style={[styles.widgetWrapper, { width: '100%' }]}>
            <Text style={styles.widgetLabel}>Distance (Medium)</Text>
            <LinearGradient 
              colors={['#4facfe', '#00f2fe']} 
              start={{ x: 0, y: 0 }} 
              end={{ x: 1, y: 1 }} 
              style={[styles.widgetBase, styles.mediumWidget, { padding: 20 }]}
            >
              <Text style={styles.distTitle}>DISTANCE</Text>
              <View style={styles.distRow}>
                <Text style={styles.distValue}>12.5</Text>
                <Text style={styles.distUnit}>km</Text>
              </View>
              <View style={styles.locationRow}>
                <MapPin size={12} color="white" />
                <Text style={styles.locationText}>City Center</Text>
              </View>
            </LinearGradient>
          </View>

          {/* 4. Meeting Widget */}
          <View style={styles.widgetWrapper}>
            <Text style={styles.widgetLabel}>Meeting (Small)</Text>
            <View style={[styles.widgetBase, styles.smallWidget, { backgroundColor: '#FFF5E6', padding: 15, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={styles.meetLabel}>NEXT MEET</Text>
              <Text style={styles.meetValue}>05</Text>
              <Text style={styles.meetDays}>DAYS LEFT</Text>
            </View>
          </View>

          {/* 5. Routine Widget */}
          <View style={styles.widgetWrapper}>
            <Text style={styles.widgetLabel}>Routine (Small)</Text>
            <View style={[styles.widgetBase, styles.smallWidget, { backgroundColor: '#F0F0FF', padding: 15 }]}>
              <View style={styles.routineHeader}>
                <Clock size={14} color="#5856D6" />
                <Text style={styles.routineTitle}>Routine</Text>
              </View>
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text style={styles.nextTask}>Lunch Date</Text>
                <Text style={styles.nextTime}>01:30 PM</Text>
              </View>
            </View>
          </View>

          {/* 6. Large Routine Preview */}
          <View style={[styles.widgetWrapper, { width: '100%' }]}>
            <Text style={styles.widgetLabel}>Routine (Medium)</Text>
            <View style={[styles.widgetBase, styles.mediumWidget, { backgroundColor: '#F0F0FF', padding: 20 }]}>
              <View style={styles.routineHeader}>
                <Clock size={16} color="#5856D6" />
                <Text style={[styles.routineTitle, { fontSize: 16 }]}>Today's Routine</Text>
              </View>
              <View style={styles.routineList}>
                <RoutineItem time="09:00 AM" task="Morning Coffee ☕" active />
                <RoutineItem time="01:30 PM" task="Lunch Date 🍱" />
                <RoutineItem time="08:00 PM" task="Movie Night 🍿" />
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function RoutineItem({ time, task, active }: any) {
  return (
    <View style={styles.routineItem}>
      <View style={[styles.routineDot, active && { backgroundColor: '#5856D6' }]} />
      <Text style={[styles.routineTask, active && { fontWeight: '700' }]}>{task}</Text>
      <Text style={styles.routineItemTime}>{time}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15 },
  headerTitle: { fontSize: 24, fontWeight: '900' },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginBottom: 8 },
  description: { fontSize: 14, color: '#8E8E93', marginBottom: 30, lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  widgetWrapper: { marginBottom: 30, width: WIDGET_SMALL },
  widgetLabel: { fontSize: 11, fontWeight: '700', color: '#8E8E93', marginBottom: 10, textTransform: 'uppercase' },
  widgetBase: { borderRadius: 28, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10 },
  smallWidget: { width: WIDGET_SMALL, height: WIDGET_SMALL },
  mediumWidget: { width: WIDGET_MEDIUM, height: WIDGET_SMALL },
  drawingOverlay: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  drawingBadge: { backgroundColor: 'rgba(0,0,0,0.5)', color: 'white', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, fontSize: 10, fontWeight: '800', overflow: 'hidden', alignSelf: 'flex-start' },
  touchText: { marginTop: 12, fontSize: 13, fontWeight: '700', textAlign: 'center', color: '#FF2D55' },
  touchTime: { marginTop: 4, fontSize: 10, color: '#FF2D55', opacity: 0.6 },
  distTitle: { color: 'white', fontSize: 10, fontWeight: '900', opacity: 0.8 },
  distRow: { flexDirection: 'row', alignItems: 'flex-end', marginVertical: 4 },
  distValue: { color: 'white', fontSize: 42, fontWeight: '900' },
  distUnit: { color: 'white', fontSize: 16, fontWeight: '800', marginBottom: 8, marginLeft: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  locationText: { color: 'white', fontSize: 12, fontWeight: '600' },
  meetLabel: { fontSize: 10, fontWeight: '900', color: '#FF9500', opacity: 0.8 },
  meetValue: { fontSize: 48, fontWeight: '900', color: '#FF9500', marginVertical: 2 },
  meetDays: { fontSize: 10, fontWeight: '900', color: '#FF9500', letterSpacing: 1 },
  routineHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  routineTitle: { fontSize: 12, fontWeight: '800', color: '#5856D6' },
  nextTask: { fontSize: 18, fontWeight: '800', color: '#333' },
  nextTime: { fontSize: 12, color: '#666', marginTop: 4 },
  routineList: { gap: 12, marginTop: 5 },
  routineItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#DDD' },
  routineTask: { flex: 1, fontSize: 14, color: '#333' },
  routineItemTime: { fontSize: 12, color: '#888' }
});
