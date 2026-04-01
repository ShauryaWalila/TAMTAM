import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, ScrollView, Pressable, Switch, View, Image, ActivityIndicator, Alert, Modal, TextInput, FlatList, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { User, Bell, Shield, CircleHelp, LogOut, ChevronRight, Camera, MessageSquareHeart, HeartHandshake, Tags, Plus, X, Trash2, Briefcase, Wrench, MessageCircle, Clock, TrendingUp, Landmark } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import * as base64js from 'base64-js';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { registerForPushNotificationsAsync } from '@/lib/notifications';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Linking from 'expo-linking';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import Wardrobe from '@/components/PlanMode/Wardrobe';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(false);

  // Wardrobe Categories State
  const [isWardrobeSettingsVisible, setIsWardrobeSettingsVisible] = useState(false);
  const [isWardrobeVisible, setIsWardrobeVisible] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCatName, setNewCatName] = useState('');
  const [loadingCats, setLoadingCats] = useState(false);
  const [userId, setUserId] = useState<string>('');

  // Tools State
  const [isToolsVisible, setIsToolsVisible] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [timeEntries, setTimeEntries] = useState([new Date(), new Date()]);
  const [totalCalculatedTime, setTotalCalculatedTime] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  // Scroll visibility logic
  const lastScrollY = useRef(0);
  const handleScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY <= 0) {
      DeviceEventEmitter.emit('show-navigator');
    } else if (currentY > lastScrollY.current + 10) {
      DeviceEventEmitter.emit('hide-navigator');
    } else if (currentY < lastScrollY.current - 10) {
      DeviceEventEmitter.emit('show-navigator');
    }
    lastScrollY.current = currentY;
  };

  useEffect(() => {
    fetchProfile();
    fetchCategories();
  }, []);

  const fetchProfile = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setUserName(name);
    if (name) {
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url, push_token, id')
        .eq('username', name.toLowerCase())
        .single();
      
      if (data) {
        setAvatarUrl(data.avatar_url);
        setIsNotificationsEnabled(!!data.push_token);
        setUserId(data.id);
      }
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('wardrobe_categories').select('*').order('name', { ascending: true });
    if (data) setCategories(data);
  };

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    setLoadingCats(true);
    const { error } = await supabase.from('wardrobe_categories').insert([{ name: newCatName.trim() }]);
    if (error) {
      Alert.alert('Error', 'Category already exists.');
    } else {
      setNewCatName('');
      fetchCategories();
    }
    setLoadingCats(false);
  };

  const deleteCategory = async (id: string) => {
    Alert.alert('Delete Category', 'Remove this category option?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('wardrobe_categories').delete().eq('id', id);
          fetchCategories();
        } 
      }
    ]);
  };

  const openWhatsApp = () => {
    if (!waNumber.trim()) return;
    const cleanNumber = waNumber.replace(/\D/g, '');
    if (cleanNumber.length < 11) {
      Alert.alert('Missing Country Code', 'Please include country code (e.g. 91) followed by the number.');
      return;
    }
    Linking.openURL(`https://wa.me/${cleanNumber}`);
  };

  const calculateTotalTime = () => {
    let totalMinutes = 0;
    for (let i = 0; i < timeEntries.length; i += 2) {
      const start = timeEntries[i];
      const end = timeEntries[i+1];
      if (start && end) {
        let diff = (end.getHours() * 60 + end.getMinutes()) - (start.getHours() * 60 + start.getMinutes());
        if (diff < 0) diff += 24 * 60;
        totalMinutes += diff;
      }
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    setTotalCalculatedTime(`${h}h ${m}m`);
  };

  const addTimeEntry = () => setTimeEntries([...timeEntries, new Date(), new Date()]);

  const toggleNotifications = async (value: boolean) => {
    if (value) {
      const token = await registerForPushNotificationsAsync();
      if (token && userName) {
        await supabase.from('profiles').update({ push_token: token }).eq('username', userName.toLowerCase());
        setIsNotificationsEnabled(true);
      }
    } else {
      if (userName) {
        await supabase.from('profiles').update({ push_token: null }).eq('username', userName.toLowerCase());
        setIsNotificationsEnabled(false);
      }
    }
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Leaving our world?", [
      { text: "Stay", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => {
          await SecureStore.deleteItemAsync('user_name');
          router.replace('/auth/login');
        }
      }
    ]);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled && userName) uploadAvatar(result.assets[0].uri);
  };

  const uploadAvatar = async (uri: string) => {
    try {
      setUploading(true);
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const filePath = `avatars/${userName?.toLowerCase()}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('journal-assets').upload(filePath, base64js.toByteArray(base64), { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
      await supabase.from('profiles').upsert({ username: userName?.toLowerCase(), avatar_url: publicUrl }, { onConflict: 'username' });
      setAvatarUrl(publicUrl);
    } catch (error: any) { Alert.alert('Error', error.message); }
    finally { setUploading(false); }
  };

  const getDisplayName = (name: string | null) => {
    if (!name) return 'User';
    const lower = name.toLowerCase();
    if (lower === 'pratishth' || lower === 'user_1') return 'Pratishth';
    if (lower === 'supriya' || lower === 'love') return 'Supriya';
    return name;
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView 
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 80 }]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.profileSection}>
          <Pressable onPress={pickImage} style={styles.avatarWrapper}>
            <View style={[styles.avatar, { backgroundColor: theme.tint }]}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{getDisplayName(userName).charAt(0)}</Text>
              )}
              {uploading && <View style={styles.uploadOverlay}><ActivityIndicator color="#FFF" /></View>}
            </View>
            <View style={[styles.editIcon, { backgroundColor: theme.card }]}><Camera size={14} color={theme.text} /></View>
          </Pressable>
          <Text style={[styles.userName, { color: theme.text }]}>{getDisplayName(userName)}</Text>
          <Text style={[styles.userEmail, { color: theme.tabIconDefault }]}>{userName?.toLowerCase()}@tamtam.app</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.tint }]}>Account</Text>
          <SettingsItem icon={<User color={theme.text} size={22} />} label="Personal Information" theme={theme} />
          <SettingsItem icon={<MessageSquareHeart color={theme.text} size={22} />} label="Message of the Moment" theme={theme} onPress={() => router.push('/motm')} />
          <SettingsItem icon={<HeartHandshake color={theme.text} size={22} />} label="Next Meet" theme={theme} onPress={() => router.push('/next-meet')} />
          <SettingsItem icon={<Bell color={theme.text} size={22} />} label="Notifications" theme={theme} right={<Switch value={isNotificationsEnabled} onValueChange={toggleNotifications} trackColor={{ true: theme.tint }} />} showChevron={false} />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.tint }]}>App Settings</Text>
          <SettingsItem icon={<Wrench color={theme.text} size={22} />} label="Tools" theme={theme} onPress={() => setIsToolsVisible(true)} />
          <SettingsItem icon={<Tags color={theme.text} size={22} />} label="Wardrobe Categories" theme={theme} onPress={() => setIsWardrobeSettingsVisible(true)} />
          <SettingsItem icon={<Briefcase color={theme.text} size={22} />} label="Master Wardrobe" theme={theme} onPress={() => setIsWardrobeVisible(true)} />
          <SettingsItem icon={<LogOut color="#FF3B30" size={22} />} label="Logout" theme={theme} onPress={handleLogout} labelStyle={{ color: "#FF3B30" }} showChevron={false} />
        </View>

        <View style={styles.footer}>
          <Text style={[styles.version, { color: theme.tabIconDefault }]}>TAMTAM v1.0.0 (Latest)</Text>
        </View>
      </ScrollView>

      {/* Tools Modal */}
      <Modal visible={isToolsVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={[styles.modalContent, { height: '85%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Tools & Utils</Text>
              <TouchableOpacity onPress={() => setIsToolsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={[styles.toolSection, { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)', paddingBottom: 20 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <MessageCircle size={22} color="#25D366" />
                  <Text style={[styles.toolLabel, { color: theme.text }]}>Direct WhatsApp</Text>
                </View>
                <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginBottom: 15 }}>Open a chat without saving. MUST include country code (e.g. 91).</Text>
                <View style={styles.waInputRow}>
                  <TextInput style={[styles.waInput, { color: theme.text, backgroundColor: theme.background }]} placeholder="919876543210" placeholderTextColor={theme.tabIconDefault} keyboardType="phone-pad" value={waNumber} onChangeText={setWaNumber} />
                  <TouchableOpacity style={[styles.waGoBtn, { backgroundColor: '#25D366' }]} onPress={openWhatsApp}><Text style={{ color: 'white', fontWeight: 'bold' }}>GO</Text></TouchableOpacity>
                </View>
              </View>

              <View style={[styles.toolSection, { marginTop: 20 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <Clock size={22} color={theme.tint} />
                  <Text style={[styles.toolLabel, { color: theme.text }]}>Time Calculator</Text>
                </View>
                <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginBottom: 15 }}>Calculate total duration across intervals.</Text>
                {timeEntries.map((time, idx) => (
                  <View key={idx} style={{ marginBottom: (idx % 2 === 1) ? 15 : 5 }}>
                    <Text style={{ color: theme.tabIconDefault, fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>{idx % 2 === 0 ? 'START TIME' : 'END TIME'}</Text>
                    <TouchableOpacity 
                      style={[styles.waInput, { color: theme.text, backgroundColor: theme.background, height: 44, justifyContent: 'center' }]} 
                      onPress={() => setPickerIndex(idx)}
                    >
                      <Text style={{ color: theme.text, fontWeight: '600' }}>{format(time, 'HH:mm')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                {pickerIndex !== null && (
                  <DateTimePicker
                    value={timeEntries[pickerIndex]}
                    mode="time"
                    is24Hour={true}
                    onChange={(e, date) => {
                      setPickerIndex(null);
                      if (date) {
                        const newEntries = [...timeEntries];
                        newEntries[pickerIndex] = date;
                        setTimeEntries(newEntries);
                      }
                    }}
                  />
                )}

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                  <TouchableOpacity style={[styles.toolActionBtn, { backgroundColor: theme.background }]} onPress={addTimeEntry}><Plus size={16} color={theme.text} /><Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 12 }}>ADD INTERVAL</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.toolActionBtn, { backgroundColor: theme.tint }]} onPress={calculateTotalTime}><TrendingUp size={16} color="white" /><Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12 }}>CALCULATE</Text></TouchableOpacity>
                </View>
                {totalCalculatedTime && (
                  <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={[styles.resultCard, { backgroundColor: theme.tint + '15' }]}>
                    <Text style={{ color: theme.tabIconDefault, fontSize: 11, fontWeight: 'bold' }}>TOTAL DURATION</Text>
                    <Text style={{ color: theme.tint, fontSize: 24, fontWeight: '900' }}>{totalCalculatedTime}</Text>
                  </MotiView>
                )}
              </View>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>

      {/* Wardrobe Modal */}
      <Modal visible={isWardrobeVisible} animationType="slide">
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { paddingHorizontal: 25, paddingTop: 60, marginBottom: 0 }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Master Wardrobe</Text>
            <TouchableOpacity onPress={() => setIsWardrobeVisible(false)}><X size={28} color={theme.text} /></TouchableOpacity>
          </View>
          <Wardrobe userId={userName || ''} isSettingsMode={true} />
        </View>
      </Modal>

      {/* Wardrobe Categories Modal */}
      <Modal visible={isWardrobeSettingsVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Wardrobe Sets</Text>
              <TouchableOpacity onPress={() => setIsWardrobeSettingsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <View style={styles.addCatRow}>
              <TextInput style={[styles.catInput, { color: theme.text, backgroundColor: theme.tint + '10' }]} placeholder="New Set Name" placeholderTextColor={theme.tabIconDefault} value={newCatName} onChangeText={setNewCatName} />
              <TouchableOpacity style={[styles.catAddBtn, { backgroundColor: theme.tint }]} onPress={addCategory}>
                {loadingCats ? <ActivityIndicator size="small" color="white" /> : <Plus size={24} color="white" />}
              </TouchableOpacity>
            </View>
            <FlatList data={categories} keyExtractor={item => item.id} renderItem={({ item }) => (
              <View style={styles.catItem}><View style={styles.catItemLeft}><Tags size={18} color={theme.tabIconDefault} /><Text style={[styles.catName, { color: theme.text }]}>{item.name}</Text></View><TouchableOpacity onPress={() => deleteCategory(item.id)}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity></View>
            )} />
          </BlurView>
        </View>
      </Modal>
    </ThemedView>
  );
}

function SettingsItem({ icon, label, theme, right, showChevron = true, labelStyle, onPress }: any) {
  return (
    <Pressable style={[styles.settingsItem, { backgroundColor: theme.card }]} onPress={onPress}>
      <View style={styles.settingsItemLeft}>{icon}<Text style={[styles.settingsLabel, { color: theme.text }, labelStyle]}>{label}</Text></View>
      {right ? right : (showChevron && <ChevronRight color={theme.tabIconDefault} size={20} />)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20 },
  profileSection: { alignItems: 'center', marginVertical: 32 },
  avatarWrapper: { position: 'relative', marginBottom: 16 },
  avatar: { width: 100, height: 100, borderRadius: 50, justifyContent: 'center', alignItems: 'center', elevation: 4, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  editIcon: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#FFF', elevation: 2 },
  avatarText: { color: '#FFF', fontSize: 28, fontWeight: 'bold' },
  userName: { fontSize: 24, fontWeight: '700' },
  userEmail: { fontSize: 14, marginTop: 4 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginLeft: 4 },
  settingsItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, marginBottom: 8 },
  settingsItemLeft: { flexDirection: 'row', alignItems: 'center' },
  settingsLabel: { fontSize: 16, fontWeight: '600', marginLeft: 12 },
  footer: { alignItems: 'center', marginTop: 12, marginBottom: 40 },
  version: { fontSize: 12, fontWeight: '500' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '80%', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 25, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  modalTitle: { fontSize: 22, fontWeight: 'bold' },
  addCatRow: { flexDirection: 'row', gap: 12, marginBottom: 25 },
  catInput: { flex: 1, height: 50, borderRadius: 15, paddingHorizontal: 15, fontSize: 16 },
  catAddBtn: { width: 50, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  catItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.1)' },
  catItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  catName: { fontSize: 16, fontWeight: '500' },
  toolSection: { padding: 10 },
  toolLabel: { fontSize: 18, fontWeight: '700' },
  waInputRow: { flexDirection: 'row', gap: 10 },
  waInput: { flex: 1, height: 50, borderRadius: 12, paddingHorizontal: 15, fontSize: 16, fontWeight: '600' },
  waGoBtn: { width: 60, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  toolActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 44, borderRadius: 12, gap: 8 },
  resultCard: { marginTop: 20, padding: 20, borderRadius: 20, alignItems: 'center', gap: 5 },
});