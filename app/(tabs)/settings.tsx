import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, ScrollView, Pressable, Switch, View, Image, ActivityIndicator, Alert, Modal, TextInput, FlatList, TouchableOpacity, DeviceEventEmitter, Platform } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { User, Bell, Shield, CircleHelp, LogOut, ChevronRight, Camera, MessageSquareHeart, HeartHandshake, Tags, Plus, X, Trash2, Briefcase, Wrench, MessageCircle, Clock, TrendingUp, Coffee, Palette, Image as ImageIcon, Edit3, Save, Check, Brain, Layout,Music,Utensils } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import * as SecureStore from 'expo-secure-store';
import * as base64js from 'base64-js';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import { registerForPushNotificationsAsync, syncAllNotifications } from '@/lib/notifications';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import * as Linking from 'expo-linking';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import Wardrobe from '@/components/PlanMode/Wardrobe';
import { TripSoundtrack } from '@/components/PlanMode/TripSoundtrack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';

import * as Haptics from 'expo-haptics';

const CHILL_COLORS = [
  { label: 'Sky', main: '#5AC8FA', bg: 'rgba(90, 200, 250, 0.15)' },
  { label: 'Rose', main: '#FF2D55', bg: 'rgba(255, 45, 85, 0.15)' },
  { label: 'Lavender', main: '#AF52DE', bg: 'rgba(175, 82, 222, 0.15)' },
  { label: 'Mint', main: '#34C759', bg: 'rgba(52, 199, 89, 0.15)' },
  { label: 'Amber', main: '#FF9500', bg: 'rgba(255, 149, 0, 0.15)' },
];

const PRESET_PALETTE = [
  '#FF2D55', '#FF375F', '#FF9500', '#FFCC00', '#34C759', 
  '#007AFF', '#5AC8FA', '#5856D6', '#AF52DE', '#8E8E93',
  '#E5E5EA', '#000000', '#FFFFFF', '#FFD700', '#FF69B4'
];

const isLightColor = (hexColor: string) => {
  if (!hexColor || hexColor.length < 7) return false;
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 186;
};

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isNotificationsEnabled, setIsNotificationsEnabled] = useState(false);

  // Modals Visibility
  const [isChillSettingsVisible, setIsChillSettingsVisible] = useState(false);
  const [isWardrobeSettingsVisible, setIsWardrobeSettingsVisible] = useState(false);
  const [isWardrobeVisible, setIsWardrobeVisible] = useState(false);
  const [isToolsVisible, setIsToolsVisible] = useState(false);
  const [isOurSongsVisible, setIsOurSongsVisible] = useState(false);
  const [isDietSettingsVisible, setIsDietSettingsVisible] = useState(false);
  const [isDietUnitsVisible, setIsDietUnitsVisible] = useState(false);

  // Diet Metrics State
  const [dietMetrics, setDietMetrics] = useState<any[]>([]);
  const [newMetricName, setNewMetricName] = useState('');
  const [newMetricUnit, setNewMetricUnit] = useState('');

  // Diet Units State
  const [dietUnits, setDietUnits] = useState<any[]>([]);
  const [newUnitName, setNewUnitName] = useState('');

  // Chill Categories State
  const [chillCats, setChillCats] = useState<any[]>([]);
  const [editingCat, setEditingCat] = useState<any | null>(null);
  const [catForm, setCatForm] = useState({ name: '', color: '#5AC8FA', image_url: null as string | null });
  const [loadingCats, setLoadingCats] = useState(false);

  // Wardrobe Categories State
  const [wardrobeCats, setWardrobeCats] = useState<any[]>([]);
  const [newWardrobeCat, setNewWardrobeCat] = useState('');

  // Tools State
  const [waNumber, setWaNumber] = useState('');
  const [timeEntries, setTimeEntries] = useState([new Date(), new Date()]);
  const [totalCalculatedTime, setTotalCalculatedTime] = useState<string | null>(null);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchProfile();
    fetchChillCategories();
    fetchWardrobeCategories();
    fetchDietMetrics();
    fetchDietUnits();
  }, []);

  const fetchDietMetrics = () => {
    const data = db.getAllSync('SELECT * FROM diet_metrics ORDER BY created_at ASC');
    setDietMetrics(data);
  };

  const fetchDietUnits = () => {
    const data = db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC');
    setDietUnits(data);
  };

  const addDietUnit = () => {
    if (!newUnitName) return;
    const id = newUnitName.toLowerCase();
    db.runSync('INSERT OR IGNORE INTO diet_units (id, name) VALUES (?, ?)', [id, newUnitName]);
    setNewUnitName('');
    fetchDietUnits();
  };

  const deleteDietUnit = (id: string) => {
    db.runSync('DELETE FROM diet_units WHERE id = ?', [id]);
    fetchDietUnits();
  };

  const addDietMetric = () => {
    if (!newMetricName) return;
    const id = 'm_' + Date.now();
    db.runSync('INSERT INTO diet_metrics (id, name, unit) VALUES (?, ?, ?)', [id, newMetricName, newMetricUnit]);
    setNewMetricName('');
    setNewMetricUnit('');
    fetchDietMetrics();
  };

  const deleteDietMetric = (id: string) => {
    Alert.alert('Delete Metric?', 'This will not delete nutrients already stored in ingredients, but will hide this metric.', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.runSync('DELETE FROM diet_metrics WHERE id = ?', [id]);
        fetchDietMetrics();
      }}
    ]);
  };

  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    // Reset navigation lock when screen focuses
    const sub = DeviceEventEmitter.addListener('focus-settings', () => setIsNavigating(false));
    return () => sub.remove();
  }, []);

  const safePush = (path: any) => {
    if (isNavigating) return;
    setIsNavigating(true);
    router.push(path);
    // Safety timeout in case navigation fails
    setTimeout(() => setIsNavigating(false), 2000);
  };

  const fetchProfile = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setUserName(name);
    if (name) {
      const { data } = await supabase.from('profiles').select('avatar_url, push_token').eq('username', name.toLowerCase()).maybeSingle();
      if (data) {
        setAvatarUrl(data.avatar_url);
        setIsNotificationsEnabled(!!data.push_token);
      }
    }
  };

  const fetchChillCategories = async () => {
    const { data } = await supabase.from('chill_categories').select('*').order('created_at', { ascending: true });
    if (data) setChillCats(data);
  };

  const fetchWardrobeCategories = async () => {
    const { data } = await supabase.from('wardrobe_categories').select('*').order('name', { ascending: true });
    if (data) setWardrobeCats(data);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled && userName) {
      uploadAvatar(result.assets[0].uri);
    }
  };

  const uploadAvatar = async (uri: string) => {
    try {
      setUploading(true);
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const filePath = `avatars/${userName.toLowerCase()}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('journal-assets')
        .upload(filePath, base64js.toByteArray(base64), {
          contentType: 'image/jpeg',
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('journal-assets')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({ 
          username: userName.toLowerCase(), 
          avatar_url: publicUrl 
        }, { onConflict: 'username' });

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);
      Alert.alert('Success', 'Profile picture updated!');
    } catch (error: any) {
      Alert.alert('Upload Error', error.message);
    } finally {
      setUploading(false);
    }
  };

  // --- Chill Logic ---
  const saveChillCategory = async () => {
    if (!catForm.name.trim()) return;
    setLoadingCats(true);
    
    let uploadedUrl = catForm.image_url;
    if (catForm.image_url && !catForm.image_url.startsWith('http')) {
      try {
        const base64 = await FileSystem.readAsStringAsync(catForm.image_url, { encoding: FileSystem.EncodingType.Base64 });
        const filePath = `chill-covers/${Date.now()}.jpg`;
        await supabase.storage.from('journal-assets').upload(filePath, base64js.toByteArray(base64), { contentType: 'image/jpeg' });
        const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
        uploadedUrl = publicUrl;
      } catch (e) { console.error(e); }
    }

    const payload = { name: catForm.name.trim(), color: catForm.color, bg_color: catForm.color + '15', image_url: uploadedUrl };
    const { error } = editingCat ? await supabase.from('chill_categories').update(payload).eq('id', editingCat.id) : await supabase.from('chill_categories').insert([payload]);

    if (!error) {
      setCatForm({ name: '', color: '#5AC8FA', image_url: null });
      setEditingCat(null);
      fetchChillCategories();
    }
    setLoadingCats(false);
  };

  const deleteChillCategory = async (id: string) => {
    Alert.alert('Delete shared space?', 'This will delete all items inside too.', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { 
        await supabase.from('chill_categories').delete().eq('id', id); 
        fetchChillCategories(); 
        syncAllNotifications();
      } }
    ]);
  };

  // --- Wardrobe Logic ---
  const addWardrobeCategory = async () => {
    if (!newWardrobeCat.trim()) return;
    const { error } = await supabase.from('wardrobe_categories').insert([{ name: newWardrobeCat.trim() }]);
    if (!error) { setNewWardrobeCat(''); fetchWardrobeCategories(); }
  };

  const deleteWardrobeCategory = async (id: string) => {
    await supabase.from('wardrobe_categories').delete().eq('id', id);
    fetchWardrobeCategories();
  };

  // --- Tools Logic ---
  const openWhatsApp = () => {
    const cleanNumber = waNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) return Alert.alert('Invalid Number', 'Include country code (e.g. 91)');
    Linking.openURL(`https://wa.me/${cleanNumber}`);
  };

  const calculateTotalTime = () => {
    let totalMinutes = 0;
    for (let i = 0; i < timeEntries.length; i += 2) {
      const start = timeEntries[i], end = timeEntries[i+1];
      if (start && end) {
        let diff = (end.getHours() * 60 + end.getMinutes()) - (start.getHours() * 60 + start.getMinutes());
        if (diff < 0) diff += 24 * 60;
        totalMinutes += diff;
      }
    }
    setTotalCalculatedTime(`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`);
  };

  const toggleNotifications = async (value: boolean) => {
    if (value) {
      const token = await registerForPushNotificationsAsync();
      if (token && userName) await supabase.from('profiles').update({ push_token: token }).eq('username', userName.toLowerCase());
      await syncAllNotifications();
    } else {
      if (userName) await supabase.from('profiles').update({ push_token: null }).eq('username', userName.toLowerCase());
      await Notifications.cancelAllScheduledNotificationsAsync();
    }
    setIsNotificationsEnabled(value);
  };

  const triggerTestNotification = async () => {
    await Notifications.scheduleNotificationAsync({
      content: { title: "✨ Shared Memory Nearby!", body: "Hey! You're near a spot where you shared a memory. ❤️", sound: true },
      trigger: null,
    });
  };

  // Hidden Diary State
  const [secretTapCount, setSecretTapCount] = useState(0);
  const [isPasscodeVisible, setIsPasscodeVisible] = useState(false);
  const [passcode, setPasscode] = useState('');

  const handleSecretTap = () => {
    const newCount = secretTapCount + 1;
    if (newCount >= 5) {
      setSecretTapCount(0);
      setIsPasscodeVisible(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else {
      setSecretTapCount(newCount);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const checkPasscode = (code: string) => {
    setPasscode(code);
    if (code === '102611') {
      setIsPasscodeVisible(false);
      setPasscode('');
      router.push('/diary');
    } else if (code.length >= 6) {
      Alert.alert('Incorrect PIN', 'The vault remains locked.');
      setPasscode('');
    }
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.profileSection}>
          <Pressable onPress={pickImage} style={styles.avatarWrapper}>
            <View style={[styles.avatar, { backgroundColor: theme.tint }]}>
              {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} /> : <Text style={styles.avatarText}>{userName?.charAt(0).toUpperCase()}</Text>}
              {uploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#FFF" />
                </View>
              )}
            </View>
            <View style={[styles.editIcon, { backgroundColor: theme.card }]}>
              <Camera size={14} color={theme.text} />
            </View>
          </Pressable>
          <Text style={[styles.userName, { color: theme.text }]}>{userName === 'love' ? 'Supriya' : 'Pratishth'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.tint }]}>Account</Text>
          <SettingsItem 
            icon={<MessageSquareHeart color={theme.text} size={22} />} 
            label="Message of the Moment" 
            theme={theme} 
            onPress={() => safePush('/motm')}
          />
          <SettingsItem 
            icon={<HeartHandshake color={theme.text} size={22} />} 
            label="Next Meet" 
            theme={theme} 
            onPress={() => safePush('/next-meet')}
          />
          <SettingsItem
            icon={<Layout color={theme.text} size={22} />}
            label="Widget Previews" 
            theme={theme} 
            onPress={() => safePush('/widget-preview')}
          />
          <SettingsItem icon={<Bell color={theme.text} size={22} />} label="Notifications" theme={theme} right={<Switch value={isNotificationsEnabled} onValueChange={toggleNotifications} trackColor={{ true: theme.tint }} />} showChevron={false} />
        </View>

        <View style={styles.section}>
          <TouchableOpacity activeOpacity={1} onPress={handleSecretTap}>
            <Text style={[styles.sectionTitle, { color: theme.tint }]}>App Settings</Text>
          </TouchableOpacity>
          <SettingsItem icon={<Coffee color={theme.text} size={22} />} label="Chill Zone Categories" theme={theme} onPress={() => setIsChillSettingsVisible(true)} />
          <SettingsItem icon={<Tags color={theme.text} size={22} />} label="Wardrobe Categories" theme={theme} onPress={() => setIsWardrobeSettingsVisible(true)} />
          <SettingsItem icon={<Briefcase color={theme.text} size={22} />} label="Master Wardrobe" theme={theme} onPress={() => setIsWardrobeVisible(true)} />
          <SettingsItem icon={<Music color="#1DB954" size={22} />} label="Our Songs" theme={theme} onPress={() => setIsOurSongsVisible(true)} />
          <SettingsItem icon={<Utensils color="#FF2D55" size={22} />} label="Diet Metrics" theme={theme} onPress={() => setIsDietSettingsVisible(true)} />
          <SettingsItem icon={<Briefcase color="#AF52DE" size={22} />} label="Diet Units" theme={theme} onPress={() => setIsDietUnitsVisible(true)} />
          <SettingsItem icon={<Wrench color={theme.text} size={22} />} label="Tools" theme={theme} onPress={() => setIsToolsVisible(true)} />
          <SettingsItem icon={<LogOut color="#FF3B30" size={22} />} label="Logout" theme={theme} onPress={() => router.replace('/auth/login')} labelStyle={{ color: "#FF3B30" }} showChevron={false} />
        </View>
      </ScrollView>

      {/* 🔐 PASSCODE MODAL */}
      <Modal visible={isPasscodeVisible} transparent animationType="fade">
        <BlurView intensity={80} tint="dark" style={styles.pickerOverlayCenter}>
          <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.pickerCard, { backgroundColor: '#1A1A1A' }]}>
            <Text style={{ color: 'white', fontSize: 20, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>Private Vault</Text>
            <Text style={{ color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 25 }}>Enter 6-digit PIN to access Diary</Text>
            
            <TextInput
              style={{ 
                backgroundColor: '#333', 
                color: 'white', 
                height: 60, 
                borderRadius: 15, 
                textAlign: 'center', 
                fontSize: 32, 
                fontWeight: '900',
                letterSpacing: 10
              }}
              keyboardType="number-pad"
              maxLength={6}
              secureTextEntry
              autoFocus
              value={passcode}
              onChangeText={checkPasscode}
            />

            <TouchableOpacity 
              style={[styles.doneBtn, { backgroundColor: '#444', marginTop: 20 }]} 
              onPress={() => { setIsPasscodeVisible(false); setPasscode(''); }}
            >
              <Text style={styles.doneBtnText}>Cancel</Text>
            </TouchableOpacity>
          </MotiView>
        </BlurView>
      </Modal>

      {/* ❄️ CHILL ZONE MODAL */}
      <Modal visible={isChillSettingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Chill Categories</Text>
              <TouchableOpacity onPress={() => setIsChillSettingsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <View style={styles.formCard}>
              <View style={styles.row}>
                <TouchableOpacity onPress={async () => {
                  let res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
                  if (!res.canceled) setCatForm({...catForm, image_url: res.assets[0].uri});
                }} style={[styles.imageCircle, { borderColor: catForm.color }]}>
                  {catForm.image_url ? <Image source={{ uri: catForm.image_url }} style={styles.fullImage} /> : <ImageIcon size={20} color="#888" />}
                </TouchableOpacity>
                <TextInput style={[styles.modalInput, { flex: 1, backgroundColor: theme.background, color: theme.text }]} placeholder="Name" value={catForm.name} onChangeText={(v) => setCatForm({...catForm, name: v})} />
              </View>
              <View style={styles.colorGrid}>
                {PRESET_PALETTE.map(c => <TouchableOpacity key={c} onPress={() => setCatForm({...catForm, color: c})} style={[styles.colorChip, { backgroundColor: c }, catForm.color === c && { borderWidth: 2, borderColor: theme.text }]} />)}
              </View>
              <TouchableOpacity onPress={saveChillCategory} style={[styles.addBtnFull, { backgroundColor: catForm.color }]}>
                <Save size={20} color={isLightColor(catForm.color) ? '#000' : 'white'} />
                <Text style={[styles.addBtnText, { color: isLightColor(catForm.color) ? '#000' : 'white' }]}>Save Space</Text>
              </TouchableOpacity>
            </View>
            <FlatList data={chillCats} renderItem={({item}) => (
              <View style={[styles.catItem, { backgroundColor: theme.card }]}>
                <Text style={[styles.catName, { color: theme.text }]}>{item.name}</Text>
                <View style={styles.row}>
                  <TouchableOpacity onPress={() => { setEditingCat(item); setCatForm({ name: item.name, color: item.color, image_url: item.image_url }); }} style={styles.iconAction}><Edit3 size={16} color={theme.tint} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteChillCategory(item.id)} style={styles.iconAction}><Trash2 size={16} color="#FF3B30" /></TouchableOpacity>
                </View>
              </View>
            )} />
          </BlurView>
        </View>
      </Modal>

      {/* 🛠️ TOOLS MODAL */}
      <Modal visible={isToolsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Tools & Utils</Text>
              <TouchableOpacity onPress={() => setIsToolsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView>
              <View style={styles.toolSection}>
                <Text style={[styles.sectionLabel, { color: theme.tint }]}>Direct WhatsApp</Text>
                <View style={styles.row}>
                  <TextInput style={[styles.modalInput, { flex: 1, backgroundColor: theme.background, color: theme.text }]} placeholder="919876543210" keyboardType="phone-pad" value={waNumber} onChangeText={setWaNumber} />
                  <TouchableOpacity onPress={openWhatsApp} style={[styles.waGoBtn, { backgroundColor: '#25D366' }]}><Text style={{ color: 'white', fontWeight: 'bold' }}>GO</Text></TouchableOpacity>
                </View>
              </View>
              
              <View style={styles.toolSection}>
                <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
                  <Text style={[styles.sectionLabel, { color: theme.tint, marginBottom: 0 }]}>Time Calculator</Text>
                  <TouchableOpacity onPress={() => { setTimeEntries([new Date(), new Date()]); setTotalCalculatedTime(null); }}>
                    <Text style={{ color: '#FF3B30', fontWeight: '900', fontSize: 11 }}>RESET ALL</Text>
                  </TouchableOpacity>
                </View>
                
                {Array.from({ length: Math.ceil(timeEntries.length / 2) }).map((_, groupIdx) => (
                  <View key={groupIdx} style={styles.timeGroup}>
                    <View style={{ flex: 1, gap: 5 }}>
                      <TouchableOpacity onPress={() => setPickerIndex(groupIdx * 2)} style={[styles.modalInput, { backgroundColor: theme.background, justifyContent: 'center', height: 44 }]}>
                        <Text style={{ color: theme.text, fontSize: 13 }}>Start: {format(timeEntries[groupIdx * 2], 'HH:mm')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setPickerIndex(groupIdx * 2 + 1)} style={[styles.modalInput, { backgroundColor: theme.background, justifyContent: 'center', height: 44 }]}>
                        <Text style={{ color: theme.text, fontSize: 13 }}>End: {format(timeEntries[groupIdx * 2 + 1], 'HH:mm')}</Text>
                      </TouchableOpacity>
                    </View>
                    {timeEntries.length > 2 && (
                      <TouchableOpacity 
                        onPress={() => {
                          const n = [...timeEntries];
                          n.splice(groupIdx * 2, 2);
                          setTimeEntries(n);
                        }} 
                        style={styles.deleteTimeBtn}
                      >
                        <Trash2 size={18} color="#FF3B30" opacity={0.6} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}

                <Modal visible={pickerIndex !== null} transparent animationType="fade">
                  <View style={styles.pickerOverlayCenter}>
                    <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.pickerCard, { backgroundColor: theme.card }]}>
                      <Text style={[styles.pickerTitle, { color: theme.text }]}>Select Time</Text>
                      {pickerIndex !== null && (
                        <DateTimePicker 
                          value={timeEntries[pickerIndex]} 
                          mode="time" 
                          is24Hour={true}
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          themeVariant={colorScheme}
                          onChange={(e, d) => { 
                            if (Platform.OS === 'android') { setPickerIndex(null); if(d) { const n = [...timeEntries]; n[pickerIndex!] = d; setTimeEntries(n); } }
                            else if(d) { const n = [...timeEntries]; n[pickerIndex!] = d; setTimeEntries(n); }
                          }} 
                          style={{ height: 200 }} 
                        />
                      )}
                      <TouchableOpacity 
                        style={[styles.doneBtn, { backgroundColor: theme.tint }]} 
                        onPress={() => setPickerIndex(null)}
                      >
                        <Text style={styles.doneBtnText}>Confirm Time</Text>
                      </TouchableOpacity>
                    </MotiView>
                  </View>
                </Modal>

                <View style={[styles.row, { marginTop: 15 }]}>
                  <TouchableOpacity onPress={() => setTimeEntries([...timeEntries, new Date(), new Date()])} style={[styles.toolActionBtn, { backgroundColor: theme.background }]}>
                    <Text style={{ color: theme.text, fontWeight: '800' }}>+ ADD PAIR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={calculateTotalTime} style={[styles.toolActionBtn, { backgroundColor: theme.tint }]}>
                    <Text style={{ color: 'white', fontWeight: '800' }}>CALCULATE</Text>
                  </TouchableOpacity>
                </View>
                {totalCalculatedTime && (
                  <MotiView from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={styles.resultCard}>
                    <Text style={{ color: theme.tabIconDefault, fontSize: 10, fontWeight: '900', marginBottom: 5 }}>TOTAL DURATION</Text>
                    <Text style={{ color: theme.tint, fontSize: 32, fontWeight: '900' }}>{totalCalculatedTime}</Text>
                  </MotiView>
                )}
              </View>
            </ScrollView>
          </BlurView>
        </View>
      </Modal>

      {/* 🏷️ WARDROBE CATEGORIES MODAL */}
      <Modal visible={isWardrobeSettingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Wardrobe Categories</Text>
              <TouchableOpacity onPress={() => setIsWardrobeSettingsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TextInput style={[styles.modalInput, { flex: 1, backgroundColor: theme.background, color: theme.text }]} placeholder="New Category" value={newWardrobeCat} onChangeText={setNewWardrobeCat} />
              <TouchableOpacity onPress={addWardrobeCategory} style={[styles.waGoBtn, { backgroundColor: theme.tint }]}><Plus size={20} color="white" /></TouchableOpacity>
            </View>
            <FlatList data={wardrobeCats} renderItem={({item}) => (
              <View style={styles.catItem}><Text style={{ color: theme.text }}>{item.name}</Text><TouchableOpacity onPress={() => deleteWardrobeCategory(item.id)}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity></View>
            )} />
          </BlurView>
        </View>
      </Modal>

      {/* 👕 MASTER WARDROBE MODAL */}
      <Modal visible={isWardrobeVisible} animationType="slide">
        <Wardrobe 
          userId={userName || ''} 
          isSettingsMode={true} 
          onClose={() => setIsWardrobeVisible(false)} 
        />
      </Modal>

      {/* 🎵 OUR SONGS MODAL */}
      <Modal visible={isOurSongsVisible} animationType="slide">
        <TripSoundtrack 
          tripId="MASTER" 
          tripName="Our Songs" 
          isMaster={true} 
          onClose={() => setIsOurSongsVisible(false)} 
        />
      </Modal>

      {/* 🥦 DIET METRICS MODAL */}
      <Modal visible={isDietSettingsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Diet Metrics</Text>
              <TouchableOpacity onPress={() => setIsDietSettingsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            
            <View style={styles.formCard}>
              <Text style={[styles.sectionLabel, { color: theme.tint }]}>Add New Metric</Text>
              <TextInput 
                style={[styles.modalInput, { backgroundColor: theme.background, color: theme.text, marginBottom: 10 }]} 
                placeholder="Metric Name (e.g. Protein)" 
                value={newMetricName} 
                onChangeText={setNewMetricName} 
              />
              
              <Text style={[styles.sectionLabel, { color: theme.tint, marginTop: 5 }]}>Select Unit</Text>
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                {dietUnits.map(u => (
                  <TouchableOpacity 
                    key={u.id} 
                    onPress={() => setNewMetricUnit(u.id)}
                    style={[
                      styles.smallTab, 
                      { backgroundColor: newMetricUnit === u.id ? '#FF2D55' : 'rgba(150,150,150,0.1)', marginBottom: 5 }
                    ]}
                  >
                    <Text style={{ color: newMetricUnit === u.id ? 'white' : theme.text, fontSize: 12, fontWeight: '700' }}>{u.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity onPress={addDietMetric} style={[styles.addBtnFull, { backgroundColor: '#FF2D55', marginTop: 10 }]}>
                <Plus size={20} color="white" />
                <Text style={styles.addBtnText}>Add Metric</Text>
              </TouchableOpacity>
            </View>

            <FlatList 
              data={dietMetrics} 
              keyExtractor={item => item.id}
              renderItem={({item}) => (
                <View style={[styles.catItem, { backgroundColor: theme.card }]}>
                  <Text style={[styles.catName, { color: theme.text }]}>{item.name} ({item.unit})</Text>
                  <TouchableOpacity onPress={() => deleteDietMetric(item.id)}>
                    <Trash2 size={18} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              )} 
            />
          </BlurView>
        </View>
      </Modal>

      {/* 📏 DIET UNITS MODAL */}
      <Modal visible={isDietUnitsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Diet Units</Text>
              <TouchableOpacity onPress={() => setIsDietUnitsVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>
            
            <View style={styles.formCard}>
              <Text style={[styles.sectionLabel, { color: theme.tint }]}>Add New Unit</Text>
              <View style={styles.row}>
                <TextInput 
                  style={[styles.modalInput, { flex: 1, backgroundColor: theme.background, color: theme.text }]} 
                  placeholder="Unit Name (e.g. serving)" 
                  value={newUnitName} 
                  onChangeText={setNewUnitName} 
                />
                <TouchableOpacity onPress={addDietUnit} style={[styles.waGoBtn, { backgroundColor: '#AF52DE' }]}>
                  <Plus size={20} color="white" />
                </TouchableOpacity>
              </View>
            </View>

            <FlatList 
              data={dietUnits} 
              keyExtractor={item => item.id}
              renderItem={({item}) => (
                <View style={[styles.catItem, { backgroundColor: theme.card }]}>
                  <Text style={[styles.catName, { color: theme.text }]}>{item.name}</Text>
                  <TouchableOpacity onPress={() => deleteDietUnit(item.id)}>
                    <Trash2 size={18} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              )} 
            />
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
  editIcon: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#FFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  avatarText: { color: '#FFF', fontSize: 28, fontWeight: 'bold' },
  userName: { fontSize: 24, fontWeight: '700' },
  userEmail: { fontSize: 14, marginTop: 4 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, marginLeft: 4 },
  settingsItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderRadius: 16, marginBottom: 8 },
  settingsItemLeft: { flexDirection: 'row', alignItems: 'center' },
  settingsLabel: { fontSize: 16, fontWeight: '600', marginLeft: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '90%', borderTopLeftRadius: 35, borderTopRightRadius: 35, padding: 25, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  formCard: { backgroundColor: 'rgba(150,150,150,0.05)', padding: 20, borderRadius: 25, marginBottom: 25, gap: 15 },
  row: { flexDirection: 'row', gap: 15, alignItems: 'center' },
  imageCircle: { width: 64, height: 64, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  fullImage: { width: '100%', height: '100%' },
  modalInput: { height: 56, borderRadius: 18, paddingHorizontal: 20, fontWeight: '600' },
  sectionLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  colorChip: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  addBtnFull: { height: 56, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  addBtnText: { color: 'white', fontWeight: '900', fontSize: 16 },
  catItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderRadius: 20, marginBottom: 10 },
  catName: { fontSize: 16, fontWeight: '800' },
  smallTab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)', marginRight: 8, minWidth: 45, alignItems: 'center', justifyContent: 'center' },
  iconAction: { padding: 10, borderRadius: 12 },
  toolSection: { marginBottom: 30 },
  waGoBtn: { width: 56, height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  toolActionBtn: { flex: 1, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  resultCard: { marginTop: 15, padding: 20, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.1)', alignItems: 'center' },
  timeGroup: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 15, backgroundColor: 'rgba(150,150,150,0.05)', padding: 10, borderRadius: 15 },
  deleteTimeBtn: { padding: 10 },
  pickerOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  pickerCard: { width: '100%', backgroundColor: 'white', borderRadius: 32, padding: 25, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  pickerTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  doneBtn: { height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  doneBtnText: { color: 'white', fontSize: 16, fontWeight: '800' }
});
