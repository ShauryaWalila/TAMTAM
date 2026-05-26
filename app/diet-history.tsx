import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Dimensions, Platform, FlatList, DeviceEventEmitter, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Plus, Search, ChevronLeft, ChevronRight, ChevronDown, Trash2, Edit2, Save, X, Utensils, Calendar, Clock, Rotate3d, Info, PieChart, Repeat, CalendarDays, Settings, CheckCircle2, TrendingUp } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, SlideInBottom } from 'react-native-reanimated';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import { refreshAllNow } from '@/lib/syncEngine';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as SecureStore from 'expo-secure-store';
import HighchartsChart from '@/components/HighchartsChart';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, isToday, isYesterday, parseISO } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function ConsumedHistoryScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [consumed, setConsumed] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const [showStats, setShowStats] = useState<any | null>(null);
  const [showOptions, setShowOptions] = useState<any | null>(null);
  const [metrics, setMetrics] = useState<any[]>([]);

  const [newLog, setNewLog] = useState({
    meal_time: format(new Date(), 'HH:mm'),
    date: new Date(),
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
  const [showDatePicker, setShowDatePicker] = useState(false);

  useEffect(() => {
    const getName = async () => {
      try {
        const name = await SecureStore.getItemAsync('user_name');
        setUserName(name || 'Anonymous');
      } catch (e) {
        setUserName('Anonymous');
      }
    };
    getName();
    loadConsumed();
    loadLibrary();
    loadMetrics();
    const sub = DeviceEventEmitter.addListener('refresh-diet-library', () => {
      loadLibrary();
      loadConsumed();
    });
    return () => sub.remove();
  }, []);

  const loadConsumed = () => {
    // Load all items where is_eaten = 1 (Consumed) or 2 (Not Consumed)
    const data = db.getAllSync('SELECT * FROM diet_plans WHERE is_eaten IN (1, 2) ORDER BY date DESC, meal_time DESC LIMIT 150');
    setConsumed(data);
  };

  const loadLibrary = () => {
    setAllRecipes(db.getAllSync('SELECT * FROM recipes'));
    setAllIngredients(db.getAllSync('SELECT * FROM ingredients'));
    setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));
  };

  const loadMetrics = () => {
    const data = db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1');
    setMetrics(data);
  };

  const unmarkRoutine = (id: string) => {
    db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
    queueSyncOperation('diet_plans', id, 'DELETE', { id });
    loadConsumed();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowOptions(null);
  };

  const getItemNutrients = (plan: any) => {
    let totalNutrients: any = {};
    metrics.forEach(m => totalNutrients[m.id] = 0);
    
    if (plan.is_eaten === 2) return totalNutrients; // No nutrients for skipped items

    if (plan.type === 'ingredient') {
      const ing = db.getFirstSync('SELECT * FROM ingredients WHERE id = ?', [plan.item_id]) as any;
      if (ing) {
        const nutrients = JSON.parse(ing.nutrients || '{}');
        const ratio = (parseFloat(plan.quantity) || 0) / (ing.base_quantity || 1);
        metrics.forEach(m => totalNutrients[m.id] = (nutrients[m.id] || 0) * ratio);
      }
    } else {
      const recipe = db.getFirstSync('SELECT * FROM recipes WHERE id = ?', [plan.item_id]) as any;
      if (recipe) {
        const recipeRatio = (parseFloat(plan.quantity) || 0) / (recipe.base_quantity || 1);
        if (recipe.nutrients) {
          const manualNutrients = JSON.parse(recipe.nutrients);
          metrics.forEach(m => totalNutrients[m.id] = (manualNutrients[m.id] || 0) * recipeRatio);
        } else {
          const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [plan.item_id]) as any[];
          recipeIngs.forEach(ri => {
            const nutrients = JSON.parse(ri.nutrients || '{}');
            const ingRatio = (ri.quantity / (ri.base_quantity || 1));
            metrics.forEach(m => {
              totalNutrients[m.id] += (nutrients[m.id] || 0) * ingRatio * recipeRatio;
            });
          });
        }
      }
    }
    return totalNutrients;
  };

  const getMealComponents = (plan: any) => {
    if (plan.type === 'ingredient') {
      const item = allIngredients.find(i => i.id === plan.item_id);
      return [{ name: item?.name || 'Unknown Ingredient', quantity: plan.quantity, unit: plan.unit }];
    } else {
      const recipe = allRecipes.find(r => r.id === plan.item_id);
      if (!recipe) return [];
      
      const recipeRatio = (parseFloat(plan.quantity) || 0) / (recipe.base_quantity || 1);
      const recipeIngs = db.getAllSync(`
        SELECT ri.quantity as ing_qty, i.name, i.base_unit 
        FROM recipe_ingredients ri 
        JOIN ingredients i ON ri.ingredient_id = i.id 
        WHERE ri.recipe_id = ?
      `, [plan.item_id]) as any[];
      
      return recipeIngs.map(ri => ({
        name: ri.name,
        quantity: (ri.ing_qty * recipeRatio).toFixed(1),
        unit: ri.base_unit || 'serving'
      }));
    }
  };

  const saveLog = () => {
    if (!newLog.item_id) {
      Alert.alert('Missing Item', 'Please select what you ate.');
      return;
    }

    const id = editingId || generateUUID();
    const dateStr = format(newLog.date, 'yyyy-MM-dd');
    
    const payload = {
      id,
      date: dateStr,
      meal_time: newLog.meal_time,
      type: newLog.type,
      item_id: newLog.item_id,
      quantity: newLog.quantity,
      unit: newLog.unit,
      user_id: userName,
      is_eaten: 1,
      is_shared: newLog.is_shared,
      is_recurring: 0, // Manual logs are typically one-off
      created_at: new Date().toISOString()
    };

    if (editingId) {
      db.runSync('UPDATE diet_plans SET date=?, meal_time=?, type=?, item_id=?, quantity=?, unit=?, is_shared=?, user_id=? WHERE id=?',
        [payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.is_shared, payload.user_id, id]);
      queueSyncOperation('diet_plans', id, 'UPDATE', payload);
    } else {
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    }

    setShowAdd(false);
    setEditingId(null);
    loadConsumed();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const deleteLog = (id: string) => {
    Alert.alert('Remove Log', 'Are you sure you want to remove this entry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
        queueSyncOperation('diet_plans', id, 'DELETE', { id });
        loadConsumed();
      }}
    ]);
  };

  const formatDateLabel = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'TODAY';
    if (isYesterday(date)) return 'YESTERDAY';
    return format(date, 'EEEE, MMM do').toUpperCase();
  };

  // Grouping by date for the list
  const groupedConsumed: { [key: string]: any[] } = {};
  consumed.forEach(item => {
    if (!groupedConsumed[item.date]) groupedConsumed[item.date] = [];
    groupedConsumed[item.date].push(item);
  });

  const sortedDates = Object.keys(groupedConsumed).sort((a, b) => b.localeCompare(a));

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ paddingTop: insets.top + 20 }}>
        {/* UNIFIED HEADER ROW */}
        <View style={{ paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 10 }}>
            <ChevronLeft size={32} color={theme.text} />
          </TouchableOpacity>
          
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Consumed</Text>
            <Text style={{ color: theme.text, opacity: 0.5, fontSize: 12 }}>Daily Report & History</Text>
          </View>

          <View style={{ width: 40 }} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl
          refreshing={isRefreshing}
          onRefresh={async () => {
            setIsRefreshing(true);
            try { await refreshAllNow(); } catch {}
            setIsRefreshing(false);
          }}
          tintColor={theme?.tint || '#5856D6'}
        />}
      >
        {consumed.length === 0 ? (
          <View style={styles.emptyContainer}>
            <CheckCircle2 size={60} color={theme.text} opacity={0.1} />
            <Text style={[styles.emptyText, { color: theme.text }]}>No history found.</Text>
            <TouchableOpacity 
              onPress={() => setShowAdd(true)}
              style={[styles.createBtn, { backgroundColor: '#34C759' }]}
            >
              <Plus size={20} color="white" />
              <Text style={styles.createBtnText}>Log Exceptional Meal</Text>
            </TouchableOpacity>
          </View>
        ) : (
          sortedDates.map(date => (
            <View key={date} style={{ marginBottom: 30 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <Text style={{ color: isToday(parseISO(date)) ? '#34C759' : theme.text, fontSize: 13, fontWeight: '900', opacity: isToday(parseISO(date)) ? 1 : 0.4, letterSpacing: 1.5 }}>
                  {formatDateLabel(date)}
                </Text>
                {isToday(parseISO(date)) && (
                   <View style={{ backgroundColor: 'rgba(52,199,89,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                      <Text style={{ color: '#34C759', fontSize: 9, fontWeight: '900' }}>REPORT ACTIVE</Text>
                   </View>
                )}
              </View>
              
              <View style={{ gap: 10 }}>
                {groupedConsumed[date].map(item => {
                  const detailItem = item.type === 'recipe' 
                    ? allRecipes.find(r => r.id === item.item_id) 
                    : allIngredients.find(i => i.id === item.item_id);
                  
                  return (
                    <TouchableOpacity 
                      key={item.id} 
                      style={[styles.historyCard, { backgroundColor: theme.card, borderLeftWidth: 4, borderLeftColor: item.is_eaten === 2 ? 'rgba(150,150,150,0.3)' : (item.is_shared ? '#AF52DE' : '#34C759') }]}
                      onPress={() => {
                        const nutrients = getItemNutrients(item);
                        const components = getMealComponents(item);
                        setShowStats({ ...item, nutrients, components, detailItem });
                      }}
                      onLongPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                        setShowOptions(item);
                      }}
                      delayLongPress={500}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <View style={[styles.iconBox, { backgroundColor: item.is_eaten === 2 ? 'rgba(150,150,150,0.1)' : (item.is_shared ? 'rgba(175,82,222,0.1)' : 'rgba(52,199,89,0.1)') }]}>
                          {item.is_eaten === 2 ? <X size={18} color={theme.text} opacity={0.5} /> : (item.type === 'recipe' ? <PieChart size={18} color={item.is_shared ? '#AF52DE' : '#34C759'} /> : <Utensils size={18} color={item.is_shared ? '#AF52DE' : '#34C759'} />)}
                        </View>
                        <View style={{ flex: 1, marginLeft: 15 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                             <Text style={{ color: theme.text, fontSize: 10, fontWeight: '800', opacity: 0.5 }}>{item.meal_time}</Text>
                             <View style={{ backgroundColor: 'rgba(150,150,150,0.05)', paddingHorizontal: 4, borderRadius: 4 }}>
                                <Text style={{ color: theme.text, fontSize: 8, fontWeight: '800', opacity: 0.5 }}>{item.user_id?.substring(0, 8)}</Text>
                             </View>
                             {item.is_recurring === 0 && (
                               <View style={[styles.miniBadge, { backgroundColor: 'rgba(52,199,89,0.1)' }]}>
                                 <Text style={[styles.miniBadgeText, { color: '#34C759' }]}>ONE-TIME</Text>
                               </View>
                             )}
                             {item.is_eaten === 2 && <View style={[styles.miniBadge, { backgroundColor: 'rgba(255,59,48,0.1)' }]}><Text style={[styles.miniBadgeText, { color: '#FF3B30' }]}>SKIPPED</Text></View>}
                          </View>
                          <Text style={[styles.itemName, { color: theme.text, textDecorationLine: item.is_eaten === 2 ? 'line-through' : 'none' }]} numberOfLines={1}>{detailItem?.name || 'Unknown'}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                         <Text style={{ color: theme.text, fontWeight: '800', fontSize: 14 }}>{item.quantity}</Text>
                         <Text style={{ color: theme.text, opacity: 0.3, fontSize: 9, fontWeight: '700' }}>{item.unit?.toUpperCase()}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: '#34C759', bottom: insets.bottom + 20 }]}
        onPress={() => {
          setEditingId(null);
          setNewLog({ meal_time: format(new Date(), 'HH:mm'), date: new Date(), type: 'recipe', item_id: '', quantity: 1, unit: 'serving', is_shared: 0 });
          setShowAdd(true);
        }}
      >
        <Plus size={30} color="white" />
      </TouchableOpacity>

      {/* STATS MODAL (Single Tap) */}
      <Modal visible={!!showStats} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, height: '90%' }]}>
              <View style={[styles.modalHeader, { borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)', paddingBottom: 15 }]}>
                <View style={{ flex: 1, marginRight: 15 }}>
                  <Text style={[styles.modalTitle, { color: theme.text }]} numberOfLines={1}>{showStats?.detailItem?.name}</Text>
                  <Text style={{ color: theme.text, opacity: 0.5, fontSize: 10, fontWeight: '800', textTransform: 'uppercase' }}>{showStats?.is_eaten === 2 ? 'Skipped Meal' : 'Meal Breakdown'}</Text>
                </View>
                <TouchableOpacity onPress={() => setShowStats(null)}><X size={24} color={theme.text} /></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                 <View style={{ marginTop: 15 }}>
                    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                       <View style={styles.timeTag}><Clock size={12} color={showStats?.is_eaten === 2 ? theme.text : "#34C759"} opacity={showStats?.is_eaten === 2 ? 0.5 : 1} /><Text style={[styles.timeText, showStats?.is_eaten === 2 && { color: theme.text, opacity: 0.6 }]}>{showStats?.meal_time}</Text></View>
                       <View style={[styles.timeTag, { backgroundColor: 'rgba(150,150,150,0.05)' }]}><Calendar size={12} color={theme.text} opacity={0.5} /><Text style={[styles.timeText, { color: theme.text, opacity: 0.6 }]}>{showStats?.date ? format(parseISO(showStats.date), 'MMM do, yyyy') : ''}</Text></View>
                    </View>

                    {showStats?.is_eaten !== 2 ? (
                      <View style={[styles.glassCard, { backgroundColor: '#34C759', marginBottom: 25 }]}>
                          <Text style={{ color: 'white', fontWeight: '800', marginBottom: 15 }}>NUTRIENT BREAKDOWN</Text>
                          <View style={styles.nutrientGrid}>
                            {metrics.map(m => (
                              <NutrientItem key={m.id} label={m.name} value={showStats?.nutrients[m.id]?.toFixed(1)} unit={m.unit} color="white" />
                            ))}
                          </View>
                      </View>
                    ) : (
                      <View style={[styles.glassCard, { backgroundColor: 'rgba(150,150,150,0.1)', marginBottom: 25 }]}>
                         <Text style={{ color: theme.text, fontWeight: '800', opacity: 0.5 }}>This item was marked as NOT CONSUMED. Nutrients were not added to your daily total.</Text>
                      </View>
                    )}

                    <Text style={[styles.inputLabel, { color: theme.text, marginTop: 20 }]}>Meal Components</Text>
                    <View style={{ gap: 8, marginBottom: 25 }}>
                       {showStats?.components?.map((c: any, i: number) => (
                         <View key={i} style={[styles.componentItem, { backgroundColor: theme.card }]}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                               <View style={{ width: 4, height: 20, borderRadius: 2, backgroundColor: showStats?.is_eaten === 2 ? theme.text : '#34C759', opacity: showStats?.is_eaten === 2 ? 0.2 : 1 }} />
                               <Text style={{ color: theme.text, fontWeight: '700', textDecorationLine: showStats?.is_eaten === 2 ? 'line-through' : 'none', opacity: showStats?.is_eaten === 2 ? 0.5 : 1 }}>{c.name}</Text>
                            </View>
                            <Text style={{ color: theme.text, opacity: 0.5, fontSize: 12, fontWeight: '800' }}>{c.quantity} {c.unit}</Text>
                         </View>
                       ))}
                    </View>

                    <Text style={[styles.inputLabel, { color: theme.text }]}>Log Details</Text>
                    <View style={[styles.historyCard, { backgroundColor: theme.card }]}>
                       <Text style={{ color: theme.text, fontWeight: '600' }}>Status</Text>
                       <Text style={{ color: showStats?.is_eaten === 2 ? '#FF3B30' : '#34C759', fontWeight: '800' }}>{showStats?.is_eaten === 2 ? 'Not Consumed' : 'Consumed'}</Text>
                    </View>
                    <View style={[styles.historyCard, { backgroundColor: theme.card }]}>
                       <Text style={{ color: theme.text, fontWeight: '600' }}>Quantity</Text>
                       <Text style={{ color: theme.text, fontWeight: '800' }}>{showStats?.quantity} {showStats?.unit}</Text>
                    </View>
                 </View>
                 <View style={{ height: 100 }} />
              </ScrollView>
           </View>
        </BlurView>
      </Modal>

      {/* OPTIONS MENU (Long Press) */}
      <Modal visible={!!showOptions} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptions(null)}>
          <BlurView intensity={20} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <View style={[styles.optionsMenu, { backgroundColor: theme.background }]}>
            <Text style={[styles.optionsTitle, { color: theme.text }]}>Manage Entry</Text>
            
            {/* UNMARK OPTION (Only for today's routine items) */}
            {showOptions?.is_recurring === 1 && showOptions?.date === format(new Date(), 'yyyy-MM-dd') && (
              <TouchableOpacity 
                onPress={() => unmarkRoutine(showOptions.id)} 
                style={[styles.optionBtn, { backgroundColor: 'rgba(255,45,85,0.05)' }]}
              >
                <Repeat size={20} color="#FF2D55" /><Text style={[styles.optionText, { color: '#FF2D55' }]}>Unmark (Back to Routine)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity 
              onPress={() => {
                const item = showOptions;
                setEditingId(item.id);
                setNewLog({
                  date: parseISO(item.date),
                  meal_time: item.meal_time,
                  type: item.type,
                  item_id: item.item_id,
                  quantity: item.quantity,
                  unit: item.unit,
                  is_shared: item.is_shared
                });
                setShowOptions(null);
                setShowAdd(true);
              }} 
              style={styles.optionBtn}
            >
              <Edit2 size={20} color={theme.text} /><Text style={[styles.optionText, { color: theme.text }]}>Edit Log</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { deleteLog(showOptions.id); setShowOptions(null); }} style={styles.optionBtn}>
              <Trash2 size={20} color="#FF3B30" /><Text style={[styles.optionText, { color: '#FF3B30' }]}>Remove from History</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ADD/EDIT LOG MODAL */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.background, height: '90%' }]}>
            {!isPickerMode ? (
              <View style={{ flex: 1 }}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>{editingId ? 'Edit' : 'Log'} Consumed</Text>
                  <TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={{ flexDirection: 'row', gap: 15 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Date</Text>
                      <TouchableOpacity onPress={() => setShowDatePicker(true)} style={[styles.pickerBtn, { backgroundColor: theme.card }]}>
                        <Calendar size={18} color="#34C759" />
                        <Text style={{ color: theme.text, fontWeight: '700', marginLeft: 8 }}>{format(newLog.date, 'MMM dd')}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Time</Text>
                      <TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.pickerBtn, { backgroundColor: theme.card }]}>
                        <Clock size={18} color="#34C759" />
                        <Text style={{ color: theme.text, fontWeight: '700', marginLeft: 8 }}>{newLog.meal_time}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {showDatePicker && (
                    <DateTimePicker value={newLog.date} mode="date" display="default" onChange={(e, d) => { setShowDatePicker(false); if (d) setNewLog({...newLog, date: d}); }} />
                  )}
                  {showTimePicker && (
                    <DateTimePicker value={new Date()} mode="time" is24Hour={true} display="default" onChange={(e, d) => { setShowTimePicker(false); if (d) setNewLog({...newLog, meal_time: format(d, 'HH:mm')}); }} />
                  )}

                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Plan Scope</Text>
                  <View style={[styles.segmentedContainer, { backgroundColor: 'rgba(150,150,150,0.1)' }]}>
                    <TouchableOpacity onPress={() => setNewLog({...newLog, is_shared: 0})} style={[styles.segmentButton, newLog.is_shared === 0 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                      <Plus size={14} color={newLog.is_shared === 0 ? '#5AC8FA' : theme.text} />
                      <Text style={[styles.segmentText, { color: theme.text, fontSize: 10 }]}>PERSONAL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setNewLog({...newLog, is_shared: 1})} style={[styles.segmentButton, newLog.is_shared === 1 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                      <Info size={14} color={newLog.is_shared === 1 ? '#AF52DE' : theme.text} />
                      <Text style={[styles.segmentText, { color: theme.text, fontSize: 10 }]}>SHARED (BOTH)</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.inputLabel, { color: theme.text, marginTop: 25 }]}>Item Eaten</Text>
                  <TouchableOpacity 
                    onPress={() => setIsPickerMode(true)}
                    style={[styles.pickerBtn, { backgroundColor: theme.card, height: 60 }]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={[styles.iconCircle, { backgroundColor: 'rgba(150,150,150,0.1)' }]}>
                        {newLog.item_id ? (newLog.type === 'recipe' ? <PieChart size={20} color="#34C759" /> : <Utensils size={20} color="#34C759" />) : <Search size={20} color={theme.text} opacity={0.3} />}
                      </View>
                      <View style={{ marginLeft: 15 }}>
                        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                          {(() => {
                            if (!newLog.item_id) return 'Search & Select...';
                            const item = newLog.type === 'recipe' ? allRecipes.find(r => r.id === newLog.item_id) : allIngredients.find(i => i.id === newLog.item_id);
                            return item?.name || 'Selected Item';
                          })()}
                        </Text>
                        {newLog.item_id ? <Text style={{ color: theme.text, fontSize: 10, opacity: 0.5, textTransform: 'uppercase', fontWeight: '800' }}>{newLog.type}</Text> : null}
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
                        value={newLog.quantity.toString()}
                        onChangeText={v => setNewLog({...newLog, quantity: parseFloat(v) || 0})}
                      />
                    </View>
                    <View style={{ flex: 1.5 }}>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Unit</Text>
                      <View style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: 'transparent', justifyContent: 'center' }]}>
                         <Text style={{ color: theme.text }}>{units.find(u => u.id === newLog.unit)?.name || 'serving'}</Text>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity onPress={saveLog} style={[styles.saveBtn, { backgroundColor: '#34C759' }]}>
                    <Save size={20} color="white" />
                    <Text style={styles.saveBtnText}>{editingId ? 'Update Log' : 'Save To History'}</Text>
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
                      onPress={() => setNewLog({...newLog, type: t as any})}
                      style={[styles.typeBtn, newLog.type === t && { backgroundColor: '#34C759' }]}
                    >
                      <Text style={[styles.typeText, newLog.type === t && { color: 'white' }]}>{t.toUpperCase()}S</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <ScrollView>
                  {(newLog.type === 'recipe' ? allRecipes : allIngredients)
                    .filter(i => i.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                    .map(item => (
                      <TouchableOpacity 
                        key={item.id}
                        onPress={() => {
                          setNewLog({...newLog, item_id: item.id, unit: item.base_unit || 'serving'});
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

function NutrientItem({ label, value, unit, color }: any) {
  return (
    <View style={styles.nutrientItem}>
      <Text style={[styles.nutrientLabel, { color }]}>{label}</Text>
      <Text style={styles.nutrientValue}>{value}</Text>
      <Text style={styles.nutrientUnit}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  emptyContainer: { alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 16, opacity: 0.3, marginTop: 20, fontWeight: '600' },
  createBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, marginTop: 20, gap: 10 },
  createBtnText: { color: 'white', fontWeight: '800' },
  historyCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 20, marginBottom: 8 },
  iconBox: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  itemName: { fontSize: 18, fontWeight: '800' },
  miniBadge: { backgroundColor: 'rgba(175,82,222,0.1)', paddingHorizontal: 6, borderRadius: 4 },
  miniBadgeText: { fontSize: 8, color: '#AF52DE', fontWeight: '900' },
  fab: { position: 'absolute', right: 20, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 24, fontWeight: '900' },
  inputLabel: { fontSize: 12, fontWeight: '900', marginBottom: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, height: 48, borderRadius: 15 },
  iconCircle: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  input: { height: 50, borderRadius: 15, paddingHorizontal: 15, fontSize: 16, fontWeight: '700' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 20, marginTop: 40, gap: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
  searchBar: { flexDirection: 'row', alignItems: 'center', height: 50, borderRadius: 15, paddingHorizontal: 15, marginBottom: 20 },
  backPicker: { flexDirection: 'row', alignItems: 'center' },
  typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.1)' },
  typeText: { fontSize: 12, fontWeight: '800', color: 'rgba(150,150,150,0.5)' },
  itemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 15, marginBottom: 8 },
  segmentedContainer: { flexDirection: 'row', borderRadius: 14, padding: 3, marginBottom: 15 },
  segmentButton: { flex: 1, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 12, gap: 6 },
  segmentActive: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  segmentText: { fontSize: 11, fontWeight: '800' },
  timeTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(52,199,89,0.1)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  timeText: { color: '#34C759', fontSize: 12, fontWeight: '900' },
  glassCard: { borderRadius: 24, padding: 20, overflow: 'hidden' },
  nutrientGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15 },
  nutrientItem: { width: '45%' },
  nutrientLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  nutrientValue: { fontSize: 20, fontWeight: '800', color: 'white' },
  nutrientUnit: { fontSize: 10, color: 'white', opacity: 0.6 },
  componentItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 12 },
  optionsMenu: { position: 'absolute', bottom: 40, left: 20, right: 20, borderRadius: 24, padding: 20, elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  optionsTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  optionBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, backgroundColor: 'rgba(150,150,150,0.05)' },
  optionText: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
});
