import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Dimensions, Platform, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Plus, Search, ChevronLeft, ChevronRight, ChevronDown, Trash2, Edit2, Save, X, Utensils, Calendar, Clock, Rotate3d, Info, PieChart, Repeat, CalendarDays,Settings } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, SlideInBottom, useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as SecureStore from 'expo-secure-store';
import HighchartsChart from '@/components/HighchartsChart';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const WEEKS = [
  { id: 1, label: 'Week 1' },
  { id: 2, label: 'Week 2' },
  { id: 3, label: 'Week 3' },
  { id: 4, label: 'Week 4' }
];

const DAYS = [
  { id: 0, label: 'Sun', initial: 'S' },
  { id: 1, label: 'Mon', initial: 'M' },
  { id: 2, label: 'Tue', initial: 'T' },
  { id: 3, label: 'Wed', initial: 'W' },
  { id: 4, label: 'Thu', initial: 'T' },
  { id: 5, label: 'Fri', initial: 'F' },
  { id: 6, label: 'Sat', initial: 'S' }
];

export default function DietRoutineScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [routines, setRoutines] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  
  // -- CONFIGURATION STATE --
  const [cycleLength, setCycleLength] = useState<number>(4);
  const [isConfigOpen, setIsConfigVisible] = useState(false);

  // -- RECURRENCE & UI STATE --
  const [activeCycle, setActiveCycle] = useState<number>(1);
  const [activeDay, setActiveDay] = useState<number>(new Date().getDay());
  
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Default Mon-Fri
  const [selectedCycleWeek, setSelectedCycleWeek] = useState<number>(0); // 0 = Every Week
  
  const [newRoutine, setNewRoutine] = useState({
    name: '',
    meal_time: '08:00',
    type: 'recipe' as 'recipe' | 'ingredient',
    item_id: '',
    quantity: 1,
    unit: 'serving',
    is_shared: 0,
  });

  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [isPickerMode, setIsPickerMode] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    const today = new Date();
    setActiveDay(today.getDay());
    const getName = async () => {
      try {
        const name = await SecureStore.getItemAsync('user_name');
        setUserName(name || 'Anonymous');
      } catch (e) {
        setUserName('Anonymous');
      }
    };
    getName();
    loadSettings();
    loadLibrary();
    loadRoutines();
  }, []);

  const loadSettings = () => {
    const settings = db.getFirstSync('SELECT cycle_length FROM diet_settings WHERE id = "global"') as any;
    if (settings) {
      setCycleLength(settings.cycle_length);
      const today = new Date();
      setActiveCycle(getCycleWeek(today, settings.cycle_length));
    }
  };

  const updateCycleLength = (len: number) => {
    db.runSync('UPDATE diet_settings SET cycle_length = ? WHERE id = "global"', [len]);
    queueSyncOperation('diet_settings', 'global', 'UPDATE', { id: 'global', cycle_length: len, updated_at: new Date().toISOString() });
    setCycleLength(len);
    const today = new Date();
    setActiveCycle(getCycleWeek(today, len));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const getCycleWeek = (date: Date, length: number = cycleLength) => {
    // Synchronized with main screen logic:
    // 1st-7th is Week 1, 8th-14th is Week 2, etc.
    const dayOfMonth = date.getDate();
    const weekOfMonth = Math.floor((dayOfMonth - 1) / 7) + 1;
    
    // Wrap based on cycle length (1, 2, 4...)
    return ((weekOfMonth - 1) % length) + 1;
  };

  const loadRoutines = () => {
    const data = db.getAllSync('SELECT * FROM diet_plans WHERE is_recurring = 1 ORDER BY meal_time');
    setRoutines(data);
  };

  const loadLibrary = () => {
    setAllRecipes(db.getAllSync('SELECT * FROM recipes'));
    setAllIngredients(db.getAllSync('SELECT * FROM ingredients'));
    setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));
  };

  const saveRoutine = () => {
    if (!newRoutine.item_id) {
      Alert.alert('Missing Item', 'Please select a recipe or ingredient.');
      return;
    }

    const id = editingId || generateUUID();
    const daysStr = selectedDays.sort().join(',');
    
    const payload = {
      id,
      date: new Date().toISOString().split('T')[0], // Base date
      meal_time: newRoutine.meal_time,
      type: newRoutine.type,
      item_id: newRoutine.item_id,
      quantity: newRoutine.quantity,
      unit: newRoutine.unit,
      user_id: userName,
      is_eaten: 0,
      is_shared: newRoutine.is_shared,
      is_recurring: 1,
      days_of_week: daysStr,
      cycle_week: selectedCycleWeek,
      created_at: new Date().toISOString()
    };

    if (editingId) {
      db.runSync('UPDATE diet_plans SET meal_time=?, type=?, item_id=?, quantity=?, unit=?, is_shared=?, days_of_week=?, cycle_week=? WHERE id=?',
        [payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.is_shared, payload.days_of_week, payload.cycle_week, id]);
      queueSyncOperation('diet_plans', id, 'UPDATE', payload);
    } else {
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    }

    setShowAdd(false);
    setEditingId(null);
    loadRoutines();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const deleteRoutine = (id: string) => {
    Alert.alert('Delete Routine', 'Are you sure you want to remove this recurring item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
        queueSyncOperation('diet_plans', id, 'DELETE', { id });
        loadRoutines();
      }}
    ]);
  };

  const toggleDay = (day: number) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter(d => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const getSummaryText = () => {
    let weekText = selectedCycleWeek === 0 ? "Every Week" : `Week ${selectedCycleWeek}`;
    if (selectedDays.length === 7) return `${weekText}, Every day`;
    if (selectedDays.length === 5 && !selectedDays.includes(0) && !selectedDays.includes(6)) return `${weekText}, Every weekday`;
    if (selectedDays.length === 2 && selectedDays.includes(0) && selectedDays.includes(6)) return `${weekText}, Weekends`;
    
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${weekText} on ` + selectedDays.sort().map(d => dayNames[d]).join(', ');
  };

  const filteredRoutines = routines.filter(r => {
    const matchesWeek = r.cycle_week === 0 || r.cycle_week === activeCycle;
    const matchesDay = r.days_of_week?.split(',').includes(activeDay.toString());
    return matchesWeek && matchesDay;
  });

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ paddingTop: insets.top + 20 }}>
        {/* UNIFIED HEADER ROW */}
        <View style={{ paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10 }}>
            <ChevronLeft size={32} color={theme.text} />
          </TouchableOpacity>
          
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Diet Planner</Text>
            <Text style={{ color: theme.text, opacity: 0.5, fontSize: 12 }}>{cycleLength}-Week Rotation Active</Text>
          </View>

          <TouchableOpacity 
            onPress={() => { setIsConfigVisible(!isConfigOpen); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            style={[styles.smallHeaderButton, { backgroundColor: theme.card }]}
          >
            <Settings size={22} color={isConfigOpen ? '#FF2D55' : theme.text} />
          </TouchableOpacity>
        </View>

        {/* CONFIGURATION PANEL */}
        {isConfigOpen && (
          <Animated.View entering={FadeInDown} style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: 'rgba(150,150,150,0.05)', padding: 15, borderRadius: 20 }}>
              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '900', marginBottom: 10, opacity: 0.6, letterSpacing: 1 }}>CYCLE DURATION</Text>
              <View style={[styles.segmentedContainer, { marginBottom: 0 }]}>
                {[1, 2, 4].map(len => (
                  <TouchableOpacity 
                    key={len}
                    onPress={() => updateCycleLength(len)}
                    style={[styles.segmentButton, cycleLength === len && [styles.segmentActive, { backgroundColor: theme.card }]]}
                  >
                    <Text style={[styles.segmentText, { color: cycleLength === len ? '#FF2D55' : theme.text }]}>{len} WK</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: theme.text, fontSize: 10, marginTop: 8, opacity: 0.4 }}>Switching duration adjusts how many weeks your diet rotates through.</Text>
            </View>
          </Animated.View>
        )}

        {/* WEEK SELECTOR */}
        {cycleLength > 1 && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <Text style={{ color: theme.text, fontSize: 13, fontWeight: '800', opacity: 0.5, marginBottom: 10, letterSpacing: 1 }}>CYCLE WEEK</Text>
            <View style={[styles.segmentedContainer, { backgroundColor: 'rgba(150,150,150,0.1)' }]}>
              {WEEKS.slice(0, cycleLength).map(w => (
                <TouchableOpacity 
                  key={w.id}
                  onPress={() => { setActiveCycle(w.id); Haptics.selectionAsync(); }}
                  style={[styles.segmentButton, activeCycle === w.id && [styles.segmentActive, { backgroundColor: theme.card }]]}
                >
                  <Text style={[styles.segmentText, { color: activeCycle === w.id ? '#FF2D55' : theme.text }]}>{w.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* DAY SELECTOR (CALENDAR STYLE) */}
        <View style={{ paddingHorizontal: 15, marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {DAYS.map(d => (
              <TouchableOpacity 
                key={d.id}
                onPress={() => { setActiveDay(d.id); Haptics.selectionAsync(); }}
                style={[styles.calendarDayBtn, activeDay === d.id && { backgroundColor: '#FF2D55' }]}
              >
                <Text style={{ color: activeDay === d.id ? 'white' : theme.text, fontSize: 11, fontWeight: '800', opacity: activeDay === d.id ? 1 : 0.4, marginBottom: 4 }}>{d.label}</Text>
                <Text style={{ color: activeDay === d.id ? 'white' : theme.text, fontSize: 16, fontWeight: '900' }}>{d.initial}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120 }}>
        {filteredRoutines.length === 0 ? (
          <Animated.View entering={FadeInDown} style={styles.emptyContainer}>
            <CalendarDays size={60} color={theme.text} opacity={0.1} />
            <Text style={[styles.emptyText, { color: theme.text }]}>No routines for this day.</Text>
            <TouchableOpacity 
              onPress={() => {
                setEditingId(null);
                setNewRoutine({ meal_time: '08:00', type: 'recipe', item_id: '', quantity: 1, unit: 'serving', is_shared: 0, name: '' });
                setSelectedDays([activeDay]);
                setSelectedCycleWeek(activeCycle);
                setShowAdd(true);
              }}
              style={[styles.createBtn, { backgroundColor: '#FF2D55' }]}
            >
              <Plus size={20} color="white" />
              <Text style={styles.createBtnText}>Add Meal to {DAYS.find(d => d.id === activeDay)?.label}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={{ gap: 12 }}>
            {filteredRoutines.map((item) => {
              const detailItem = item.type === 'recipe' 
                ? allRecipes.find(r => r.id === item.item_id) 
                : allIngredients.find(i => i.id === item.item_id);

              return (
                <Animated.View entering={FadeInDown} key={item.id}>
                  <TouchableOpacity 
                    style={[styles.routineCard, { backgroundColor: theme.card }]}
                    onPress={() => {
                      setEditingId(item.id);
                      setNewRoutine({
                        meal_time: item.meal_time,
                        type: item.type,
                        item_id: item.item_id,
                        quantity: item.quantity,
                        unit: item.unit,
                        is_shared: item.is_shared,
                        name: detailItem?.name || ''
                      });
                      setSelectedDays(item.days_of_week?.split(',').map(Number) || []);
                      setSelectedCycleWeek(item.cycle_week || 0);
                      setShowAdd(true);
                    }}
                  >
                    <View style={styles.cardHeader}>
                      <View style={styles.timeTag}>
                        <Clock size={12} color="#FF2D55" />
                        <Text style={styles.timeText}>{item.meal_time}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        {item.is_shared === 1 ? (
                          <View style={[styles.scopeBadge, { backgroundColor: 'rgba(175,82,222,0.1)' }]}><Info size={10} color="#AF52DE" /><Text style={{ fontSize: 9, color: '#AF52DE', fontWeight: '900' }}> SHARED</Text></View>
                        ) : (
                          <View style={[styles.scopeBadge, { backgroundColor: 'rgba(90,200,250,0.1)' }]}><Plus size={10} color="#5AC8FA" /><Text style={{ fontSize: 9, color: '#5AC8FA', fontWeight: '900' }}> PERSONAL</Text></View>
                        )}
                        {item.cycle_week === 0 ? (
                          <View style={styles.everyWeekBadge}><Repeat size={10} color="#34C759" /><Text style={{ fontSize: 10, color: '#34C759', fontWeight: '800' }}> EVERY WK</Text></View>
                        ) : null}
                        <TouchableOpacity onPress={() => deleteRoutine(item.id)}>
                          <Trash2 size={16} color="#FF2D55" opacity={0.5} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    <Text style={[styles.itemName, { color: theme.text }]}>{detailItem?.name || 'Unknown Item'}</Text>
                    <Text style={{ color: theme.text, opacity: 0.5, fontSize: 12 }}>{item.quantity} {item.unit}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: '#FF2D55', bottom: insets.bottom + 20 }]}
        onPress={() => {
          setEditingId(null);
          setNewRoutine({ meal_time: '08:00', type: 'recipe', item_id: '', quantity: 1, unit: 'serving', is_shared: 0, name: '' });
          setSelectedDays([activeDay]);
          setSelectedCycleWeek(activeCycle);
          setShowAdd(true);
        }}
      >
        <Plus size={30} color="white" />
      </TouchableOpacity>

      {/* ADD/EDIT MODAL */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.background, height: '90%' }]}>
            {!isPickerMode ? (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>{editingId ? 'Edit' : 'Add'} Routine</Text>
                  <TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* 🕒 TIME SELECTION */}
                  <Text style={[styles.inputLabel, { color: theme.text }]}>Scheduled Time</Text>
                  <TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.pickerBtn, { backgroundColor: theme.card }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Clock size={20} color="#FF2D55" />
                      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginLeft: 12 }}>{newRoutine.meal_time}</Text>
                    </View>
                    <ChevronDown size={20} color={theme.text} opacity={0.3} />
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker 
                      value={(() => { const d = new Date(); const [h, m] = newRoutine.meal_time.split(':'); d.setHours(parseInt(h), parseInt(m)); return d; })()}
                      mode="time"
                      is24Hour={true}
                      display="spinner"
                      onChange={(e, d) => {
                        setShowTimePicker(false);
                        if (d) setNewRoutine({...newRoutine, meal_time: format(d, 'HH:mm')});
                      }}
                    />
                  )}

                  {/* 🔄 CYCLE SELECTION */}
                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Cycle Recurrence</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {[{id: 0, label: 'Every Week'}, ...WEEKS].map(w => (
                      <TouchableOpacity 
                        key={w.id}
                        onPress={() => setSelectedCycleWeek(w.id)}
                        style={[styles.weekChip, selectedCycleWeek === w.id && { backgroundColor: '#FF2D55', borderColor: '#FF2D55' }, { borderColor: theme.card }]}
                      >
                        <Text style={{ color: selectedCycleWeek === w.id ? 'white' : theme.text, fontWeight: '800', fontSize: 13 }}>{w.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* 🔄 DAY SELECTION */}
                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Repeats {getSummaryText()}</Text>
                  <View style={styles.daySelector}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                      <TouchableOpacity 
                        key={i} 
                        onPress={() => toggleDay(i)}
                        style={[styles.dayChip, selectedDays.includes(i) && { backgroundColor: '#FF2D55' }, { borderColor: theme.card }]}
                      >
                        <Text style={[styles.dayText, { color: selectedDays.includes(i) ? 'white' : theme.text }]}>{d}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* 👥 PLAN SCOPE */}
                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Plan Scope</Text>
                  <View style={[styles.segmentedContainer, { backgroundColor: 'rgba(150,150,150,0.1)', marginBottom: 20 }]}>
                    <TouchableOpacity onPress={() => setNewRoutine({...newRoutine, is_shared: 0})} style={[styles.segmentButton, newRoutine.is_shared === 0 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                      <Plus size={14} color={newRoutine.is_shared === 0 ? '#5AC8FA' : theme.text} />
                      <Text style={[styles.segmentText, { color: theme.text, fontSize: 10 }]}>PERSONAL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setNewRoutine({...newRoutine, is_shared: 1})} style={[styles.segmentButton, newRoutine.is_shared === 1 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                      <Info size={14} color={newRoutine.is_shared === 1 ? '#AF52DE' : theme.text} />
                      <Text style={[styles.segmentText, { color: theme.text, fontSize: 10 }]}>SHARED (BOTH)</Text>
                    </TouchableOpacity>
                  </View>

                  {/* 🥘 ITEM SELECTION */}
                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Diet Item</Text>
                  <TouchableOpacity 
                    onPress={() => setIsPickerMode(true)}
                    style={[styles.pickerBtn, { backgroundColor: theme.card, height: 60 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={[styles.iconCircle, { backgroundColor: 'rgba(150,150,150,0.1)' }]}>
                        {newRoutine.item_id ? (newRoutine.type === 'recipe' ? <PieChart size={20} color="#FF2D55" /> : <Utensils size={20} color="#34C759" />) : <Search size={20} color={theme.text} opacity={0.3} />}
                      </View>
                      <View style={{ marginLeft: 15 }}>
                        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                          {(() => {
                            if (!newRoutine.item_id) return 'Select Item...';
                            const item = newRoutine.type === 'recipe' ? allRecipes.find(r => r.id === newRoutine.item_id) : allIngredients.find(i => i.id === newRoutine.item_id);
                            return item?.name || 'Selected Item';
                          })()}
                        </Text>
                        {newRoutine.item_id ? <Text style={{ color: theme.text, fontSize: 10, opacity: 0.5, textTransform: 'uppercase', fontWeight: '800' }}>{newRoutine.type}</Text> : null}
                      </View>
                    </View>
                    <ChevronRight size={20} color={theme.text} opacity={0.3} />
                  </TouchableOpacity>

                  <View style={{ flexDirection: 'row', gap: 15, marginTop: 20 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Quantity</Text>
                      <TextInput 
                        keyboardType="decimal-pad" 
                        style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: 'transparent' }]}
                        value={newRoutine.quantity.toString()}
                        onChangeText={v => setNewRoutine({...newRoutine, quantity: parseFloat(v) || 0})}
                      />
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Unit</Text>
                      <View style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: 'transparent', justifyContent: 'center' }]}>
                         <Text style={{ color: theme.text }}>{units.find(u => u.id === newRoutine.unit)?.name || 'serving'}</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity onPress={saveRoutine} style={[styles.saveBtn, { backgroundColor: '#FF2D55' }]}>
                    <Save size={20} color="white" />
                    <Text style={styles.saveBtnText}>{editingId ? 'Update Routine' : 'Add to Routine'}</Text>
                  </TouchableOpacity>
                  <View style={{ height: 50 }} />
                </ScrollView>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => setIsPickerMode(false)} style={styles.backPicker}>
                    <ChevronLeft size={24} color={theme.text} />
                    <Text style={[styles.modalTitle, { color: theme.text, marginLeft: 10 }]}>Select Item</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.searchBar, { backgroundColor: theme.card }]}>
                  <Search size={18} color={theme.text} opacity={0.5} />
                  <TextInput 
                    placeholder="Search..." 
                    style={{ flex: 1, color: theme.text, marginLeft: 10 }}
                    value={pickerSearch}
                    onChangeText={setPickerSearch}
                    autoFocus
                  />
                </View>

                <View style={styles.typeSelector}>
                  {['recipe', 'ingredient'].map(t => (
                    <TouchableOpacity 
                      key={t}
                      onPress={() => setNewRoutine({...newRoutine, type: t as any})}
                      style={[styles.typeBtn, newRoutine.type === t && { backgroundColor: '#FF2D55' }]}
                    >
                      <Text style={[styles.typeText, newRoutine.type === t && { color: 'white' }]}>{t.toUpperCase()}S</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <ScrollView>
                  {(newRoutine.type === 'recipe' ? allRecipes : allIngredients)
                    .filter(i => i.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                    .map(item => (
                      <TouchableOpacity 
                        key={item.id}
                        onPress={() => {
                          setNewRoutine({...newRoutine, item_id: item.id, unit: item.base_unit || 'serving'});
                          setIsPickerMode(false);
                        }}
                        style={[styles.itemCard, { backgroundColor: theme.card }]}
                      >
                        <Text style={{ color: theme.text, fontWeight: '600' }}>{item.name}</Text>
                        <ChevronRight size={18} color={theme.text} opacity={0.3} />
                      </TouchableOpacity>
                    ))
                  }
                </ScrollView>
              </View>
            )}
          </View>
        </BlurView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { marginLeft: 3 },
  headerInfo: { marginBottom: 30 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 16, opacity: 0.3, marginTop: 20, fontWeight: '600' },
  createBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, marginTop: 20, gap: 10 },
  createBtnText: { color: 'white', fontWeight: '800' },
  routineCard: { padding: 20, borderRadius: 24, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  timeTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,45,85,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  timeText: { color: '#FF2D55', fontSize: 12, fontWeight: '900' },
  itemName: { fontSize: 20, fontWeight: '800', marginBottom: 2 },
  fab: { position: 'absolute', right: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  inputLabel: { fontSize: 12, fontWeight: '900', marginBottom: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, height: 50, borderRadius: 15 },
  iconCircle: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  daySelector: { flexDirection: 'row', justifyContent: 'space-between' },
  dayChip: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  dayText: { fontSize: 14, fontWeight: '900' },
  input: { height: 50, borderRadius: 15, paddingHorizontal: 15, fontSize: 16, fontWeight: '700' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 20, marginTop: 40, gap: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
  searchBar: { flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 15, paddingHorizontal: 15, marginBottom: 20 },
  backPicker: { flexDirection: 'row', alignItems: 'center' },
  typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.1)' },
  typeText: { fontSize: 12, fontWeight: '800', color: 'rgba(150,150,150,0.5)' },
  itemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 15, marginBottom: 8 },
  segmentedContainer: { flexDirection: 'row', borderRadius: 14, padding: 3 },
  segmentButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 12 },
  segmentActive: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  segmentText: { fontSize: 13, fontWeight: '800' },
  calendarDayBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, marginHorizontal: 2 },
  weekChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1 },
  everyWeekBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52,199,89,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  scopeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 }
});
