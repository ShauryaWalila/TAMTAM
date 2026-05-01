import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, Modal, FlatList, Alert, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Plus, Search, ChevronRight, ChevronDown, Trash2, Edit2, Save, X, Utensils, TrendingUp, Calendar, PieChart, Clock, Rotate3d, Info } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, SlideInBottom, useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, cancelAnimation, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as SecureStore from 'expo-secure-store';
import HighchartsChart from '@/components/HighchartsChart';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type TabType = 'PLAN' | 'RECIPES' | 'INGREDIENTS' | 'REPORT';
type FilterType = 'week' | 'month' | '3months' | '6months' | 'year' | 'overall';

export default function DietScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [activeTab, setActiveTab] = useState<TabType>('PLAN');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [userName, setUserName] = useState('');
  const dietPlanRef = useRef<any>(null);

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
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: 'Diet Plan', headerShown: false }} />
        
        <View style={[styles.header, { borderBottomColor: theme.card, paddingBottom: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: theme.text }]}>TAMTAM DIET</Text>
          </View>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
            {activeTab === 'PLAN' && (
              <>
                <TouchableOpacity onPress={() => router.push('/diet-routine')}>
                  <Calendar size={24} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.push('/diet-history')}>
                  <Utensils size={24} color={theme.text} />
                </TouchableOpacity>
              </>
            )}

            {activeTab !== 'PLAN' && (
              <TouchableOpacity onPress={() => {
                setIsSearchVisible(!isSearchVisible);
                if (isSearchVisible) setSearchQuery('');
              }}>
                {isSearchVisible ? <X size={24} color={theme.text} /> : <Search size={24} color={theme.text} />}
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={() => setActiveTab('REPORT')}>
              <TrendingUp size={24} color={activeTab === 'REPORT' ? '#FF2D55' : theme.text} />
            </TouchableOpacity>
          </View>
        </View>

        {isSearchVisible && activeTab !== 'PLAN' && (
          <Animated.View entering={FadeInDown} style={styles.searchContainer}>
            <View style={[styles.searchBar, { backgroundColor: theme.card }]}>
              <Search size={18} color={theme.text} opacity={0.5} />
              <TextInput 
                placeholder={`Search ${activeTab.toLowerCase()}...`}
                placeholderTextColor={theme.text + '80'}
                style={[styles.searchInput, { color: theme.text }]}
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </Animated.View>
        )}

        <View style={styles.tabContainer}>
          {(['PLAN', 'RECIPES', 'INGREDIENTS'] as TabType[]).map((tab) => (
            <TouchableOpacity 
              key={tab} 
              onPress={() => { setActiveTab(tab); setSearchQuery(''); }}
              style={[styles.tabButton, activeTab === tab && { backgroundColor: '#FF2D55' }]}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? 'white' : theme.text }]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeTab === 'PLAN' && <DietPlanTab ref={dietPlanRef} theme={theme} searchQuery={searchQuery} userName={userName} setActiveTab={setActiveTab} />}
          {activeTab === 'RECIPES' && <RecipesTab theme={theme} searchQuery={searchQuery} userName={userName} />}
          {activeTab === 'INGREDIENTS' && <IngredientsTab theme={theme} searchQuery={searchQuery} userName={userName} />}
          {activeTab === 'REPORT' && <DietReportTab theme={theme} userName={userName} />}
        </ScrollView>
      </View>
    </GestureHandlerRootView>
  );
}

// ==========================================
// 1. DIET PLAN TAB
// ==========================================
const DietPlanTab = React.forwardRef(({ theme, searchQuery, userName, setActiveTab }: any, ref) => {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  
  // -- 1. ALL STATES AT THE TOP --
  const [plans, setPlans] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [isPickerMode, setIsPickerMode] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);
  const [isSharedFilter, setIsSharedFilter] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isSummaryFlipped, setIsSummaryFlipped] = useState(false);
  
  const [dietPlanProgress, setDietPlanProgress] = useState<any>({ 
    me: { target: {}, actual: {} }, 
    them: { target: {}, actual: {} } 
  });

  const [newPlan, setNewPlan] = useState({ 
    meal_time: '08:00', 
    type: 'recipe' as 'recipe' | 'ingredient', 
    item_id: '', 
    quantity: 1, 
    unit: 'serving',
    is_eaten: 0,
    is_shared: 0,
    is_recurring: 0,
    days_of_week: '0,1,2,3,4,5,6',
    cycle_week: 0,
    date: new Date()
  });

  // Expose methods to parent
  React.useImperativeHandle(ref, () => ({
    openAdd: (isEaten: number) => {
      setNewPlan(prev => ({ ...prev, is_eaten: isEaten, item_id: '' }));
      setIsPickerMode(false);
      setShowAdd(true);
    }
  }));

  // Reanimated Shared Values for Flip Card
  const summaryFlipRotation = useSharedValue(0);
  const summaryScrollOffset = useSharedValue(0);
  const summaryMaxScroll = useSharedValue(0);
  const summaryFrontScrollOffset = useSharedValue(0);
  const summaryFrontMaxScroll = useSharedValue(0);

  const summaryFrontStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${summaryFlipRotation.value}deg` }],
    backfaceVisibility: 'hidden',
    zIndex: summaryFlipRotation.value <= 90 || summaryFlipRotation.value >= 270 ? 1 : 0
  }));

  const summaryBackStyle = useAnimatedStyle(() => ({
    transform: [{ rotateY: `${summaryFlipRotation.value + 180}deg` }],
    backfaceVisibility: 'hidden',
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: summaryFlipRotation.value > 90 && summaryFlipRotation.value < 270 ? 1 : 0
  }));

  const summaryContentScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -summaryScrollOffset.value }]
  }));

  const summaryFrontContentScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -summaryFrontScrollOffset.value }]
  }));

  const summarySliderStyle = useAnimatedStyle(() => {
    const trackHeight = 300;
    const handleHeight = 60;
    const range = trackHeight - handleHeight;
    const pos = summaryMaxScroll.value > 0 ? (summaryScrollOffset.value / summaryMaxScroll.value) * range : 0;
    return {
      transform: [{ translateY: pos }],
      opacity: summaryMaxScroll.value > 0 ? 1 : 0
    };
  });

  const summaryFrontSliderStyle = useAnimatedStyle(() => {
    const trackHeight = 300;
    const handleHeight = 60;
    const range = trackHeight - handleHeight;
    const pos = summaryFrontMaxScroll.value > 0 ? (summaryFrontScrollOffset.value / summaryFrontMaxScroll.value) * range : 0;
    return {
      transform: [{ translateY: pos }],
      opacity: summaryFrontMaxScroll.value > 0 ? 1 : 0
    };
  });

  const toggleSummaryFlip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsSummaryFlipped(!isSummaryFlipped);
    summaryFlipRotation.value = withSpring(isSummaryFlipped ? 0 : 180, { damping: 12, stiffness: 90 });
  };

  const summarySliderGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (summaryMaxScroll.value <= 0) return;
      const trackHeight = 300;
      const handleHeight = 60;
      const range = trackHeight - handleHeight;
      let pos = e.y - (handleHeight / 2);
      pos = Math.max(0, Math.min(range, pos));
      summaryScrollOffset.value = (pos / range) * summaryMaxScroll.value;
    });

  const summaryFrontSliderGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (summaryFrontMaxScroll.value <= 0) return;
      const trackHeight = 300;
      const handleHeight = 60;
      const range = trackHeight - handleHeight;
      let pos = e.y - (handleHeight / 2);
      pos = Math.max(0, Math.min(range, pos));
      summaryFrontScrollOffset.value = (pos / range) * summaryFrontMaxScroll.value;
    });

  const onLayoutSummaryContent = (event: any) => {
    const { height } = event.nativeEvent.layout;
    summaryMaxScroll.value = Math.max(0, height - 350); 
  };

  const onLayoutSummaryFrontContent = (event: any) => {
    const { height } = event.nativeEvent.layout;
    summaryFrontMaxScroll.value = Math.max(0, height - 350); 
  };

  // -- 2. LOADERS --
  useEffect(() => {
    if (userName) {
      loadLibrary(); loadMetrics(); loadUnits(); loadPlans();
    }
  }, [userName, metrics.length]);

  const loadLibrary = () => {
    setAllRecipes(db.getAllSync('SELECT * FROM recipes'));
    setAllIngredients(db.getAllSync('SELECT * FROM ingredients'));
  };

  const loadMetrics = () => {
    const data = db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1');
    setMetrics(data);
  };

  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));

  const getCycleWeek = (date: Date) => {
    // Load cycle length from settings (default 4)
    const settings = db.getFirstSync('SELECT cycle_length FROM diet_settings WHERE id = "global"') as any;
    const length = settings?.cycle_length || 4;
    
    // 4-week cycle starting from epoch
    const epoch = new Date('2024-01-01T00:00:00Z');
    const diffTime = Math.abs(date.getTime() - epoch.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weekDiff = Math.floor(diffDays / 7);
    return (weekDiff % length) + 1;
  };

  const loadPlans = () => {
    const today = new Date();
    const todayStr = format(today, 'yyyy-MM-dd');
    const dayIndex = today.getDay().toString();
    const currentCycleWeek = getCycleWeek(today);

    // 1. Get all "instantiated" plans for today (manual logs + marked routine items)
    const instantiated = db.getAllSync('SELECT * FROM diet_plans WHERE date = ?', [todayStr]) as any[];
    
    // 2. Get all "template" routines for today
    const templates = db.getAllSync(`
      SELECT * FROM diet_plans 
      WHERE is_recurring = 1 AND days_of_week LIKE ? AND (cycle_week = 0 OR cycle_week = ?)
    `, [`%${dayIndex}%`, currentCycleWeek]) as any[];

    // 3. Filter templates: only show if NOT already instantiated for today
    const activeTemplates = templates.filter(t => !instantiated.some(i => i.item_id === t.item_id && i.is_recurring === 1));

    const allCurrentPlans = [...instantiated, ...activeTemplates].sort((a, b) => a.meal_time.localeCompare(b.meal_time));
    
    setPlans(allCurrentPlans);
    calculateDailyTotals(allCurrentPlans);
    sweepYesterdayRoutine();
  };

  const sweepYesterdayRoutine = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yestStr = format(yesterday, 'yyyy-MM-dd');
    const dayIndex = yesterday.getDay().toString();
    const cycleWeek = getCycleWeek(yesterday);

    // Get what was supposed to be eaten yesterday
    const templates = db.getAllSync(`
      SELECT * FROM diet_plans 
      WHERE is_recurring = 1 AND days_of_week LIKE ? AND (cycle_week = 0 OR cycle_week = ?)
    `, [`%${dayIndex}%`, cycleWeek]) as any[];

    // Get what was actually recorded yesterday
    const instantiated = db.getAllSync('SELECT item_id FROM diet_plans WHERE date = ? AND is_recurring = 1', [yestStr]) as any[];
    const recordedIds = instantiated.map(i => i.item_id);

    // Mark missing ones as is_eaten = 2 (Skipped)
    templates.forEach(t => {
      if (!recordedIds.includes(t.item_id)) {
        const id = generateUUID();
        const payload = { ...t, id, date: yestStr, is_eaten: 2, created_at: new Date().toISOString() };
        db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
          [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.created_at]);
      }
    });
  };

  // -- 3. LOGIC --
  const calculateDailyTotals = (currentPlans: any[]) => {
    const dailyTotals: any = { 
      me: { target: {}, actual: {} }, 
      them: { target: {}, actual: {} } 
    };
    
    const currentMetrics = metrics.length > 0 ? metrics : db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1');
    
    currentMetrics.forEach((m: any) => { 
      dailyTotals.me.target[m.id] = 0; dailyTotals.me.actual[m.id] = 0; 
      dailyTotals.them.target[m.id] = 0; dailyTotals.them.actual[m.id] = 0; 
    });

    currentPlans.forEach(plan => {
      if (plan.is_eaten === 2) return; // SKIP stats for unconsumed items

      const isMe = plan.user_id === userName || plan.is_shared === 1;
      const isPartner = plan.user_id !== userName || plan.is_shared === 1;
      
      const getItemNutrients = () => {
        let totalNutrients: any = {};
        currentMetrics.forEach(m => totalNutrients[m.id] = 0);

        if (plan.type === 'ingredient') {
          const ing = db.getFirstSync('SELECT * FROM ingredients WHERE id = ?', [plan.item_id]) as any;
          if (ing) {
            const nutrients = JSON.parse(ing.nutrients || '{}');
            const ratio = (parseFloat(plan.quantity) || 0) / (ing.base_quantity || 1);
            currentMetrics.forEach(m => totalNutrients[m.id] = (nutrients[m.id] || 0) * ratio);
          }
        } else {
          const recipe = db.getFirstSync('SELECT * FROM recipes WHERE id = ?', [plan.item_id]) as any;
          if (recipe) {
            const recipeRatio = (parseFloat(plan.quantity) || 0) / (recipe.base_quantity || 1);
            if (recipe.nutrients) {
              const manualNutrients = JSON.parse(recipe.nutrients);
              currentMetrics.forEach(m => totalNutrients[m.id] = (manualNutrients[m.id] || 0) * recipeRatio);
            } else {
              const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [plan.item_id]) as any[];
              recipeIngs.forEach(ri => {
                const nutrients = JSON.parse(ri.nutrients || '{}');
                const ingRatio = (ri.quantity / (ri.base_quantity || 1));
                currentMetrics.forEach(m => {
                  totalNutrients[m.id] += (nutrients[m.id] || 0) * ingRatio * recipeRatio;
                });
              });
            }
          }
        }
        return totalNutrients;
      };

      const planNutrients = getItemNutrients();

      if (isMe) {
        if (plan.is_eaten === 0) {
          currentMetrics.forEach(m => dailyTotals.me.target[m.id] += planNutrients[m.id]);
        } else {
          currentMetrics.forEach(m => dailyTotals.me.actual[m.id] += planNutrients[m.id]);
        }
      }
      if (isPartner) {
        if (plan.is_eaten === 0) {
          currentMetrics.forEach(m => dailyTotals.them.target[m.id] += planNutrients[m.id]);
        } else {
          currentMetrics.forEach(m => dailyTotals.them.actual[m.id] += planNutrients[m.id]);
        }
      }
    });
    setDietPlanProgress(dailyTotals);
  };

  const savePlanItem = () => {
    if (!newPlan.item_id) return;
    const id = editingPlanId || generateUUID();
    const selectedDateStr = format(newPlan.date, 'yyyy-MM-dd');
    const payload = { 
      id, 
      date: selectedDateStr, 
      meal_time: newPlan.meal_time, 
      type: newPlan.type, 
      item_id: newPlan.item_id, 
      quantity: newPlan.quantity, 
      unit: newPlan.unit, 
      user_id: userName, 
      is_eaten: newPlan.is_eaten,
      is_shared: newPlan.is_shared,
      is_recurring: newPlan.is_recurring,
      days_of_week: newPlan.days_of_week,
      cycle_week: newPlan.cycle_week,
      created_at: new Date().toISOString() 
    };

    if (editingPlanId) {
      db.runSync('UPDATE diet_plans SET date=?, meal_time=?, type=?, item_id=?, quantity=?, unit=?, is_eaten=?, is_shared=?, is_recurring=?, days_of_week=?, cycle_week=? WHERE id=?', 
        [payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, id]);
      queueSyncOperation('diet_plans', id, 'UPDATE', payload);
    } else {
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    }

    setShowAdd(false); setEditingPlanId(null);
    setNewPlan({ ...newPlan, item_id: '', quantity: 1, is_eaten: 0, is_shared: 0, is_recurring: 0, cycle_week: 0, date: new Date() });
    loadPlans();
  };

  const handleEdit = (plan: any) => {
    setNewPlan({
      meal_time: plan.meal_time,
      type: plan.type,
      item_id: plan.item_id,
      quantity: plan.quantity,
      unit: plan.unit,
      is_eaten: plan.is_eaten,
      is_shared: plan.is_shared,
      is_recurring: plan.is_recurring,
      days_of_week: plan.days_of_week,
      cycle_week: plan.cycle_week || 0,
      date: new Date(plan.date)
    });
    setEditingPlanId(plan.id);
    setIsPickerMode(false);
    setShowAdd(true);
  };

  const toggleEaten = (plan: any) => {
    if (plan.is_eaten === 1) {
      Alert.alert('Item Logged', 'Actually consumed items cannot be unchecked. You can delete them if needed.');
      return;
    }
    const newStatus = 1;
    db.runSync('UPDATE diet_plans SET is_eaten = ? WHERE id = ?', [newStatus, plan.id]);
    queueSyncOperation('diet_plans', plan.id, 'UPDATE', { is_eaten: newStatus });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    loadPlans();
  };

  const deletePlanItem = (id: string) => {
    db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
    queueSyncOperation('diet_plans', id, 'DELETE', { id });
    loadPlans();
  };

  const chartOptions = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 200 },
    title: { text: '' },
    xAxis: { categories: ['Calories', 'Protein'], labels: { style: { color: theme.text } } },
    yAxis: { title: { text: '' }, gridLineColor: theme.card, labels: { style: { color: theme.text } } },
    legend: { itemStyle: { color: theme.text } },
    credits: { enabled: false },
    series: [
      { name: 'Me (Actual)', data: [dietPlanProgress.me.actual['m1'] || 0, dietPlanProgress.me.actual['m2'] || 0], color: '#FF2D55' },
      { name: 'Partner (Actual)', data: [dietPlanProgress.them.actual['m1'] || 0, dietPlanProgress.them.actual['m2'] || 0], color: '#5AC8FA' }
    ]
  };

  const [routineSearch, setRoutineSearch] = useState('');
  const [isRoutineSearchVisible, setIsRoutineSearchVisible] = useState(false);

  const filteredPlans = plans.filter(p => {
    const isMe = p.user_id === userName;
    const isShared = p.is_shared === 1;
    let matchesUser = isSharedFilter ? isShared : (isMe || isShared);
    if (!matchesUser) return false;
    
    if (routineSearch) {
      const item = p.type === 'recipe' ? allRecipes.find(r => r.id === p.item_id) : allIngredients.find(i => i.id === p.item_id);
      return item?.name?.toLowerCase().includes(routineSearch.toLowerCase());
    }
    return true;
  });

  const routineItems = filteredPlans.filter(p => p.is_eaten === 0);
  const consumedItems = filteredPlans.filter(p => p.is_eaten === 1);

  // Grouping logic for "Diet Chart" feel
  const groupItemsByTime = (items: any[]) => {
    const groups: { [key: string]: any[] } = {};
    items.forEach(item => {
      const hour = parseInt(item.meal_time.split(':')[0]);
      let groupName = 'Others';
      if (hour >= 5 && hour < 11) groupName = 'Morning';
      else if (hour >= 11 && hour < 16) groupName = 'Afternoon';
      else if (hour >= 16 && hour < 20) groupName = 'Evening';
      else groupName = 'Night';
      
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(item);
    });
    return groups;
  };

  const groupedRoutine = groupItemsByTime(routineItems);

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      {/* 1. FLIPPABLE SUMMARY & ROUTINE CARD */}
      <View style={{ height: 400, marginBottom: 30, perspective: 1000 }}>
        {/* FRONT SIDE: NUTRIENT CHART */}
        <Animated.View style={[styles.glassCard, { backgroundColor: 'rgba(255,45,85,0.05)', borderWidth: 1, borderColor: 'rgba(255,45,85,0.1)', height: '100%', position: 'absolute', width: '100%' }, summaryFrontStyle]}>
           <View style={{ flex: 1, flexDirection: 'row' }}>
              <View style={{ flex: 1, overflow: 'hidden' }}>
                 <Animated.View onLayout={onLayoutSummaryFrontContent} style={summaryFrontContentScrollStyle}>
                    <TouchableOpacity activeOpacity={1} onPress={toggleSummaryFlip}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                          <Text style={[styles.cardTitle, { color: '#FF2D55', marginBottom: 0 }]}>Daily Progress</Text>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity onPress={() => setIsSharedFilter(!isSharedFilter)} style={[styles.smallTab, isSharedFilter && { backgroundColor: '#FF2D55' }]}>
                              <Text style={{ color: isSharedFilter ? 'white' : theme.text, fontSize: 10, fontWeight: '800' }}>SHARED ONLY</Text>
                            </TouchableOpacity>
                            <Rotate3d size={18} color={theme.text} opacity={0.3} />
                          </View>
                      </View>
                      
                      <View style={{ gap: 15, marginBottom: 20 }}>
                          {metrics.slice(0, 2).map(m => {
                            const actual = dietPlanProgress.me.actual[m.id] || 0;
                            const target = dietPlanProgress.me.target[m.id] || 0;
                            const progress = target > 0 ? Math.min(1, actual / target) : 0;
                            return (
                              <View key={m.id}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '700' }}>{m.name}</Text>
                                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800' }}>{actual.toFixed(0)} / {target.toFixed(0)} {m.unit}</Text>
                                </View>
                                <View style={{ height: 8, backgroundColor: theme.card, borderRadius: 4, overflow: 'hidden' }}>
                                  <View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: '#FF2D55', borderRadius: 4 }} />
                                </View>
                              </View>
                            );
                          })}
                      </View>
                      <HighchartsChart height={180} options={chartOptions} />
                    </TouchableOpacity>
                 </Animated.View>
              </View>
              <View style={{ width: 8, height: 300, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 4, marginLeft: 10 }}>
                 <GestureDetector gesture={summaryFrontSliderGesture}>
                    <Animated.View style={[styles.sliderHandle, { width: 8, height: 60, borderRadius: 4, backgroundColor: '#FF2D55' }, summaryFrontSliderStyle]} />
                 </GestureDetector>
              </View>
           </View>
        </Animated.View>

        {/* BACK SIDE: THE ROUTINE */}
        <Animated.View style={[styles.glassCard, { backgroundColor: theme.card, height: '100%', position: 'absolute', width: '100%' }, summaryBackStyle]}>
          <View style={{ flex: 1, overflow: 'hidden' }}>
             <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, zIndex: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                   <TouchableOpacity onPress={toggleSummaryFlip}><Rotate3d size={18} color={theme.text} opacity={0.5} /></TouchableOpacity>
                   <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 0 }]}>Diet Chart</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                   <TouchableOpacity onPress={() => setIsRoutineSearchVisible(!isRoutineSearchVisible)}>
                      <Search size={18} color={theme.text} opacity={isRoutineSearchVisible ? 1 : 0.3} />
                   </TouchableOpacity>
                   <TouchableOpacity onPress={() => { setNewPlan({...newPlan, is_eaten: 0, item_id: ''}); setIsPickerMode(true); setShowAdd(true); }} style={[styles.addButton, { width: 30, height: 30 }]}>
                      <Plus size={18} color="white" />
                   </TouchableOpacity>
                </View>
             </View>

             {isRoutineSearchVisible && (
               <View style={[styles.searchBar, { backgroundColor: 'rgba(150,150,150,0.05)', height: 36, marginBottom: 15 }]}>
                  <Search size={14} color={theme.text} opacity={0.5} />
                  <TextInput 
                    placeholder="Search chart..." 
                    style={{ flex: 1, color: theme.text, fontSize: 12 }} 
                    value={routineSearch}
                    onChangeText={setRoutineSearch}
                    autoFocus
                  />
                  {routineSearch.length > 0 && <TouchableOpacity onPress={() => setRoutineSearch('')}><X size={14} color={theme.text} opacity={0.5} /></TouchableOpacity>}
               </View>
             )}

             <View style={{ flex: 1, flexDirection: 'row' }}>
                <View style={{ flex: 1, overflow: 'hidden' }}>
                   <Animated.View onLayout={onLayoutSummaryContent} style={summaryContentScrollStyle}>
                      {routineItems.length === 0 && <Text style={{ color: theme.text, opacity: 0.3, textAlign: 'center', marginVertical: 40, fontStyle: 'italic' }}>No planned items left</Text>}
                      
                      {['Morning', 'Afternoon', 'Evening', 'Night'].map(group => groupedRoutine[group] && (
                        <View key={group} style={{ marginBottom: 15 }}>
                           <Text style={{ color: '#FF2D55', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 8, opacity: 0.6 }}>{group.toUpperCase()}</Text>
                           {groupedRoutine[group].map(plan => (
                              <RoutineItemCard 
                                key={plan.id} 
                                plan={plan} 
                                theme={theme} 
                                userName={userName} 
                                allRecipes={allRecipes} 
                                allIngredients={allIngredients} 
                                onToggle={toggleEaten} 
                                onEdit={handleEdit} 
                                onDelete={deletePlanItem} 
                              />
                           ))}
                        </View>
                      ))}
                      <View style={{ height: 40 }} />
                   </Animated.View>
                </View>

                <View style={{ width: 8, height: 300, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 4, marginLeft: 10 }}>
                   <GestureDetector gesture={summarySliderGesture}>
                      <Animated.View style={[styles.sliderHandle, { width: 8, height: 60, borderRadius: 4, backgroundColor: '#FF2D55' }, summarySliderStyle]} />
                   </GestureDetector>
                </View>
             </View>
          </View>
        </Animated.View>
      </View>

      {/* 2. ACTUALLY CONSUMED SECTION (Separate) */}
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text, opacity: 0.6 }]}>Consumed Report</Text>
        <TouchableOpacity onPress={() => { setEditingPlanId(null); setNewPlan({...newPlan, is_eaten: 1, item_id: ''}); setIsPickerMode(true); setShowAdd(true); }} style={[styles.addButton, { backgroundColor: theme.card }]}>
          <Plus size={20} color={theme.text} />
        </TouchableOpacity>
      </View>

      {consumedItems.map(plan => {
        const item = plan.type === 'recipe' ? allRecipes.find(r => r.id === plan.item_id) : allIngredients.find(i => i.id === plan.item_id);
        const isMe = plan.user_id === userName;
        const isShared = plan.is_shared === 1;
        return (
          <TouchableOpacity 
            key={plan.id} 
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); handleEdit(plan); }}
            delayLongPress={500}
            style={[styles.itemCard, { backgroundColor: theme.card, opacity: 0.7, borderLeftWidth: 4, borderLeftColor: isShared ? '#AF52DE' : (isMe ? '#FF2D55' : '#5AC8FA') }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
               <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: isShared ? '#AF52DE' : '#FF2D55', justifyContent: 'center', alignItems: 'center', marginRight: 15 }}>
                  <Save size={12} color="white" />
               </View>
               <View>
                 <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.itemTime, { color: isShared ? '#AF52DE' : (isMe ? '#FF2D55' : '#5AC8FA') }]}>
                      {plan.meal_time}
                    </Text>
                    <View style={{ backgroundColor: 'rgba(150,150,150,0.1)', paddingHorizontal: 4, borderRadius: 4 }}>
                       <Text style={{ fontSize: 8, fontWeight: '800', color: theme.text }}>{plan.user_id?.substring(0, 8)}</Text>
                    </View>
                 </View>
                 <Text style={[styles.itemName, { color: theme.text, textDecorationLine: 'line-through' }]}>{item?.name}</Text>
               </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
               <Text style={[styles.itemValue, { color: theme.text, marginRight: 15 }]}>{plan.quantity} {plan.unit}</Text>
               <TouchableOpacity onPress={() => deletePlanItem(plan.id)}><Trash2 size={16} color="#FF2D55" opacity={0.3} /></TouchableOpacity>
            </View>
          </TouchableOpacity>
        );
      })}
      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}>
             {!isPickerMode ? (
                <View style={{ flex: 1 }}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: theme.text }]}>{editingPlanId ? 'Edit' : 'Add'} Meal</Text>
                    <TouchableOpacity onPress={() => { setShowAdd(false); setEditingPlanId(null); setIsUnitDropdownOpen(false); setIsPickerMode(false); }}><X size={24} color={theme.text} /></TouchableOpacity>
                  </View>
                  
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={{ marginBottom: 20 }}>
                      <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>ACTIVITY TYPE</Text>
                      <View style={styles.segmentedContainer}>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_eaten: 0})} style={[styles.segmentButton, newPlan.is_eaten === 0 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                          <Calendar size={14} color={newPlan.is_eaten === 0 ? '#FF2D55' : theme.text} />
                          <Text style={[styles.segmentText, { color: theme.text }]}>FOR ROUTINE</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_eaten: 1})} style={[styles.segmentButton, newPlan.is_eaten === 1 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                          <Utensils size={14} color={newPlan.is_eaten === 1 ? '#34C759' : theme.text} />
                          <Text style={[styles.segmentText, { color: theme.text }]}>ALREADY EATEN</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>PLAN SCOPE</Text>
                      <View style={styles.segmentedContainer}>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_shared: 0})} style={[styles.segmentButton, newPlan.is_shared === 0 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                          <Plus size={14} color={newPlan.is_shared === 0 ? '#5AC8FA' : theme.text} />
                          <Text style={[styles.segmentText, { color: theme.text }]}>PERSONAL</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_shared: 1})} style={[styles.segmentButton, newPlan.is_shared === 1 && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                          <Info size={14} color={newPlan.is_shared === 1 ? '#AF52DE' : theme.text} />
                          <Text style={[styles.segmentText, { color: theme.text }]}>SHARED (BOTH)</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={{ marginBottom: 20, padding: 15, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 20 }}>
                       <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                          <View><Text style={{ color: theme.text, fontWeight: '800' }}>RECURRING ROUTINE</Text><Text style={{ color: theme.text, opacity: 0.5, fontSize: 11 }}>Appears automatically on selected days</Text></View>
                          <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_recurring: newPlan.is_recurring === 1 ? 0 : 1})} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: newPlan.is_recurring === 1 ? '#FF2D55' : 'rgba(150,150,150,0.2)', justifyContent: 'center', paddingHorizontal: 2 }}>
                             <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', alignSelf: newPlan.is_recurring === 1 ? 'flex-end' : 'flex-start' }} />
                          </TouchableOpacity>
                       </View>
                       {newPlan.is_recurring === 1 && (
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                             {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => {
                                const isSelected = newPlan.days_of_week.includes(i.toString());
                                return (
                                  <TouchableOpacity key={i} onPress={() => { let days = newPlan.days_of_week.split(',').filter(d => d !== ''); if (isSelected) days = days.filter(d => d !== i.toString()); else days.push(i.toString()); setNewPlan({...newPlan, days_of_week: days.sort().join(',')}); }} style={[styles.dayCircle, isSelected && { backgroundColor: '#FF2D55' }]}><Text style={{ color: isSelected ? 'white' : theme.text, fontSize: 10, fontWeight: '900' }}>{day}</Text></TouchableOpacity>
                                );
                             })}
                          </View>
                       )}
                    </View>

                    <View style={{ marginBottom: 20 }}>
                      <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>SCHEDULED TIME</Text>
                      <TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.dropdownButton, { backgroundColor: theme.card, height: 48, paddingHorizontal: 15 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Clock size={20} color="#FF2D55" /><Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginLeft: 12 }}>{newPlan.meal_time}</Text></View>
                        <ChevronDown size={20} color={theme.text} opacity={0.3} />
                      </TouchableOpacity>
                      {showTimePicker && <DateTimePicker value={(() => { const d = new Date(); const [h, m] = newPlan.meal_time.split(':'); d.setHours(parseInt(h), parseInt(m)); return d; })()} mode="time" is24Hour={true} display="default" onChange={(e, d) => { setShowTimePicker(false); if (d) setNewPlan({...newPlan, meal_time: format(d, 'HH:mm')}); }} />}
                    </View>

                    <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>ITEM TO ADD</Text>
                    <TouchableOpacity 
                      activeOpacity={0.7} 
                      onPress={() => {
                        if (editingPlanId) {
                          // Prevent changing item while editing to avoid accidental unit/type mismatches
                          // but allow if user really wants to
                          setIsPickerMode(true);
                        } else {
                          setIsPickerMode(true);
                        }
                      }} 
                      style={[styles.dropdownButton, { backgroundColor: theme.card, height: 60, marginBottom: 20, borderWidth: 1, borderColor: newPlan.item_id ? '#FF2D55' : 'rgba(150,150,150,0.2)' }]}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                          {newPlan.item_id ? (newPlan.type === 'recipe' ? <PieChart size={20} color="#FF2D55" /> : <Utensils size={20} color="#34C759" />) : <Search size={20} color={theme.text} opacity={0.3} />}
                        </View>
                        <View style={{ marginLeft: 15 }}>
                          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{(() => { if (!newPlan.item_id) return 'Search & Select...'; const item = newPlan.type === 'recipe' ? allRecipes.find(r => r.id === newPlan.item_id) : allIngredients.find(i => i.id === newPlan.item_id); return item?.name || 'Select Item'; })()}</Text>
                          {newPlan.item_id ? <Text style={{ color: theme.text, fontSize: 10, opacity: 0.5, textTransform: 'uppercase', fontWeight: '800' }}>{newPlan.type}</Text> : null}
                        </View>
                      </View>
                      <ChevronRight size={20} color={theme.text} opacity={0.3} />
                    </TouchableOpacity>

                    <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20, zIndex: 10 }}>
                      <View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Amt</Text><TextInput keyboardType="decimal-pad" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newPlan.quantity.toString()} onChangeText={(v) => setNewPlan({...newPlan, quantity: parseFloat(v) || 0})} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.inputLabel, { color: theme.text }]}>Unit</Text>
                        <TouchableOpacity onPress={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)} style={[styles.dropdownButton, { backgroundColor: theme.card }]}>
                          <Text style={{ color: theme.text, fontWeight: '700' }}>{units.find(u => u.id === newPlan.unit)?.name || newPlan.unit || 'Select'}</Text>
                          <ChevronDown size={18} color={theme.text} />
                        </TouchableOpacity>
                        {isUnitDropdownOpen && (
                          <View style={[styles.dropdownList, { backgroundColor: theme.card, top: 75 }]}>
                            <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>{units.map(u => (<TouchableOpacity key={u.id} onPress={() => { setNewPlan({...newPlan, unit: u.id}); setIsUnitDropdownOpen(false); }} style={styles.dropdownItem}><Text style={{ color: theme.text, fontWeight: newPlan.unit === u.id ? '800' : '400' }}>{u.name}</Text></TouchableOpacity>))}</ScrollView>
                          </View>
                        )}
                      </View>
                    </View>
                    
                    <TouchableOpacity onPress={savePlanItem} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>{editingPlanId ? 'Update Item' : (newPlan.is_eaten === 1 ? 'Log Activity' : 'Add to Routine')}</Text></TouchableOpacity>
                    <View style={{ height: 50 }} />
                  </ScrollView>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={styles.modalHeader}>
                    <TouchableOpacity onPress={() => setIsPickerMode(false)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ChevronDown size={24} color={theme.text} style={{ transform: [{ rotate: '90deg' }] }} />
                      <Text style={[styles.modalTitle, { color: theme.text, marginLeft: 10 }]}>Select Item</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setShowAdd(false); setIsPickerMode(false); setPickerSearch(''); }}><X size={24} color={theme.text} /></TouchableOpacity>
                  </View>

                  <View style={[styles.searchBar, { backgroundColor: theme.card, marginBottom: 20 }]}>
                    <Search size={18} color={theme.text} opacity={0.5} />
                    <TextInput placeholder={`Search ${newPlan.type}...`} placeholderTextColor={theme.text + '80'} style={[styles.searchInput, { color: theme.text }]} value={pickerSearch} onChangeText={setPickerSearch} autoFocus />
                    {pickerSearch.length > 0 && <TouchableOpacity onPress={() => setPickerSearch('')}><X size={18} color={theme.text} opacity={0.5} /></TouchableOpacity>}
                  </View>

                  <View style={[styles.segmentedContainer, { marginBottom: 20 }]}>
                    {['recipe', 'ingredient'].map(t => (
                      <TouchableOpacity key={t} onPress={() => setNewPlan({...newPlan, type: t as any, item_id: ''})} style={[styles.segmentButton, newPlan.type === t && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                        <Text style={[styles.segmentText, { color: theme.text }]}>{t.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <FlatList
                    data={(newPlan.type === 'recipe' ? allRecipes : allIngredients).filter(i => i.name.toLowerCase().includes(pickerSearch.toLowerCase()))}
                    keyExtractor={item => item.id}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    renderItem={({ item }) => (
                      <TouchableOpacity 
                        onPress={() => {
                          setNewPlan({...newPlan, item_id: item.id, unit: item.base_unit || 'serving'});
                          setIsPickerMode(false);
                          setPickerSearch('');
                        }}
                        style={[styles.itemCard, { backgroundColor: theme.card, borderWidth: newPlan.item_id === item.id ? 1 : 0, borderColor: '#FF2D55' }]}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(150,150,150,0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                            {newPlan.type === 'recipe' ? <PieChart size={16} color={theme.text} /> : <Utensils size={16} color={theme.text} />}
                          </View>
                          <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>{item.name}</Text>
                        </View>
                        <ChevronRight size={18} color={theme.text} opacity={0.3} />
                      </TouchableOpacity>
                    )}
                    ListHeaderComponent={
                      <TouchableOpacity onPress={() => { setShowAdd(false); setIsPickerMode(false); setActiveTab(newPlan.type === 'recipe' ? 'RECIPES' : 'INGREDIENTS'); }} style={[styles.itemCard, { backgroundColor: 'rgba(255,45,85,0.05)', borderStyle: 'dashed', borderWidth: 1, borderColor: '#FF2D55', marginBottom: 20 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}><Plus size={20} color="#FF2D55" /><Text style={{ color: '#FF2D55', fontWeight: '800', marginLeft: 12 }}>Create New {newPlan.type.charAt(0).toUpperCase() + newPlan.type.slice(1)}</Text></View>
                      </TouchableOpacity>
                    }
                    ListEmptyComponent={
                      <View style={{ padding: 40, alignItems: 'center' }}><Search size={40} color={theme.text} opacity={0.1} /><Text style={{ color: theme.text, opacity: 0.3, marginTop: 10 }}>No {newPlan.type}s found matching "{pickerSearch}"</Text></View>
                    }
                  />
                </View>
              )}
           </View>
        </BlurView>
      </Modal>
    </Animated.View>
  );
});

// ==========================================
// 2. RECIPES TAB
// ==========================================
function RecipesTab({ theme, searchQuery, userName }: any) {
  const insets = useSafeAreaInsets();
  const [recipes, setRecipes] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<any | null>(null);
  const [showDetails, setShowDetails] = useState<any | null>(null);
  const [newRecipe, setNewRecipe] = useState({ 
    name: '', 
    description: '', 
    ingredients: [] as any[], 
    base_quantity: 1, 
    base_unit: 'serving',
    is_manual: false,
    nutrients: {} as any
  });
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [ingSearch, setIngSearch] = useState('');
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);
  const [openIngUnitIdx, setOpenIngUnitIdx] = useState<number | null>(null);
  const colorScheme = useColorScheme() ?? 'light';

  useEffect(() => { loadRecipes(); loadIngredients(); loadMetrics(); loadUnits(); }, []);
  const loadRecipes = () => setRecipes(db.getAllSync('SELECT * FROM recipes ORDER BY created_at DESC'));
  const loadIngredients = () => setAllIngredients(db.getAllSync('SELECT * FROM ingredients ORDER BY name ASC'));
  const loadMetrics = () => setMetrics(db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1'));
  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));

  const handleEdit = (recipe: any) => {
    const recipeIngs = db.getAllSync('SELECT ri.*, i.name, i.nutrients, i.base_quantity, i.base_unit FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [recipe.id]) as any[];
    setNewRecipe({ 
      name: recipe.name, 
      description: recipe.description, 
      base_quantity: recipe.base_quantity || 1,
      base_unit: recipe.base_unit || 'serving',
      is_manual: !!recipe.nutrients,
      nutrients: JSON.parse(recipe.nutrients || '{}'),
      ingredients: recipeIngs.map(ri => ({ ...ri, id: ri.ingredient_id, recipe_quantity: ri.quantity, recipe_unit: ri.unit })) 
    });
    setEditingRecipeId(recipe.id); setShowOptions(null); setShowAdd(true);
  };

  const saveRecipe = () => {
    if (!newRecipe.name) return;
    const recipeId = editingRecipeId || generateUUID();
    
    db.withTransactionSync(() => {
      const payload = { 
        id: recipeId, 
        name: newRecipe.name, 
        description: newRecipe.description, 
        base_quantity: newRecipe.base_quantity, 
        base_unit: newRecipe.base_unit, 
        nutrients: newRecipe.is_manual ? JSON.stringify(newRecipe.nutrients) : null,
        user_id: userName, 
        created_at: new Date().toISOString() 
      };
      
      if (editingRecipeId) {
        db.runSync('UPDATE recipes SET name=?, description=?, base_quantity=?, base_unit=?, nutrients=? WHERE id=?', [payload.name, payload.description, payload.base_quantity, payload.base_unit, payload.nutrients, recipeId]);
        const oldIngs = db.getAllSync('SELECT id FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]) as any[];
        oldIngs.forEach(ing => queueSyncOperation('recipe_ingredients', ing.id, 'DELETE', { id: ing.id }));
        db.runSync('DELETE FROM recipe_ingredients WHERE recipe_id=?', [recipeId]);
        queueSyncOperation('recipes', recipeId, 'UPDATE', payload);
      } else {
        db.runSync('INSERT INTO recipes (id, name, description, base_quantity, base_unit, nutrients, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [recipeId, newRecipe.name, newRecipe.description, payload.base_quantity, payload.base_unit, payload.nutrients, userName, payload.created_at]);
        queueSyncOperation('recipes', recipeId, 'INSERT', payload);
      }

      if (!newRecipe.is_manual) {
        newRecipe.ingredients.forEach(ing => {
          const riId = generateUUID();
          const riPayload = { id: riId, recipe_id: recipeId, ingredient_id: ing.id, quantity: ing.recipe_quantity, unit: ing.recipe_unit };
          db.runSync('INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?, ?)', [riId, riPayload.recipe_id, riPayload.ingredient_id, riPayload.quantity, riPayload.unit]);
          queueSyncOperation('recipe_ingredients', riId, 'INSERT', riPayload);
        });
      }
    });
    
    setShowAdd(false); setEditingRecipeId(null); setNewRecipe({ name: '', description: '', ingredients: [], base_quantity: 1, base_unit: 'serving', is_manual: false, nutrients: {} }); loadRecipes();
  };

  const calculateTotals = (ings: any[]) => {
    if (newRecipe.is_manual) return newRecipe.nutrients;
    const t: any = {}; metrics.forEach(m => t[m.id] = 0);
    ings.forEach(ing => {
      const nutrients = JSON.parse(ing.nutrients || '{}');
      const ratio = (ing.recipe_quantity || 0) / (ing.base_quantity || 1);
      metrics.forEach(m => t[m.id] += (nutrients[m.id] || 0) * ratio);
    });
    return t;
  };

  const totalsPerBase = calculateTotals(newRecipe.ingredients);

  const timerRef = useRef<any>(null);
  const handlePressIn = (metricId: string, delta: number) => {
    updateManualNutrient(metricId, delta);
    let tickCount = 0;
    timerRef.current = setInterval(() => {
      tickCount++;
      const amount = delta * (1 + Math.floor(tickCount / 10) * 5);
      updateManualNutrient(metricId, amount);
    }, 100);
  };
  const handlePressOut = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const updateManualNutrient = (metricId: string, amount: number) => {
    setNewRecipe(prev => {
      const n = { ...prev.nutrients };
      n[metricId] = Math.max(0, (parseFloat(n[metricId] || 0)) + amount);
      return { ...prev, nutrients: n };
    });
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Recipes</Text><TouchableOpacity onPress={() => { setEditingRecipeId(null); setShowAdd(true); }} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {recipes.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase())).map(r => (
        <TouchableOpacity 
          key={r.id} 
          onPress={() => setShowDetails(r)}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowOptions(r); }} 
          delayLongPress={500} activeOpacity={0.7} 
          style={[styles.itemCard, { backgroundColor: theme.card }]}
        >
          <View>
            <Text style={[styles.itemName, { color: theme.text }]}>{r.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: theme.text, opacity: 0.6, fontSize: 11 }}>Yield: {r.base_quantity} {r.base_unit}</Text>
              {r.nutrients ? <View style={{ backgroundColor: 'rgba(255,45,85,0.1)', paddingHorizontal: 6, borderRadius: 4 }}><Text style={{ color: '#FF2D55', fontSize: 8, fontWeight: '900' }}>QUICK LOG</Text></View> : null}
            </View>
          </View>
          <ChevronRight size={20} color={theme.text} opacity={0.5} />
        </TouchableOpacity>
      ))}

      {/* Options Modal */}
      <Modal visible={!!showOptions} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptions(null)}>
          <BlurView intensity={20} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <View style={[styles.optionsMenu, { backgroundColor: theme.background }]}>
            <Text style={[styles.optionsTitle, { color: theme.text }]}>{showOptions?.name}</Text>
            <TouchableOpacity onPress={() => handleEdit(showOptions)} style={styles.optionBtn}>
              <Edit2 size={20} color={theme.text} /><Text style={[styles.optionText, { color: theme.text }]}>Edit Entry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(showOptions?.id)} style={styles.optionBtn}>
              <Trash2 size={20} color="#FF3B30" /><Text style={[styles.optionText, { color: '#FF3B30' }]}>Delete Entry</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Details Modal */}
      <Modal visible={!!showDetails} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, maxHeight: '90%' }]}>
              <View style={[styles.modalHeader, { marginTop: 40, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)', paddingBottom: 15 }]}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Item Details</Text>
                <TouchableOpacity onPress={() => setShowDetails(null)}><X size={24} color={theme.text} /></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                 <Text style={{ fontSize: 28, fontWeight: '900', color: theme.text, marginBottom: 5 }}>{showDetails?.name}</Text>
                 <Text style={{ fontSize: 14, color: theme.text, opacity: 0.6, marginBottom: 20 }}>{showDetails?.description || 'No description'}</Text>

                 <View style={[styles.glassCard, { backgroundColor: '#FF2D55', marginBottom: 25 }]}>
                    <Text style={{ color: 'white', fontWeight: '800', marginBottom: 15 }}>NUTRIENT BREAKDOWN (per {showDetails?.base_quantity} {showDetails?.base_unit})</Text>
                    <View style={styles.nutrientGrid}>
                       {metrics.map(m => {
                         let total = 0;
                         if (showDetails?.nutrients) {
                           total = JSON.parse(showDetails.nutrients)[m.id] || 0;
                         } else {
                           const ings = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [showDetails?.id]) as any[];
                           total = calculateTotals(ings.map(i => ({...i, recipe_quantity: i.quantity})))[m.id];
                         }
                         return <NutrientItem key={m.id} label={m.name} value={total?.toFixed(1)} unit={m.unit} color="white" />
                       })}
                    </View>
                 </View>

                 {!showDetails?.nutrients && (
                   <>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Ingredient Breakdown</Text>
                    {(db.getAllSync('SELECT ri.quantity, ri.unit, i.name, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [showDetails?.id]) as any[]).map((ing, idx) => (
                      <View key={idx} style={[styles.itemCard, { backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 5 }}>
                            <Text style={{ color: theme.text, fontWeight: '700' }}>{ing.name}</Text>
                            <Text style={{ color: '#FF2D55', fontSize: 12, fontWeight: '800' }}>{ing.quantity} {ing.unit}</Text>
                          </View>
                          <View style={styles.miniNutrientGrid}>
                            {metrics.map(m => {
                                const val = (JSON.parse(ing.nutrients || '{}')[m.id] || 0) * (ing.quantity / ing.base_quantity);
                                return <Text key={m.id} style={{ color: theme.text, fontSize: 10, opacity: 0.5, marginRight: 10 }}>{m.name}: {val.toFixed(1)}</Text>
                            })}
                          </View>
                      </View>
                    ))}
                   </>
                 )}
                 <View style={{ height: 100 }} />
              </ScrollView>
           </View>
        </BlurView>
      </Modal>

      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}>
              <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingRecipeId ? 'Edit' : 'Create'} Entry</Text><TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <TextInput placeholder="Item Name (e.g. KFC Zinger)" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newRecipe.name} onChangeText={t => setNewRecipe({...newRecipe, name: t})} />
                
                <View style={[styles.segmentedContainer, { marginBottom: 25 }]}>
                  <TouchableOpacity onPress={() => setNewRecipe({...newRecipe, is_manual: false})} style={[styles.segmentButton, !newRecipe.is_manual && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                    <Utensils size={14} color={!newRecipe.is_manual ? '#FF2D55' : theme.text} />
                    <Text style={[styles.segmentText, { color: theme.text }]}>INGREDIENTS</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setNewRecipe({...newRecipe, is_manual: true})} style={[styles.segmentButton, newRecipe.is_manual && [styles.segmentActive, { backgroundColor: theme.card }]]}>
                    <Save size={14} color={newRecipe.is_manual ? '#FF2D55' : theme.text} />
                    <Text style={[styles.segmentText, { color: theme.text }]}>QUICK LOG (KFC/ETC)</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Yield Amt</Text><TextInput keyboardType="decimal-pad" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newRecipe.base_quantity.toString()} onChangeText={v => setNewRecipe({...newRecipe, base_quantity: parseFloat(v) || 1})} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Yield Unit</Text>
                    <TouchableOpacity onPress={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)} style={[styles.dropdownButton, { backgroundColor: theme.card }]}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>{units.find(u => u.id === newRecipe.base_unit)?.name || 'Select'}</Text>
                      <ChevronDown size={18} color={theme.text} />
                    </TouchableOpacity>
                    {isUnitDropdownOpen && (
                      <View style={[styles.dropdownList, { backgroundColor: theme.card }]}>
                        <ScrollView style={{ maxHeight: 150 }}>{units.map(u => (<TouchableOpacity key={u.id} onPress={() => { setNewRecipe({...newRecipe, base_unit: u.id}); setIsUnitDropdownOpen(false); }} style={styles.dropdownItem}><Text style={{ color: theme.text, fontWeight: newRecipe.base_unit === u.id ? '800' : '400' }}>{u.name}</Text></TouchableOpacity>))}</ScrollView>
                      </View>
                    )}
                  </View>
                </View>

                {newRecipe.is_manual ? (
                  <View style={{ backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 20, padding: 20, marginBottom: 20 }}>
                     <Text style={[styles.inputLabel, { color: theme.text, opacity: 0.6, fontSize: 13 }]}>MANUAL NUTRIENTS</Text>
                     {metrics.map(m => (
                        <View key={m.id} style={styles.nutrientInputRow}>
                          <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{m.name} ({m.unit})</Text>
                          <View style={styles.stepperContainer}>
                            <TouchableOpacity onPressIn={() => handlePressIn(m.id, -1)} onPressOut={handlePressOut} style={[styles.stepperBtn, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>-</Text></TouchableOpacity>
                            <TextInput keyboardType="decimal-pad" style={[styles.smallInput, { color: theme.text, borderColor: 'transparent', width: 60 }]} value={String(newRecipe.nutrients[m.id] || 0)} onChangeText={v => { const n = {...newRecipe.nutrients}; n[m.id] = parseFloat(v) || 0; setNewRecipe({...newRecipe, nutrients: n}); }} />
                            <TouchableOpacity onPressIn={() => handlePressIn(m.id, 1)} onPressOut={handlePressOut} style={[styles.stepperBtn, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>+</Text></TouchableOpacity>
                          </View>
                        </View>
                     ))}
                  </View>
                ) : (
                  <>
                    <View style={[styles.miniNutrientGrid, { marginBottom: 20, backgroundColor: theme.card, padding: 15, borderRadius: 16 }]}>
                       <Text style={{ width: '100%', color: theme.text, fontSize: 12, fontWeight: '800', marginBottom: 10, opacity: 0.6 }}>TOTAL BATCH NUTRIENTS</Text>
                       {metrics.map(m => (<View key={m.id} style={{ width: '33%', marginBottom: 10 }}><Text style={{ color: '#FF2D55', fontSize: 10, fontWeight: 'bold' }}>{m.name.toUpperCase()}</Text><Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{totalsPerBase[m.id]?.toFixed(1)}{m.unit}</Text></View>))}
                    </View>

                    <Text style={[styles.inputLabel, { color: theme.text }]}>Ingredients</Text>
                    {newRecipe.ingredients.map((ing, idx) => (
                      <View key={idx} style={[styles.itemCard, { backgroundColor: theme.card, marginBottom: 5, flexDirection: 'column', alignItems: 'flex-start' }]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 }}><Text style={{ color: theme.text, fontWeight: 'bold' }}>{ing.name}</Text><TouchableOpacity onPress={() => { const ings = [...newRecipe.ingredients]; ings.splice(idx, 1); setNewRecipe({...newRecipe, ingredients: ings}); }}><Trash2 size={16} color="#FF2D55" /></TouchableOpacity></View>
                        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', zIndex: idx === openIngUnitIdx ? 1001 : 1 }}>
                          <TextInput 
                            keyboardType="decimal-pad" 
                            style={[styles.smallInput, { color: theme.text, borderColor: 'rgba(150,150,150,0.2)', width: 80, height: 36 }]} 
                            value={ing.recipe_quantity.toString()} 
                            onChangeText={(v) => { const ings = [...newRecipe.ingredients]; ings[idx].recipe_quantity = parseFloat(v) || 0; setNewRecipe({...newRecipe, ingredients: ings}); }} 
                          />
                          <View style={{ flex: 1, position: 'relative' }}>
                            <TouchableOpacity onPress={() => setOpenIngUnitIdx(openIngUnitIdx === idx ? null : idx)} style={[styles.dropdownButton, { backgroundColor: theme.background, padding: 8, height: 36, borderWidth: 1, borderColor: 'rgba(150,150,150,0.2)' }]}>
                              <Text style={{ color: theme.text, fontSize: 12, fontWeight: '600' }}>{units.find(u => u.id === ing.recipe_unit)?.name || 'Unit'}</Text>
                              <ChevronDown size={14} color={theme.text} />
                            </TouchableOpacity>
                            {openIngUnitIdx === idx && (
                              <View style={[styles.dropdownList, { top: 40, backgroundColor: theme.card, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 }]}>
                                <ScrollView style={{ maxHeight: 120 }} nestedScrollEnabled>
                                  {units.map(u => (
                                    <TouchableOpacity 
                                      key={u.id} 
                                      onPress={() => { 
                                        const ings = [...newRecipe.ingredients]; 
                                        ings[idx].recipe_unit = u.id; 
                                        setNewRecipe({...newRecipe, ingredients: ings}); 
                                        setOpenIngUnitIdx(null); 
                                      }} 
                                      style={styles.dropdownItem}
                                    >
                                      <Text style={{ color: theme.text, fontSize: 12 }}>{u.name}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                    ))}
                    <Text style={[styles.inputLabel, { color: theme.text, marginTop: 20 }]}>Add from Library</Text>
                    <View style={[styles.searchBar, { backgroundColor: theme.card, marginBottom: 15 }]}>
                      <Search size={16} color={theme.text} opacity={0.5} />
                      <TextInput placeholder="Search library..." style={{ flex: 1, color: theme.text, fontSize: 14 }} value={ingSearch} onChangeText={setIngSearch} />
                    </View>
                    <View style={{ maxHeight: 200, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 16, padding: 10 }}>
                      <ScrollView nestedScrollEnabled>{allIngredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).map(ing => (
                        <TouchableOpacity key={ing.id} onPress={() => { setNewRecipe({ ...newRecipe, ingredients: [...newRecipe.ingredients, { ...ing, recipe_quantity: 1, recipe_unit: ing.base_unit }] }); setIngSearch(''); }} style={[styles.itemCard, { backgroundColor: theme.card, marginBottom: 5 }]}><Text style={{ color: theme.text }}>{ing.name}</Text><Plus size={16} color="#FF2D55" /></TouchableOpacity>
                      ))}</ScrollView>
                    </View>
                  </>
                )}
                <TouchableOpacity onPress={saveRecipe} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Entry</Text></TouchableOpacity>
              </ScrollView>
           </View>
        </BlurView>
      </Modal>
    </Animated.View>
  );
}

// ==========================================
// 3. INGREDIENTS TAB
// ==========================================
function IngredientsTab({ theme, searchQuery, userName }: any) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingIngId, setEditingIngId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<any | null>(null);
  const [newIng, setNewIng] = useState({ name: '', category: 'General', nutrients: {}, base_quantity: 100, base_unit: 'g' });
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);

  useEffect(() => { loadIngredients(); loadMetrics(); loadUnits(); }, []);
  const loadIngredients = () => setIngredients(db.getAllSync('SELECT * FROM ingredients ORDER BY name ASC'));
  const loadMetrics = () => setMetrics(db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1'));
  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));

  const timerRef = useRef<any>(null);
  const handlePressIn = (metricId: string, delta: number) => {
    updateNutrient(metricId, delta);
    let tickCount = 0;
    timerRef.current = setInterval(() => {
      tickCount++;
      const multiplier = Math.floor(tickCount / 10);
      const amount = delta * (1 + multiplier * 5);
      updateNutrient(metricId, amount);
    }, 100);
  };
  const handlePressOut = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  const updateNutrient = (metricId: string, amount: number) => {
    setNewIng(prev => {
      const n = { ...prev.nutrients };
      // @ts-ignore
      n[metricId] = Math.max(0, (parseFloat(n[metricId] || 0)) + amount);
      return { ...prev, nutrients: n };
    });
  };

  const handleEdit = (ing: any) => {
    setNewIng({ name: ing.name, category: ing.category, nutrients: JSON.parse(ing.nutrients || '{}'), base_quantity: ing.base_quantity, base_unit: ing.base_unit });
    setEditingIngId(ing.id); setShowOptions(null); setShowAdd(true);
  };

  const handleDelete = (ingId: string) => {
    Alert.alert('Delete Ingredient?', 'This will affect all recipes using this.', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.withTransactionSync(() => {
          const ri = db.getAllSync('SELECT id FROM recipe_ingredients WHERE ingredient_id = ?', [ingId]) as any[];
          ri.forEach(r => queueSyncOperation('recipe_ingredients', r.id, 'DELETE', { id: r.id }));
          db.runSync('DELETE FROM recipe_ingredients WHERE ingredient_id = ?', [ingId]);
          db.runSync('DELETE FROM ingredients WHERE id = ?', [ingId]);
        });
        queueSyncOperation('ingredients', ingId, 'DELETE', { id: ingId });
        loadIngredients(); setShowOptions(null);
      }}
    ]);
  };

  const saveIngredient = () => {
    if (!newIng.name) return;
    const id = editingIngId || generateUUID();
    const payload = { id, name: newIng.name, category: newIng.category, nutrients: newIng.nutrients, base_quantity: newIng.base_quantity, base_unit: newIng.base_unit, user_id: userName, created_at: new Date().toISOString() };
    if (editingIngId) db.runSync('UPDATE ingredients SET name=?, category=?, nutrients=?, base_quantity=?, base_unit=? WHERE id=?', [payload.name, payload.category, JSON.stringify(payload.nutrients), payload.base_quantity, payload.base_unit, id]);
    else db.runSync('INSERT INTO ingredients (id, name, category, nutrients, base_quantity, base_unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [payload.id, payload.name, payload.category, JSON.stringify(payload.nutrients), payload.base_quantity, payload.base_unit, payload.user_id, payload.created_at]);
    queueSyncOperation('ingredients', id, editingIngId ? 'UPDATE' : 'INSERT', payload);
    setShowAdd(false); setEditingIngId(null); setNewIng({ name: '', category: 'General', nutrients: {}, base_quantity: 100, base_unit: 'g' }); loadIngredients();
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Library</Text><TouchableOpacity onPress={() => { setEditingIngId(null); setShowAdd(true); }} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {ingredients.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase())).map(ing => (
        <TouchableOpacity key={ing.id} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowOptions(ing); }} delayLongPress={500} activeOpacity={0.7} style={[styles.itemCard, { backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}><View><Text style={[styles.itemName, { color: theme.text, fontWeight: 'bold' }]}>{ing.name}</Text><Text style={{ color: theme.text, opacity: 0.5, fontSize: 10 }}>Base: {ing.base_quantity}{ing.base_unit}</Text></View><Text style={{ color: '#FF2D55', fontSize: 12 }}>{ing.category}</Text></View>
          <View style={styles.miniNutrientGrid}>{metrics.map(m => (<Text key={m.id} style={{ color: theme.text, fontSize: 11, marginRight: 10, opacity: 0.7 }}>{m.name}: {(JSON.parse(ing.nutrients || '{}')[m.id] || 0)}{m.unit}</Text>))}</View>
        </TouchableOpacity>
      ))}

      <Modal visible={!!showOptions} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptions(null)}>
          <BlurView intensity={20} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <View style={[styles.optionsMenu, { backgroundColor: theme.background }]}>
            <Text style={[styles.optionsTitle, { color: theme.text }]}>{showOptions?.name}</Text>
            <TouchableOpacity onPress={() => handleEdit(showOptions)} style={styles.optionBtn}>
              <Edit2 size={20} color={theme.text} /><Text style={[styles.optionText, { color: theme.text }]}>Edit Ingredient</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(showOptions?.id)} style={styles.optionBtn}>
              <Trash2 size={20} color="#FF3B30" /><Text style={[styles.optionText, { color: '#FF3B30' }]}>Delete Ingredient</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}>
              <View style={[styles.modalHeader]}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingIngId ? 'Edit' : 'Add'} Ingredient</Text><TouchableOpacity onPress={() => { setShowAdd(false); setEditingIngId(null); }}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <TextInput placeholder="Ingredient Name" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newIng.name} onChangeText={t => setNewIng({...newIng, name: t})} />
                <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Base Qty</Text><TextInput keyboardType="decimal-pad" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newIng.base_quantity.toString()} onChangeText={v => setNewIng({...newIng, base_quantity: parseFloat(v) || 0})} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Base Unit</Text>
                    <TouchableOpacity onPress={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)} style={[styles.dropdownButton, { backgroundColor: theme.card }]}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>{units.find(u => u.id === newIng.base_unit)?.name || 'Select'}</Text>
                      <ChevronDown size={18} color={theme.text} />
                    </TouchableOpacity>
                    {isUnitDropdownOpen && (
                      <View style={[styles.dropdownList, { backgroundColor: theme.card }]}>
                        <ScrollView style={{ maxHeight: 150 }}>{units.map(u => (<TouchableOpacity key={u.id} onPress={() => { setNewIng({...newIng, base_unit: u.id}); setIsUnitDropdownOpen(false); }} style={styles.dropdownItem}><Text style={{ color: theme.text, fontWeight: newIng.base_unit === u.id ? '800' : '400' }}>{u.name}</Text></TouchableOpacity>))}</ScrollView>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={[styles.inputLabel, { color: theme.text }]}>Nutrients</Text>
                <View style={{ maxHeight: 300, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 16, padding: 10 }}>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true}>
                    {metrics.map(m => (
                      <View key={m.id} style={styles.nutrientInputRow}>
                        <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{m.name} ({m.unit})</Text>
                        <View style={styles.stepperContainer}>
                          <TouchableOpacity onPressIn={() => handlePressIn(m.id, -1)} onPressOut={handlePressOut} style={[styles.stepperBtn, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>-</Text></TouchableOpacity>
                          <TextInput keyboardType="decimal-pad" style={[styles.smallInput, { color: theme.text, borderColor: 'transparent', width: 60 }]} value={String((newIng.nutrients as any)[m.id] || 0)} onChangeText={v => { const n = {...newIng.nutrients}; (n as any)[m.id] = parseFloat(v) || 0; setNewIng({...newIng, nutrients: n}); }} />
                          <TouchableOpacity onPressIn={() => handlePressIn(m.id, 1)} onPressOut={handlePressOut} style={[styles.stepperBtn, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
                <TouchableOpacity onPress={saveIngredient} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Ingredient</Text></TouchableOpacity><View style={{ height: 100 }} />
              </ScrollView>
           </View>
        </BlurView>
      </Modal>
    </Animated.View>
  );
}

// ==========================================
// 4. REPORT TAB
// ==========================================
function DietReportTab({ theme, userName }: any) {
  const [filter, setFilter] = useState<FilterType>('week');
  const [chartOptions, setChartOptions] = useState<any>(null);
  const [topItems, setTopItems] = useState<any[]>([]);
  const colorScheme = useColorScheme() ?? 'light';

  useEffect(() => { loadReport(); }, [filter, userName]);

  const loadReport = () => {
    const now = new Date(); let startDate = new Date();
    if (filter === 'week') startDate.setDate(now.getDate() - 7);
    else if (filter === 'month') startDate.setMonth(now.getMonth() - 1);
    else if (filter === '3months') startDate.setMonth(now.getMonth() - 3);
    else if (filter === '6months') startDate.setMonth(now.getMonth() - 6);
    else if (filter === 'year') startDate.setFullYear(now.getFullYear() - 1);
    else startDate = new Date(0);

    const dateStr = startDate.toISOString().split('T')[0];
    const data = db.getAllSync('SELECT * FROM diet_plans WHERE date >= ? ORDER BY date ASC', [dateStr]) as any[];
    
    const categories: string[] = []; 
    const meActualData: number[] = []; 
    const meTargetData: number[] = [];
    const themActualData: number[] = [];
    
    const grouped: any = {};
    const itemFreq: any = {};

    data.forEach(p => {
      if (!grouped[p.date]) grouped[p.date] = { meActual: 0, meTarget: 0, themActual: 0 };
      const isMe = p.user_id === userName || p.is_shared === 1;
      const isThem = p.user_id !== userName || p.is_shared === 1;
      
      if (isMe && p.is_eaten === 1) {
        const key = `${p.type}:${p.item_id}`;
        itemFreq[key] = (itemFreq[key] || 0) + 1;
      }

      let cals = 0;
      if (p.type === 'ingredient') {
        const ing = db.getFirstSync('SELECT nutrients, base_quantity FROM ingredients WHERE id = ?', [p.item_id]) as any;
        if (ing) cals = (JSON.parse(ing.nutrients || '{}')['m1'] || 0) * ((parseFloat(p.quantity) || 0) / (ing.base_quantity || 1));
      } else {
        const recipe = db.getFirstSync('SELECT * FROM recipes WHERE id = ?', [p.item_id]) as any;
        if (recipe) {
          const recipeRatio = (parseFloat(p.quantity) || 0) / (recipe.base_quantity || 1);
          if (recipe.nutrients) {
            cals = (JSON.parse(recipe.nutrients)['m1'] || 0) * recipeRatio;
          } else {
            const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [p.item_id]) as any[];
            recipeIngs.forEach(ri => {
              const nutrients = JSON.parse(ri.nutrients || '{}');
              cals += (nutrients['m1'] || 0) * (ri.quantity / (ri.base_quantity || 1)) * recipeRatio;
            });
          }
        }
      }
      
      if (isMe) {
        grouped[p.date].meTarget += cals;
        if (p.is_eaten === 1) grouped[p.date].meActual += cals;
      }
      if (isThem && p.is_eaten === 1) {
        grouped[p.date].themActual += cals;
      }
    });

    Object.keys(grouped).sort().forEach(date => {
      categories.push(date.split('-').slice(1).join('/'));
      meActualData.push(grouped[date].meActual);
      meTargetData.push(grouped[date].meTarget);
      themActualData.push(grouped[date].themActual);
    });

    const top = Object.entries(itemFreq)
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]: any) => {
        const [type, id] = key.split(':');
        const item = type === 'recipe' 
          ? db.getFirstSync('SELECT name FROM recipes WHERE id = ?', [id])
          : db.getFirstSync('SELECT name FROM ingredients WHERE id = ?', [id]);
        return { name: (item as any)?.name || 'Unknown', count };
      });
    setTopItems(top);

    setChartOptions({ 
      chart: { type: 'areaspline', backgroundColor: 'transparent' }, 
      title: { text: '' }, 
      xAxis: { categories, labels: { style: { color: theme.text } } }, 
      yAxis: { title: { text: 'Calories' }, gridLineColor: theme.card, labels: { style: { color: theme.text } } }, 
      legend: { itemStyle: { color: theme.text } }, 
      credits: { enabled: false }, 
      plotOptions: { areaspline: { fillOpacity: 0.1 } },
      series: [
        { name: 'My Target', data: meTargetData, color: theme.text, dashStyle: 'dot', fillOpacity: 0 },
        { name: 'My Actual', data: meActualData, color: '#FF2D55' }, 
        { name: 'Partner Actual', data: themActualData, color: '#5AC8FA' }
      ] 
    });
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {['week', 'month', '3months', '6months', 'year', 'overall'].map(f => (
            <TouchableOpacity key={f} onPress={() => setFilter(f as any)} style={[styles.smallTab, filter === f && { backgroundColor: '#FF2D55' }]}><Text style={{ color: filter === f ? 'white' : theme.text, fontSize: 11, fontWeight: '700' }}>{f.toUpperCase()}</Text></TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={[styles.glassCard, { backgroundColor: theme.card, marginTop: 20, minHeight: 300 }]}>
        {chartOptions && <HighchartsChart height={300} options={chartOptions} />}
      </View>

      <View style={{ marginTop: 30 }}>
        <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 15 }]}>Top Logged Items</Text>
        {topItems.map((item, i) => (
          <View key={i} style={[styles.itemCard, { backgroundColor: theme.card, marginBottom: 8 }]}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,45,85,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#FF2D55', fontSize: 12, fontWeight: '900' }}>{i+1}</Text>
                </View>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{item.name}</Text>
             </View>
             <Text style={{ color: theme.text, opacity: 0.5, fontSize: 12 }}>{item.count} times</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

function RoutineItemCard({ plan, theme, userName, allRecipes, allIngredients, onToggle, onEdit, onDelete }: any) {
  const item = plan.type === 'recipe' ? allRecipes.find((r: any) => r.id === plan.item_id) : allIngredients.find((i: any) => i.id === plan.item_id);
  const isMe = plan.user_id === userName;
  const isShared = plan.is_shared === 1;

  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (translateX.value > 100) {
        runOnJS(onToggle)(plan);
        translateX.value = withSpring(SCREEN_WIDTH);
      } else if (translateX.value < -100) {
        translateX.value = withSpring(0);
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    backgroundColor: interpolate(
      translateX.value,
      [-100, 0, 100],
      ['rgba(255,45,85,0.05)', theme.card, 'rgba(52,199,89,0.1)']
    )
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View 
        style={[
          styles.itemCard, 
          animatedStyle, 
          { 
            borderLeftWidth: 4, 
            borderLeftColor: isShared ? '#AF52DE' : (isMe ? '#FF2D55' : '#5AC8FA'),
            overflow: 'hidden'
          }
        ]}
      >
        <TouchableOpacity 
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onEdit(plan); }}
          delayLongPress={500}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
        >
           <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: isShared ? '#AF52DE' : '#FF2D55', marginRight: 15 }} />
           <View>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.itemTime, { color: isShared ? '#AF52DE' : (isMe ? '#FF2D55' : '#5AC8FA') }]}>
                  {plan.meal_time}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(150,150,150,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                   {isShared ? <Info size={10} color="#AF52DE" /> : (isMe ? <Plus size={10} color="#FF2D55" /> : <TrendingUp size={10} color="#5AC8FA" />)}
                   <Text style={{ fontSize: 8, fontWeight: '900', color: isShared ? '#AF52DE' : (isMe ? '#FF2D55' : '#5AC8FA') }}>
                     {isShared ? 'SHARED' : (isMe ? 'ME' : 'PARTNER')}
                   </Text>
                </View>
             </View>
             <Text style={[styles.itemName, { color: theme.text }]}>{item?.name}</Text>
           </View>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
           <Text style={[styles.itemValue, { color: theme.text, marginRight: 15 }]}>{plan.quantity} {plan.unit}</Text>
           <TouchableOpacity onPress={() => onDelete(plan.id)}><Trash2 size={16} color="#FF2D55" opacity={0.3} /></TouchableOpacity>
        </View>
      </Animated.View>
    </GestureDetector>
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
  container: { flex: 1, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1 },
  headerTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  searchContainer: { paddingHorizontal: 20, marginTop: 15 },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 44, borderRadius: 12, gap: 10 },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '600' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 20, marginTop: 15, gap: 10 },
  tabButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(150,150,150,0.1)' },
  tabText: { fontSize: 12, fontWeight: '700' },
  scrollContent: { padding: 20 },
  tabView: { flex: 1 },
  summaryCard: { marginBottom: 25 },
  glassCard: { borderRadius: 24, padding: 20, overflow: 'hidden' },
  cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 15 },
  nutrientGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, marginTop: 20 },
  nutrientItem: { width: '45%' },
  nutrientLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  nutrientValue: { fontSize: 20, fontWeight: '800', color: 'white' },
  nutrientUnit: { fontSize: 10, color: 'white', opacity: 0.6 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  sectionTitle: { fontSize: 20, fontWeight: '800' },
  addButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF2D55', justifyContent: 'center', alignItems: 'center' },
  itemCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10 },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemTime: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  itemValue: { fontSize: 14, fontWeight: '700' },
  miniNutrientGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { height: '90%', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, overflow: 'hidden' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 24, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 15, fontSize: 16 },
  inputLabel: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  nutrientInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stepperContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.1)', borderRadius: 12, padding: 2 },
  stepperBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  smallInput: { borderWidth: 1, borderRadius: 8, padding: 8, width: 80, textAlign: 'center' },
  smallTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(150,150,150,0.1)', marginRight: 5, minWidth: 40, alignItems: 'center' },
  dropdownButton: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  dropdownList: { position: 'absolute', top: 75, left: 0, right: 0, borderRadius: 12, padding: 10, zIndex: 1000, elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10 },
  dropdownItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)' },
  saveButton: { backgroundColor: '#FF2D55', flexDirection: 'row', padding: 16, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: 'white', fontWeight: '800', marginLeft: 10, fontSize: 16 },
  segmentedContainer: { flexDirection: 'row', backgroundColor: 'rgba(150,150,150,0.1)', borderRadius: 14, padding: 2, marginBottom: 15, gap: 2 },
  segmentButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, gap: 6 },
  segmentActive: { backgroundColor: 'white', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  segmentText: { fontSize: 11, fontWeight: '700' },
  dayCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' },
  smallHeaderButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, gap: 4 },
  sliderHandle: { position: 'absolute', right: 0 },
  filterContainer: { paddingHorizontal: 0, marginTop: 5 },
  optionsMenu: { position: 'absolute', bottom: 40, left: 20, right: 20, borderRadius: 24, padding: 20, elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  optionsTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  optionBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, backgroundColor: 'rgba(150,150,150,0.05)' },
  optionText: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
});
