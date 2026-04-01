import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, Modal, TextInput, ActivityIndicator, Alert, TouchableOpacity, Image } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { format, isSameDay } from 'date-fns';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import LottieView from 'lottie-react-native';
import { Heart, MessageSquare, Image as ImageIcon, Calendar, Bell, ChevronRight, Plus, X, Trash2, ShieldCheck, MapPin, Camera } from 'lucide-react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const getDisplayName = (name: string | null) => {
  if (!name) return 'User';
  const lower = name.toLowerCase();
  if (lower === 'pratishth' || lower === 'user_1') return 'Pratishth';
  if (lower === 'supriya' || lower === 'love') return 'Supriya';
  return name;
};

export default function TabOneScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    init();
    
    const postsSub = supabase.channel('dashboard_posts').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => fetchPosts()).subscribe();
    const profilesSub = supabase.channel('dashboard_profiles').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchProfiles()).subscribe();
    
    return () => {
      supabase.removeChannel(postsSub);
      supabase.removeChannel(profilesSub);
    };
  }, []);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setCurrentUserName(name);
    await Promise.all([fetchProfiles(), fetchPosts(), fetchCalendarEvents()]);
    setLoading(false);
  };

  const fetchProfiles = async () => {
    const { data } = await supabase.from('profiles').select('*');
    if (data) setProfiles(data);
  };

  const fetchPosts = async () => {
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(5);
    if (data) setPosts(data);
  };

  const fetchCalendarEvents = async () => {
    const { data } = await supabase.from('trips').select('*');
    if (data) setCalendarEvents(data);
  };

  const isEventOnDay = (event: any, date: Date) => {
    const start = new Date(event.start_date);
    const end = new Date(event.end_date);
    return date >= start && date <= end;
  };

  const selectedDayEvents = calendarEvents.filter(e => isEventOnDay(e, selectedCalendarDate));

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={{ backgroundColor: 'transparent' }}>
            <Text style={[styles.greeting, { color: theme.text }]}>Hello, {getDisplayName(currentUserName)}</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Thinking of you today</Text>
          </View>
          <TouchableOpacity style={[styles.notifBtn, { backgroundColor: theme.card }]}>
            <Bell size={22} color={theme.text} />
            <View style={[styles.badge, { backgroundColor: theme.tint }]} />
          </TouchableOpacity>
        </View>

        {/* Profile Card Section */}
        <View style={styles.profilesRow}>
          {profiles.map((p, i) => (
            <MotiView key={p.id} from={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 100 }} style={[styles.profileCard, { backgroundColor: theme.card }]}>
              <View style={styles.avatarWrapper}>
                {p.avatar_url ? (
                  <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: theme.tint, justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={styles.avatarInitial}>{p.username.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={[styles.statusDot, { backgroundColor: '#34C759' }]} />
              </View>
              <Text style={[styles.profileName, { color: theme.text }]}>{getDisplayName(p.username)}</Text>
              <Text style={[styles.profileStatus, { color: theme.tabIconDefault }]}>Thinking of us...</Text>
            </MotiView>
          ))}
        </View>

        {/* Recent Memories Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Recent Memories</Text>
            <TouchableOpacity><Text style={{ color: theme.tint, fontWeight: '600' }}>See All</Text></TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memoriesScroll}>
            {posts.map((post, i) => (
              <MotiView key={post.id} from={{ opacity: 0, translateX: 50 }} animate={{ opacity: 1, translateX: 0 }} transition={{ delay: i * 100 }} style={[styles.memoryCard, { backgroundColor: theme.card }]}>
                {post.type === 'image' || post.type === 'draw' ? (
                  <Image source={{ uri: post.content }} style={styles.memoryImg} />
                ) : (
                  <View style={styles.memoryTextWrapper}>
                    <Text style={[styles.memoryText, { color: theme.text }]} numberOfLines={4}>{post.content}</Text>
                  </View>
                )}
                <View style={styles.memoryInfo}>
                  <Text style={[styles.memoryDate, { color: theme.tabIconDefault }]}>{format(new Date(post.created_at), 'MMM d')}</Text>
                  <Heart size={14} color={theme.tint} fill={theme.tint} />
                </View>
              </MotiView>
            ))}
          </ScrollView>
        </View>

        {/* Calendar/Plans Preview */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 15 }]}>Upcoming Plans</Text>
          <View style={[styles.plansCard, { backgroundColor: theme.card }]}>
            {selectedDayEvents.length > 0 ? (
              selectedDayEvents.map(event => (
                <View key={event.id} style={styles.eventItem}>
                  <View style={[styles.eventIcon, { backgroundColor: theme.tint + '20' }]}>
                    <MapPin size={20} color={theme.tint} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.eventTitle, { color: theme.text }]}>{event.title}</Text>
                    <Text style={[styles.eventLoc, { color: theme.tabIconDefault }]}>{event.location_name}</Text>
                  </View>
                  <ChevronRight size={20} color={theme.tabIconDefault} />
                </View>
              ))
            ) : (
              <View style={styles.emptyPlans}>
                <Calendar size={40} color={theme.tabIconDefault} opacity={0.2} />
                <Text style={[styles.emptyText, { color: theme.tabIconDefault }]}>No plans for today.</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, marginTop: 40 },
  greeting: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 16, fontWeight: '600', marginTop: 2 },
  notifBtn: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  badge: { position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#FFF' },
  profilesRow: { flexDirection: 'row', gap: 15, marginBottom: 30 },
  profileCard: { flex: 1, padding: 20, borderRadius: 28, alignItems: 'center', elevation: 4 },
  avatarWrapper: { position: 'relative', marginBottom: 12 },
  avatar: { width: 70, height: 70, borderRadius: 35 },
  avatarInitial: { fontSize: 24, fontWeight: 'bold', color: '#FFF' },
  statusDot: { position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFF' },
  profileName: { fontSize: 16, fontWeight: '800' },
  profileStatus: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  section: { marginBottom: 30 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  memoriesScroll: { gap: 15, paddingRight: 20 },
  memoryCard: { width: 160, borderRadius: 24, padding: 12, elevation: 3 },
  memoryImg: { width: '100%', height: 120, borderRadius: 16, marginBottom: 10 },
  memoryTextWrapper: { width: '100%', height: 120, justifyContent: 'center', padding: 10 },
  memoryText: { fontSize: 14, fontWeight: '600', fontStyle: 'italic', textAlign: 'center' },
  memoryInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  memoryDate: { fontSize: 12, fontWeight: '700' },
  plansCard: { padding: 20, borderRadius: 28, elevation: 2 },
  eventItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  eventIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  eventTitle: { fontSize: 16, fontWeight: '800' },
  eventLoc: { fontSize: 13, marginTop: 2 },
  emptyPlans: { alignItems: 'center', padding: 20, gap: 10 },
  emptyText: { fontSize: 14, fontWeight: '600' }
});
