import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, Modal, FlatList, Alert, Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Plus, Search, ChevronRight, ChevronDown, Trash2, Edit2, Save, X, Utensils, TrendingUp, Calendar, PieChart, Clock, Rotate3d, Info, CheckCircle2, ChevronLeft, User, Users } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown, SlideInBottom, useSharedValue, useAnimatedStyle, withSpring, withTiming, interpolate, interpolateColor, runOnJS, Extrapolate } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as SecureStore from 'expo-secure-store';
import HighchartsChart from '@/components/HighchartsChart';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, isToday, parseISO, subDays } from 'date-fns';

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

        <View style={{ flex: 1 }}>
          {activeTab === 'PLAN' && userName !== '' && <DietPlanTab ref={dietPlanRef} theme={theme} searchQuery={searchQuery} userName={userName} setActiveTab={setActiveTab} />}
          {activeTab !== 'PLAN' && (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              {activeTab === 'RECIPES' && <RecipesTab theme={theme} searchQuery={searchQuery} userName={userName} />}
              {activeTab === 'INGREDIENTS' && <IngredientsTab theme={theme} searchQuery={searchQuery} userName={userName} />}
              {activeTab === 'REPORT' && <DietReportTab theme={theme} userName={userName} />}
            </ScrollView>
          )}
        </View>
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
  const selectedDate = new Date();

  const CARD_HEIGHT = Dimensions.get('window').height - insets.top - insets.bottom - 160;
  const TRACK_HEIGHT = CARD_HEIGHT - 100;
  const SLIDER_ADJUSTMENT = 46;
  const ACTUAL_TRACK_HEIGHT = TRACK_HEIGHT - SLIDER_ADJUSTMENT;
  const HANDLE_HEIGHT = 60;

  // Shared Values
  const contentHeight = useSharedValue(CARD_HEIGHT - 60);
  const summaryFlipRotation = useSharedValue(0);
  const summaryScrollOffset = useSharedValue(0);
  const summaryMaxScroll = useSharedValue(0);
  const summaryFrontScrollOffset = useSharedValue(0);
  const summaryFrontMaxScroll = useSharedValue(0);
  const savedScrollOffset = useSharedValue(0);
  const savedFrontScrollOffset = useSharedValue(0);
  const lastStep = useSharedValue(0);
  const sliderScale = useSharedValue(1);
  const sliderDragPos = useSharedValue(0);
  const isDraggingSlider = useSharedValue(false);

  const [measuredHeight, setMeasuredHeight] = useState(CARD_HEIGHT - 60);

  const onLayoutContainer = (event: any) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0 && Math.abs(height - measuredHeight) > 1) {
      setMeasuredHeight(height);
      contentHeight.value = height;
    }
  };

  const [plans, setPlans] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [isPickerMode, setIsPickerMode] = useState(false);
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);
  const [isSharedFilter, setIsSharedFilter] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isSummaryFlipped, setIsSummaryFlipped] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  
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

  React.useImperativeHandle(ref, () => ({
    openAdd: (isEaten: number) => {
      setNewPlan({ 
        meal_time: format(new Date(), 'HH:mm'), 
        type: 'recipe', 
        item_id: '', 
        quantity: 1, 
        unit: 'serving',
        is_eaten: isEaten,
        is_shared: 0,
        is_recurring: 0,
        days_of_week: '0,1,2,3,4,5,6',
        cycle_week: 0,
        date: new Date()
      });
      setIsPickerMode(false);
      setShowAdd(true);
    }
  }));

  const toggleSummaryFlip = () => {
    runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
    setIsSummaryFlipped(!isSummaryFlipped);
    summaryFlipRotation.value = withSpring(isSummaryFlipped ? 0 : 180, { 
      damping: 18, 
      stiffness: 120,
      mass: 0.8
    });
  };

  const containerTapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(toggleSummaryFlip)();
  });

  const summaryFrontStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { perspective: 1200 },
        { rotateY: `${summaryFlipRotation.value}deg` }
      ],
      opacity: interpolate(summaryFlipRotation.value, [85, 95], [1, 0], Extrapolate.CLAMP),
      zIndex: summaryFlipRotation.value <= 90 ? 1 : 0
    };
  });

  const summaryBackStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { perspective: 1200 },
        { rotateY: `${summaryFlipRotation.value + 180}deg` }
      ],
      opacity: interpolate(summaryFlipRotation.value, [85, 95], [0, 1], Extrapolate.CLAMP),
      zIndex: summaryFlipRotation.value > 90 ? 1 : 0
    };
  });

  const summaryContentScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -summaryScrollOffset.value }]
  }));

  const summaryFrontContentScrollStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -summaryFrontScrollOffset.value }]
  }));

  const summarySliderStyle = useAnimatedStyle(() => {
    const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
    const snapPos = summaryMaxScroll.value > 0 ? (summaryScrollOffset.value / summaryMaxScroll.value) * range : 0;
    
    const activePos = isDraggingSlider.value 
      ? Math.max(0, Math.min(range, sliderDragPos.value))
      : withSpring(snapPos, { damping: 20, stiffness: 200 });

    return {
      transform: [
        { translateY: activePos },
        { scaleX: sliderScale.value },
        { scaleY: interpolate(sliderScale.value, [1, 1.3], [1, 0.8]) }
      ],
      opacity: summaryMaxScroll.value > 0 ? 1 : 0
    };
  });

  const summaryFrontSliderStyle = useAnimatedStyle(() => {
    const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
    const snapPos = summaryFrontMaxScroll.value > 0 ? (summaryFrontScrollOffset.value / summaryFrontMaxScroll.value) * range : 0;
    
    const activePos = isDraggingSlider.value 
      ? Math.max(0, Math.min(range, sliderDragPos.value))
      : withSpring(snapPos, { damping: 20, stiffness: 200 });

    return {
      transform: [
        { translateY: activePos },
        { scaleX: sliderScale.value },
        { scaleY: interpolate(sliderScale.value, [1, 1.3], [1, 0.8]) }
      ],
      opacity: summaryFrontMaxScroll.value > 0 ? 1 : 0
    };
  });

  const contentDragGesture = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .failOffsetX([-20, 20])
    .onStart(() => {
      savedScrollOffset.value = summaryScrollOffset.value;
    })
    .onUpdate((e) => {
      if (summaryMaxScroll.value <= 0) {
        summaryScrollOffset.value = 0;
        return;
      }
      let newVal = savedScrollOffset.value - e.translationY;
      if (newVal < 0) newVal = newVal * 0.3;
      else if (newVal > summaryMaxScroll.value) newVal = summaryMaxScroll.value + (newVal - summaryMaxScroll.value) * 0.3;
      summaryScrollOffset.value = newVal;
    })
    .onEnd((e) => {
      if (contentHeight.value > 0) {
        const velocity = -e.velocityY;
        const translation = -e.translationY;
        const currentIndex = Math.round(savedScrollOffset.value / contentHeight.value);
        const totalItems = Math.round(summaryMaxScroll.value / contentHeight.value) + 1;
        let targetIndex = currentIndex;
        const threshold = contentHeight.value * 0.15;
        if (Math.abs(velocity) > 500 || Math.abs(translation) > threshold) {
          if (velocity > 300 || translation > threshold) targetIndex = Math.min(totalItems - 1, currentIndex + 1);
          else if (velocity < -300 || translation < -threshold) targetIndex = Math.max(0, currentIndex - 1);
        }
        summaryScrollOffset.value = withSpring(targetIndex * contentHeight.value, { damping: 22, stiffness: 200, velocity });
        if (targetIndex !== currentIndex) runOnJS(Haptics.selectionAsync)();
      }
    });

  const contentFrontDragGesture = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .failOffsetX([-20, 20])
    .onStart(() => {
      savedFrontScrollOffset.value = summaryFrontScrollOffset.value;
    })
    .onUpdate((e) => {
      if (summaryFrontMaxScroll.value <= 0) return;
      let newVal = savedFrontScrollOffset.value - e.translationY;
      if (newVal < 0) newVal = newVal * 0.3;
      else if (newVal > summaryFrontMaxScroll.value) newVal = summaryFrontMaxScroll.value + (newVal - summaryFrontMaxScroll.value) * 0.3;
      summaryFrontScrollOffset.value = newVal;
    })
    .onEnd((e) => {
      if (summaryFrontMaxScroll.value > 0) {
        const velocity = -e.velocityY;
        const target = Math.max(0, Math.min(summaryFrontMaxScroll.value, summaryFrontScrollOffset.value + velocity * 0.1));
        summaryFrontScrollOffset.value = withSpring(target, { damping: 20, stiffness: 150, velocity });
      }
    });

  const summarySliderGesture = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      isDraggingSlider.value = true;
      sliderScale.value = withSpring(1.3, { damping: 10, stiffness: 300 });
      lastStep.value = Math.round(summaryScrollOffset.value / (contentHeight.value || 1));
      const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
      let pos = e.y - (HANDLE_HEIGHT / 2);
      sliderDragPos.value = Math.max(0, Math.min(range, pos));
    })
    .onUpdate((e) => {
      if (summaryMaxScroll.value <= 0) return;
      const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
      let pos = e.y - (HANDLE_HEIGHT / 2);
      sliderDragPos.value = pos;
      const totalSteps = Math.round(summaryMaxScroll.value / (contentHeight.value || 1));
      if (totalSteps > 0) {
        const stepSize = range / totalSteps;
        const currentStep = Math.round(Math.max(0, Math.min(range, pos)) / stepSize);
        if (currentStep !== lastStep.value) {
          lastStep.value = currentStep;
          runOnJS(Haptics.selectionAsync)();
          summaryScrollOffset.value = withSpring(currentStep * contentHeight.value, { damping: 12, stiffness: 200, mass: 0.5 });
        }
      } else {
        summaryScrollOffset.value = (Math.max(0, Math.min(range, pos)) / range) * summaryMaxScroll.value;
      }
    })
    .onEnd(() => {
      isDraggingSlider.value = false;
      sliderScale.value = withSpring(1, { damping: 12, stiffness: 200 });
      const totalSteps = Math.round(summaryMaxScroll.value / (contentHeight.value || 1));
      if (totalSteps > 0) {
        const currentStep = Math.round(summaryScrollOffset.value / contentHeight.value);
        summaryScrollOffset.value = withSpring(currentStep * contentHeight.value, { damping: 18, stiffness: 250 });
      }
    });

  const summaryFrontSliderGesture = Gesture.Pan()
    .minDistance(0)
    .onStart((e) => {
      isDraggingSlider.value = true;
      sliderScale.value = withSpring(1.3, { damping: 10, stiffness: 300 });
      const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
      let pos = e.y - (HANDLE_HEIGHT / 2);
      sliderDragPos.value = Math.max(0, Math.min(range, pos));
    })
    .onUpdate((e) => {
      if (summaryFrontMaxScroll.value <= 0) return;
      const range = ACTUAL_TRACK_HEIGHT - HANDLE_HEIGHT;
      let pos = e.y - (HANDLE_HEIGHT / 2);
      sliderDragPos.value = pos;
      const cappedPos = Math.max(0, Math.min(range, pos));
      summaryFrontScrollOffset.value = (cappedPos / range) * summaryFrontMaxScroll.value;
    })
    .onEnd(() => {
      isDraggingSlider.value = false;
      sliderScale.value = withSpring(1, { damping: 12, stiffness: 200 });
    });

  const loadLibrary = () => {
    setAllRecipes(db.getAllSync('SELECT * FROM recipes') || []);
    setAllIngredients(db.getAllSync('SELECT * FROM ingredients') || []);
  };

  const loadMetrics = () => {
    const data = db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1') || [];
    setMetrics(data);
  };

  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC') || []);

  const getCycleWeek = (date: Date) => {
    const settings = db.getFirstSync('SELECT cycle_length FROM diet_settings WHERE id = "global"') as any;
    const length = settings?.cycle_length || 4;
    const dayOfMonth = date.getDate();
    const weekOfMonth = Math.floor((dayOfMonth - 1) / 7) + 1;
    return ((weekOfMonth - 1) % length) + 1;
  };

  const loadPlans = () => {
    const todayStr = format(selectedDate, 'yyyy-MM-dd');
    const dayIndex = selectedDate.getDay().toString();
    const currentCycleWeek = getCycleWeek(selectedDate);
    const instantiated = db.getAllSync('SELECT * FROM diet_plans WHERE date = ? AND (is_eaten > 0 OR is_recurring = 0)', [todayStr]) as any[] || [];
    const templates = db.getAllSync(`
      SELECT * FROM diet_plans 
      WHERE is_recurring = 1 
      AND (INSTR(',' || days_of_week || ',', ',' || ? || ',') > 0)
      AND (cycle_week = 0 OR cycle_week = ?)
      AND is_eaten = 0
    `, [dayIndex, currentCycleWeek]) as any[] || [];
    const activeTemplates = templates.filter(t => !instantiated.some(i => i.template_id === t.id));
    const allCurrentPlans = [...instantiated, ...activeTemplates].sort((a, b) => a.meal_time.localeCompare(b.meal_time));
    setPlans(allCurrentPlans);
    calculateDailyTotals(allCurrentPlans);
  };

  useFocusEffect(
    React.useCallback(() => {
      loadLibrary(); loadMetrics(); loadUnits(); loadPlans();
    }, [userName, metrics.length])
  );

  const calculateDailyTotals = (currentPlans: any[]) => {
    const dailyTotals: any = { me: {}, them: {} };
    const currentMetrics = (metrics && metrics.length > 0) ? metrics : db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1') || [];
    
    // Initialize
    currentMetrics.forEach((m: any) => { 
      dailyTotals.me[m.id] = 0; 
      dailyTotals.them[m.id] = 0; 
    });

    if (!currentPlans) return;

    (currentPlans).forEach(plan => {
      if (plan.is_eaten !== 1) return; // ONLY sum eaten/consumed items
      if (isSharedFilter && plan.is_shared !== 1) return;

      const isMe = (plan.user_id || '').toLowerCase() === (userName || '').toLowerCase() || plan.is_shared === 1;
      const isPartner = (plan.user_id || '').toLowerCase() !== (userName || '').toLowerCase() || plan.is_shared === 1;
      
      const getItemNutrients = () => {
        let totalNutrients: any = {};
        currentMetrics.forEach(m => totalNutrients[m.id] = 0);
        
        try {
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
                const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [plan.item_id]) as any[] || [];
                recipeIngs.forEach(ri => {
                  const nutrients = JSON.parse(ri.nutrients || '{}');
                  const ingRatio = (ri.quantity / (ri.base_quantity || 1));
                  currentMetrics.forEach(m => { totalNutrients[m.id] += (nutrients[m.id] || 0) * ingRatio * recipeRatio; });
                });
              }
            }
          }
        } catch (e) { console.warn('Nutrient calc error', e); }
        return totalNutrients;
      };

      const planNutrients = getItemNutrients();
      if (isMe) {
        currentMetrics.forEach(m => {
          dailyTotals.me[m.id] += (planNutrients[m.id] || 0);
        });
      }
      if (isPartner) {
        currentMetrics.forEach(m => {
          dailyTotals.them[m.id] += (planNutrients[m.id] || 0);
        });
      }
    });
    setDietPlanProgress(dailyTotals);
  };

  useEffect(() => {
    calculateDailyTotals(plans);
  }, [isSharedFilter, plans, userName]);

  const savePlanItem = () => {
    if (!newPlan.item_id) return;
    const id = editingPlanId || generateUUID();
    const todayStr = format(selectedDate, 'yyyy-MM-dd');
    const payload = { id, date: todayStr, meal_time: newPlan.meal_time, type: newPlan.type, item_id: newPlan.item_id, quantity: newPlan.quantity, unit: newPlan.unit, user_id: userName, is_eaten: newPlan.is_eaten, is_shared: newPlan.is_shared, is_recurring: newPlan.is_recurring, days_of_week: newPlan.days_of_week, cycle_week: newPlan.cycle_week, created_at: new Date().toISOString() };
    if (editingPlanId) {
      db.runSync('UPDATE diet_plans SET date=?, meal_time=?, type=?, item_id=?, quantity=?, unit=?, is_eaten=?, is_shared=?, is_recurring=?, days_of_week=?, cycle_week=? WHERE id=?', [payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, id]);
      queueSyncOperation('diet_plans', id, 'UPDATE', payload);
    } else {
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    }
    setShowAdd(false); setEditingPlanId(null); loadPlans();
  };

  const handleEdit = (plan: any) => {
    setNewPlan({ meal_time: plan.meal_time, type: plan.type, item_id: plan.item_id, quantity: plan.quantity, unit: plan.unit, is_eaten: plan.is_eaten, is_shared: plan.is_shared, is_recurring: plan.is_recurring, days_of_week: plan.days_of_week, cycle_week: plan.cycle_week || 0, date: new Date(plan.date || selectedDate) });
    setEditingPlanId(plan.id); setIsPickerMode(false); setShowAdd(true);
  };

  const toggleEaten = (plan: any) => {
    const todayStr = format(selectedDate, 'yyyy-MM-dd');
    if (plan.is_recurring === 1) {
      const id = generateUUID();
      const payload = { ...plan, id, date: todayStr, is_eaten: 1, template_id: plan.id, created_at: new Date().toISOString() };
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, template_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.template_id, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    } else {
      db.runSync('UPDATE diet_plans SET is_eaten = 1, date = ? WHERE id = ?', [todayStr, plan.id]);
      queueSyncOperation('diet_plans', plan.id, 'UPDATE', { is_eaten: 1, date: todayStr });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); 
    loadPlans();
  };

  const toggleSkipped = (plan: any) => {
    const todayStr = format(selectedDate, 'yyyy-MM-dd');
    if (plan.is_recurring === 1) {
      const id = generateUUID();
      const payload = { ...plan, id, date: todayStr, is_eaten: 2, template_id: plan.id, created_at: new Date().toISOString() };
      db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, template_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
        [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.is_eaten, payload.is_shared, payload.is_recurring, payload.days_of_week, payload.cycle_week, payload.template_id, payload.created_at]);
      queueSyncOperation('diet_plans', id, 'INSERT', payload);
    } else {
      db.runSync('UPDATE diet_plans SET is_eaten = 2, date = ? WHERE id = ?', [todayStr, plan.id]);
      queueSyncOperation('diet_plans', plan.id, 'UPDATE', { is_eaten: 2, date: todayStr });
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); 
    loadPlans();
  };

  const deletePlanItem = (id: string) => {
    db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
    queueSyncOperation('diet_plans', id, 'DELETE', { id });
    loadPlans();
  };

  const routineItems = (plans || []).filter(p => p.is_eaten === 0 && (!isSharedFilter || p.is_shared === 1));
  const consumedItems = (plans || []).filter(p => p.is_eaten === 1 && (!isSharedFilter || p.is_shared === 1));

  useEffect(() => {
    const itemCount = routineItems.length || 1;
    const maxScroll = Math.max(0, (itemCount * measuredHeight) - measuredHeight);
    summaryMaxScroll.value = maxScroll;
    if (routineItems.length === 0 || summaryScrollOffset.value > maxScroll) {
      summaryScrollOffset.value = withSpring(0, { damping: 20 });
    }
  }, [routineItems.length, measuredHeight]);

  const onLayoutSummaryFrontContent = (event: any) => {
    const { height } = event.nativeEvent.layout;
    summaryFrontMaxScroll.value = Math.max(0, height - measuredHeight); 
  };

  const chartOptions = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 180 },
    title: { text: '' },
    xAxis: { categories: metrics.slice(0, 2).map((m: any) => m.name), labels: { style: { color: theme.text } } },
    series: [
      { name: 'Me (Total)', data: metrics.slice(0, 2).map((m: any) => dietPlanProgress.me[m.id] || 0), color: '#FF2D55' },
      { name: 'Partner (Total)', data: metrics.slice(0, 2).map((m: any) => dietPlanProgress.them[m.id] || 0), color: '#5AC8FA' }
    ],
    credits: { enabled: false }
  };

  return (
    <View style={{ flex: 1, padding: 15 }}>
      <View style={[styles.tabView]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <GestureDetector gesture={containerTapGesture}>
            <View style={{ flex: 1, height: CARD_HEIGHT }}>
            {/* FRONT SIDE */}
            <Animated.View style={[styles.glassCardFront, { backgroundColor: 'rgba(255,45,85,0.02)', borderWidth: 1, borderColor: 'rgba(255,45,85,0.1)', height: '100%', position: 'absolute', width: '100%' }, summaryFrontStyle]}>
                 <View style={{ flex: 1, overflow: 'hidden' }}>
                       <Animated.View onLayout={onLayoutSummaryFrontContent} style={[summaryFrontContentScrollStyle, { padding: 5 }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <View>
                                  <Text style={{ fontSize: 18, fontWeight: '800', color: '#FF2D55' }}>Daily Progress</Text>
                                  <Text style={{ fontSize: 10, fontWeight: '700', color: theme.text, opacity: 0.5 }}>TOTAL CONSUMED TODAY</Text>
                                </View>
                                <Rotate3d size={18} color={theme.text || '#000'} opacity={0.3} />
                            </View>
                            
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                                {(metrics || []).slice(0, 4).map(m => {
                                  const total = dietPlanProgress.me[m.id] || 0;
                                  return (
                                    <View key={m.id} style={{ width: '47%', backgroundColor: theme.card, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)' }}>
                                      <Text style={{ color: theme.text || '#000', fontSize: 10, fontWeight: '700', opacity: 0.6, marginBottom: 4 }}>{m.name || 'Metric'}</Text>
                                      <Text style={{ color: '#FF2D55', fontSize: 18, fontWeight: '900' }}>{total.toFixed(0)} <Text style={{ fontSize: 12, opacity: 0.5 }}>{m.unit || ''}</Text></Text>
                                    </View>
                                  );
                                })}
                            </View>
                            
                            <View pointerEvents="none" style={{ marginBottom: 20 }}>
                               <HighchartsChart height={180} options={chartOptions} />
                            </View>

                            {consumedItems.length > 0 && (
                              <View style={{ marginTop: 10 }}>
                                <Text style={{ color: theme.text, fontSize: 12, fontWeight: '900', opacity: 0.4, letterSpacing: 1, marginBottom: 12 }}>TODAY'S LOG</Text>
                                <View style={{ gap: 8 }}>
                                  {consumedItems.map(item => {
                                    const detailItem = item.type === 'recipe' 
                                      ? allRecipes.find(r => r.id === item.item_id) 
                                      : allIngredients.find(i => i.id === item.item_id);
                                    return (
                                      <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(150,150,150,0.05)', padding: 12, borderRadius: 16, gap: 12 }}>
                                        <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: item.is_shared ? 'rgba(175,82,222,0.1)' : 'rgba(255,45,85,0.1)', justifyContent: 'center', alignItems: 'center' }}>
                                          {item.type === 'recipe' ? <PieChart size={16} color={item.is_shared ? '#AF52DE' : '#FF2D55'} /> : <Utensils size={16} color={item.is_shared ? '#AF52DE' : '#FF2D55'} />}
                                        </View>
                                        <View style={{ flex: 1 }}>
                                          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '800' }} numberOfLines={1}>{detailItem?.name || 'Unknown'}</Text>
                                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                            <Text style={{ color: theme.text, fontSize: 10, opacity: 0.5, fontWeight: '700' }}>{item.meal_time}</Text>
                                            {item.is_recurring === 0 && (
                                              <View style={{ backgroundColor: '#FF2D55', paddingHorizontal: 4, py: 1, borderRadius: 4 }}>
                                                <Text style={{ color: 'white', fontSize: 7, fontWeight: '900' }}>ONE-TIME</Text>
                                              </View>
                                            )}
                                          </View>
                                        </View>
                                        <Text style={{ color: theme.text, fontSize: 13, fontWeight: '900' }}>{item.quantity} <Text style={{ fontSize: 10, opacity: 0.5 }}>{item.unit}</Text></Text>
                                      </View>
                                    );
                                  })}
                                </View>
                              </View>
                            )}
                       </Animated.View>
                 </View>
            </Animated.View>

              {/* BACK SIDE */}
              <Animated.View style={[styles.glassCard, { backgroundColor: theme.card, height: '100%', position: 'absolute', width: '100%' }, summaryBackStyle]}>
                <View style={{ flex: 1, overflow: 'hidden' }}>
                   <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2,marginTop:3,marginLeft:15, zIndex: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                         <Rotate3d size={18} color={theme.text} opacity={0.5} />
                         <View>
                           <Text style={{ color: theme.text, fontSize: 8, fontWeight: '900', opacity: 0.4 }}>WEEK {getCycleWeek(new Date())} ACTIVE</Text>
                         </View>
                      </View>
                   </View>
                   <View style={{ flex: 1 }}>
                      <View onLayout={onLayoutContainer} style={{ flex: 1, overflow: 'hidden', height: '100%' }}>
                           <Animated.View style={[summaryContentScrollStyle]}>
                              {routineItems.length === 0 && (
                                <View style={{ height: measuredHeight, justifyContent: 'center', alignItems: 'center', padding: 30 }}>
                                  <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(52,199,89,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}><CheckCircle2 size={32} color="#34C759" /></View>
                                  <Text style={{ color: theme.text, fontSize: 18, fontWeight: '900', textAlign: 'center', marginBottom: 10 }}>Routine Completed!</Text>
                                  <Text style={{ color: theme.text, opacity: 0.5, textAlign: 'center', fontSize: 14 }}>All items tracked for today. Great job keeping up with your routine!</Text>
                                </View>
                              )}
                              {routineItems.map((plan, index) => (
                                <View key={plan.id} style={{ height: measuredHeight, width: '100%' }}>
                                   <View style={{ flex: 1, padding: 10 }}>
                                      <RoutineItemCard plan={plan} theme={theme} userName={userName} allRecipes={allRecipes} allIngredients={allIngredients} onToggle={toggleEaten} onSkip={toggleSkipped} onEdit={handleEdit} onDelete={deletePlanItem} isFullCard={true} />
                                   </View>
                                </View>
                              ))}
                           </Animated.View>
                      </View>
                   </View>
                </View>
              </Animated.View>
            </View>
          </GestureDetector>
          
          <View style={{ marginLeft: 12, alignItems: 'center', gap: 10 }}>
            <TouchableOpacity 
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setIsSharedFilter(!isSharedFilter);
              }} 
              style={[styles.smallTab, { paddingHorizontal: 10, paddingVertical: 10, width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, isSharedFilter && { backgroundColor: '#FF2D55' }]}
            >
              {isSharedFilter ? (
                <Users size={16} color="white" />
              ) : (
                <User size={16} color={theme.text || '#000'} />
              )}
            </TouchableOpacity>

            <GestureDetector gesture={isSummaryFlipped ? summarySliderGesture : summaryFrontSliderGesture}>
               <View style={[styles.sliderTrack, { height: TRACK_HEIGHT - 46 }]}>
                  {isSummaryFlipped && routineItems.length > 1 && Array.from({ length: routineItems.length }).map((_, i) => (
                    <View 
                      key={i} 
                      style={{ 
                        position: 'absolute', 
                        top: (i / (routineItems.length - 1)) * ((TRACK_HEIGHT - 46) - HANDLE_HEIGHT) + (HANDLE_HEIGHT / 2), 
                        left: 9,
                        width: 12, 
                        height: 2, 
                        backgroundColor: 'rgba(255,45,85,0.3)', 
                        borderRadius: 1 
                      }} 
                    />
                  ))}
                  <Animated.View style={[styles.sliderHandle, { backgroundColor: '#FF2D55' }, isSummaryFlipped ? summarySliderStyle : summaryFrontSliderStyle]} />
               </View>
            </GestureDetector>
          </View>
        </View>
      </View>

      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}>
              {!isPickerMode ? (
                <View style={{ flex: 1 }}>
                  <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingPlanId ? 'Edit' : 'Add'} Meal</Text><TouchableOpacity onPress={() => { setShowAdd(false); setEditingPlanId(null); setIsUnitDropdownOpen(false); setIsPickerMode(false); }}><X size={24} color={theme.text} /></TouchableOpacity></View>
                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={{ marginBottom: 20 }}>
                      <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>ACTIVITY TYPE</Text>
                      <View style={styles.segmentedContainer}>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_eaten: 0})} style={[styles.segmentButton, newPlan.is_eaten === 0 && [styles.segmentActive, { backgroundColor: theme.card }]]}><Calendar size={14} color={newPlan.is_eaten === 0 ? '#FF2D55' : theme.text} /><Text style={[styles.segmentText, { color: theme.text }]}>FOR ROUTINE</Text></TouchableOpacity>
                        <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_eaten: 1})} style={[styles.segmentButton, newPlan.is_eaten === 1 && [styles.segmentActive, { backgroundColor: theme.card }]]}><Utensils size={14} color={newPlan.is_eaten === 1 ? '#34C759' : theme.text} /><Text style={[styles.segmentText, { color: theme.text }]}>ALREADY EATEN</Text></TouchableOpacity>
                      </View>
                    </View>
                    <View style={{ marginBottom: 20, padding: 15, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 20 }}>
                       <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                          <View><Text style={{ color: theme.text, fontWeight: '800' }}>RECURRING ROUTINE</Text><Text style={{ color: theme.text, opacity: 0.5, fontSize: 11 }}>Appears automatically on selected days</Text></View>
                          <TouchableOpacity onPress={() => setNewPlan({...newPlan, is_recurring: newPlan.is_recurring === 1 ? 0 : 1})} style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: newPlan.is_recurring === 1 ? '#FF2D55' : 'rgba(150,150,150,0.2)', justifyContent: 'center', paddingHorizontal: 2 }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: 'white', alignSelf: newPlan.is_recurring === 1 ? 'flex-end' : 'flex-start' }} /></TouchableOpacity>
                       </View>
                       {newPlan.is_recurring === 1 && (<View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => { const isSelected = newPlan.days_of_week.includes(i.toString()); return (<TouchableOpacity key={i} onPress={() => { let days = newPlan.days_of_week.split(',').filter(d => d !== ''); if (isSelected) days = days.filter(d => d !== i.toString()); else days.push(i.toString()); setNewPlan({...newPlan, days_of_week: days.sort().join(',')}); }} style={[styles.dayCircle, isSelected && { backgroundColor: '#FF2D55' }]}><Text style={{ color: isSelected ? 'white' : theme.text, fontSize: 10, fontWeight: '900' }}>{day}</Text></TouchableOpacity>); })}</View>)}
                    </View>
                    <View style={{ marginBottom: 20 }}><Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>SCHEDULED TIME</Text><TouchableOpacity onPress={() => setShowTimePicker(true)} style={[styles.dropdownButton, { backgroundColor: theme.card, height: 48, paddingHorizontal: 15 }]}><View style={{ flexDirection: 'row', alignItems: 'center' }}><Clock size={20} color="#FF2D55" /><Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginLeft: 12 }}>{newPlan.meal_time}</Text></View><ChevronDown size={20} color={theme.text} opacity={0.3} /></TouchableOpacity>{showTimePicker && <DateTimePicker value={(() => { const d = new Date(); const [h, m] = newPlan.meal_time.split(':'); d.setHours(parseInt(h), parseInt(m)); return d; })()} mode="time" is24Hour={true} display="default" onChange={(e, d) => { setShowTimePicker(false); if (d) setNewPlan({...newPlan, meal_time: format(d, 'HH:mm')}); }} />}</View>
                    <Text style={[styles.inputLabel, { color: theme.text, fontSize: 13, opacity: 0.6 }]}>ITEM TO ADD</Text>
                    <TouchableOpacity activeOpacity={0.7} onPress={() => setIsPickerMode(true)} style={[styles.dropdownButton, { backgroundColor: theme.card, height: 60, marginBottom: 20, borderWidth: 1, borderColor: newPlan.item_id ? '#FF2D55' : 'rgba(150,150,150,0.2)' }]}><View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}><View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' }}>{newPlan.item_id ? (newPlan.type === 'recipe' ? <PieChart size={20} color="#FF2D55" /> : <Utensils size={20} color="#34C759" />) : <Search size={20} color={theme.text} opacity={0.3} />}</View><View style={{ marginLeft: 15 }}><Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>{(() => { if (!newPlan.item_id) return 'Search & Select...'; const item = newPlan.type === 'recipe' ? (allRecipes || []).find(r => r.id === newPlan.item_id) : (allIngredients || []).find(i => i.id === newPlan.item_id); return item?.name || 'Select Item'; })()}</Text>{newPlan.item_id ? <Text style={{ color: theme.text, fontSize: 10, opacity: 0.5, textTransform: 'uppercase', fontWeight: '800' }}>{newPlan.type}</Text> : null}</View></View><ChevronRight size={20} color={theme.text} opacity={0.3} /></TouchableOpacity>
                    <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20, zIndex: 10 }}><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Amt</Text><TextInput keyboardType="decimal-pad" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={(newPlan.quantity || 0).toString()} onChangeText={(v) => setNewPlan({...newPlan, quantity: parseFloat(v) || 0})} /></View><View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Unit</Text><TouchableOpacity onPress={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)} style={[styles.dropdownButton, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontWeight: '700' }}>{units.find(u => u.id === newPlan.unit)?.name || newPlan.unit || 'Select'}</Text><ChevronDown size={18} color={theme.text} /></TouchableOpacity>{isUnitDropdownOpen && (<View style={[styles.dropdownList, { backgroundColor: theme.card, top: 75 }]}><ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>{(units || []).map(u => (<TouchableOpacity key={u.id} onPress={() => { setNewPlan({...newPlan, unit: u.id}); setIsUnitDropdownOpen(false); }} style={styles.dropdownItem}><Text style={{ color: theme.text, fontWeight: newPlan.unit === u.id ? '800' : '400' }}>{u.name}</Text></TouchableOpacity>))}</ScrollView></View>)}</View></View>
                    <TouchableOpacity onPress={savePlanItem} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>{editingPlanId ? 'Update Item' : (newPlan.is_eaten === 1 ? 'Log Activity' : 'Add to Routine')}</Text></TouchableOpacity>
                  </ScrollView>
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={styles.modalHeader}><TouchableOpacity onPress={() => setIsPickerMode(false)} style={{ flexDirection: 'row', alignItems: 'center' }}><ChevronDown size={24} color={theme.text} style={{ transform: [{ rotate: '90deg' }] }} /><Text style={[styles.modalTitle, { color: theme.text, marginLeft: 10 }]}>Select Item</Text></TouchableOpacity><TouchableOpacity onPress={() => { setShowAdd(false); setIsPickerMode(false); setPickerSearch(''); }}><X size={24} color={theme.text} /></TouchableOpacity></View>
                  <View style={[styles.searchBar, { backgroundColor: theme.card, marginBottom: 20 }]}><Search size={18} color={theme.text} opacity={0.5} /><TextInput placeholder={`Search ${newPlan.type}...`} placeholderTextColor={theme.text + '80'} style={[styles.searchInput, { color: theme.text }]} value={pickerSearch} onChangeText={(t) => setPickerSearch(t)} autoFocus />{pickerSearch.length > 0 && <TouchableOpacity onPress={() => setPickerSearch('')}><X size={18} color={theme.text} opacity={0.5} /></TouchableOpacity>}</View>
                  <FlatList data={(newPlan.type === 'recipe' ? (allRecipes || []) : (allIngredients || [])).filter(i => (i.name || '').toLowerCase().includes((pickerSearch || '').toLowerCase()))} keyExtractor={item => item.id} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }} renderItem={({ item }) => (<TouchableOpacity onPress={() => { setNewPlan({...newPlan, item_id: item.id, unit: item.base_unit || 'serving'}); setIsPickerMode(false); setPickerSearch(''); }} style={[styles.itemCard, { backgroundColor: theme.card, borderWidth: newPlan.item_id === item.id ? 1 : 0, borderColor: '#FF2D55' }]}><View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(150,150,150,0.05)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>{newPlan.type === 'recipe' ? <PieChart size={16} color={theme.text} /> : <Utensils size={16} color={theme.text} />}</View><Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }}>{item.name}</Text></View><ChevronRight size={18} color={theme.text} opacity={0.3} /></TouchableOpacity>)} />
                </View>
              )}
           </View>
        </BlurView>
      </Modal>
    </View>
  );
});

// --- HELPER COMPONENTS ---
function RoutineItemCard({ plan, theme, userName, allRecipes, allIngredients, onToggle, onSkip, onEdit, onDelete, isFullCard }: any) {
  const item = plan.type === 'recipe' ? (allRecipes || []).find((r: any) => r.id === plan.item_id) : (allIngredients || []).find((i: any) => i.id === plan.item_id);
  const isShared = plan.is_shared === 1;
  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (translateX.value > 150) {
        runOnJS(onToggle)(plan);
        translateX.value = withTiming(SCREEN_WIDTH, { duration: 300 });
      } else if (translateX.value < -150) {
        runOnJS(onSkip)(plan);
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 300 });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const leftHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-120, -40], [1, 0], Extrapolate.CLAMP),
    transform: [{ scale: interpolate(translateX.value, [-150, -40], [1, 0.8], Extrapolate.CLAMP) }]
  }));

  const rightHintStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [40, 120], [0, 1], Extrapolate.CLAMP),
    transform: [{ scale: interpolate(translateX.value, [40, 150], [0.8, 1], Extrapolate.CLAMP) }]
  }));

  const animatedStyle = useAnimatedStyle(() => {
    const defaultBg = isShared ? 'rgba(175,82,222,0.08)' : 'rgba(255,45,85,0.08)';
    const defaultBorder = isShared ? 'rgba(175,82,222,0.2)' : 'rgba(255,45,85,0.2)';
    return {
      transform: [
        { translateX: translateX.value },
        { rotate: `${interpolate(translateX.value, [-SCREEN_WIDTH, SCREEN_WIDTH], [-10, 10])}deg` },
        { scale: interpolate(Math.abs(translateX.value), [0, 150], [1, 0.96], Extrapolate.CLAMP) }
      ],
      backgroundColor: interpolateColor(translateX.value, [-150, 0, 150], ['#FF3B30', defaultBg, '#34C759']),
      borderColor: interpolateColor(translateX.value, [-150, 0, 150], ['#FF3B30', defaultBorder, '#34C759'])
    };
  });

  if (isFullCard) {
    const accentColor = isShared ? '#AF52DE' : '#FF2D55';
    const accentBg = isShared ? 'rgba(175,82,222,0.1)' : 'rgba(255,45,85,0.1)';
    return (
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[{ flex: 1, borderRadius: 40, padding: 30, justifyContent: 'space-between', alignItems: 'center', borderWidth: 1.5, overflow: 'hidden' }, animatedStyle]}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', zIndex: 10, borderRadius: 40, overflow: 'hidden' }, leftHintStyle]}>
             <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255, 59, 48, 0.92)', justifyContent: 'center', alignItems: 'center' }]}>
                <X size={100} color="white" strokeWidth={3} />
                <Text style={{ color: 'white', fontSize: 36, fontWeight: '900', letterSpacing: 6, marginTop: 24 }}>SKIP IT</Text>
             </View>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center', zIndex: 10, borderRadius: 40, overflow: 'hidden' }, rightHintStyle]}>
             <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(52, 199, 89, 0.92)', justifyContent: 'center', alignItems: 'center' }]}>
                <CheckCircle2 size={100} color="white" strokeWidth={3} />
                <Text style={{ color: 'white', fontSize: 36, fontWeight: '900', letterSpacing: 6, marginTop: 24 }}>EATEN</Text>
             </View>
          </Animated.View>
          
          <View style={{ alignItems: 'center', width: '100%', flex: 1, justifyContent: 'center' }}>
            <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: accentBg, justifyContent: 'center', alignItems: 'center', marginBottom: 25, shadowColor: accentColor, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.15, shadowRadius: 20 }}>
               {plan.type === 'recipe' ? <PieChart size={48} color={accentColor} strokeWidth={2.5} /> : <Utensils size={48} color={accentColor} strokeWidth={2.5} />}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: accentColor, fontSize: 14, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 3, opacity: 0.8 }}>{plan.type}</Text>
              {plan.is_recurring === 0 && (
                <View style={{ backgroundColor: accentColor, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ color: 'white', fontSize: 8, fontWeight: '900' }}>ONE-TIME</Text>
                </View>
              )}
              {plan.is_eaten === 1 && (
                <View style={{ backgroundColor: '#34C759', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ color: 'white', fontSize: 8, fontWeight: '900' }}>CONSUMED</Text>
                </View>
              )}
            </View>
            <Text style={{ color: theme.text, fontSize: 32, fontWeight: '900', textAlign: 'center', lineHeight: 38, marginBottom: 25 }} numberOfLines={3}>{item?.name || 'Unknown Item'}</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 30 }}>
               <View style={{ backgroundColor: theme.card, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)' }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{plan.quantity} <Text style={{ fontSize: 12, opacity: 0.6 }}>{(plan.unit || '').toUpperCase()}</Text></Text>
               </View>
               <View style={{ backgroundColor: theme.card, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(150,150,150,0.1)' }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}><Clock size={14} color={theme.text} opacity={0.5} /> {plan.meal_time}</Text>
               </View>
            </View>
            {isShared === 1 ? (
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 20, backgroundColor: 'rgba(175,82,222,0.08)', borderRadius: 25 }}>
                  <Info size={16} color="#AF52DE" />
                  <Text style={{ color: '#AF52DE', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 }}>SHARED WITH PARTNER</Text>
               </View>
            ) : (
               <View style={{ paddingVertical: 12, paddingHorizontal: 20, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 25 }}>
                  <Text style={{ color: theme.text, fontSize: 12, fontWeight: '800', opacity: 0.4, letterSpacing: 1 }}>SWIPE TO TRACK PROGRESS</Text>
               </View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    );
  }
  return null;
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

// ==========================================
// 2. RECIPES TAB
// ==========================================
function RecipesTab({ theme, searchQuery, userName }: any) {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<any | null>(null);
  const [showDetails, setShowDetails] = useState<any | null>(null);
  const [newRecipe, setNewRecipe] = useState({ name: '', description: '', ingredients: [] as any[], base_quantity: 1, base_unit: 'serving', is_manual: false, nutrients: {} as any });
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const colorScheme = useColorScheme() ?? 'light';
  
  useEffect(() => { loadRecipes(); loadMetrics(); loadUnits(); }, []);
  const loadRecipes = () => setRecipes(db.getAllSync('SELECT * FROM recipes ORDER BY created_at DESC') || []);
  const loadMetrics = () => setMetrics(db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1') || []);
  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC') || []);
  
  const handleEdit = (recipe: any) => {
    const recipeIngs = db.getAllSync('SELECT ri.*, i.name, i.nutrients, i.base_quantity, i.base_unit FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [recipe.id]) as any[] || [];
    setNewRecipe({ name: recipe.name, description: recipe.description, base_quantity: recipe.base_quantity || 1, base_unit: recipe.base_unit || 'serving', is_manual: !!recipe.nutrients, nutrients: JSON.parse(recipe.nutrients || '{}'), ingredients: recipeIngs.map(ri => ({ ...ri, id: ri.ingredient_id, recipe_quantity: ri.quantity, recipe_unit: ri.unit })) });
    setEditingRecipeId(recipe.id); setShowOptions(null); setShowAdd(true);
  };

  const saveRecipe = () => {
    if (!newRecipe.name) return;
    const recipeId = editingRecipeId || generateUUID();
    db.withTransactionSync(() => {
      const payload = { id: recipeId, name: newRecipe.name, description: newRecipe.description, base_quantity: newRecipe.base_quantity, base_unit: newRecipe.base_unit, nutrients: newRecipe.is_manual ? JSON.stringify(newRecipe.nutrients) : null, user_id: userName, created_at: new Date().toISOString() };
      if (editingRecipeId) {
        db.runSync('UPDATE recipes SET name=?, description=?, base_quantity=?, base_unit=?, nutrients=? WHERE id=?', [payload.name, payload.description, payload.base_quantity, payload.base_unit, payload.nutrients, recipeId]);
        db.runSync('DELETE FROM recipe_ingredients WHERE recipe_id=?', [recipeId]);
      } else {
        db.runSync('INSERT INTO recipes (id, name, description, base_quantity, base_unit, nutrients, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [recipeId, newRecipe.name, newRecipe.description, payload.base_quantity, payload.base_unit, payload.nutrients, userName, payload.created_at]);
      }
    });
    setShowAdd(false); setEditingRecipeId(null); loadRecipes();
  };

  const calculateTotals = (ings: any[]) => {
    if (newRecipe.is_manual) return newRecipe.nutrients;
    const t: any = {}; (metrics || []).forEach(m => t[m.id] = 0);
    (ings || []).forEach(ing => { const nutrients = JSON.parse(ing.nutrients || '{}'); const ratio = (ing.recipe_quantity || 0) / (ing.base_quantity || 1); metrics.forEach(m => t[m.id] += (nutrients[m.id] || 0) * ratio); });
    return t;
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Recipes</Text><TouchableOpacity onPress={() => { setEditingRecipeId(null); setShowAdd(true); }} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {(recipes || []).filter(r => (r.name || '').toLowerCase().includes((searchQuery || '').toLowerCase())).map(r => (
        <TouchableOpacity key={r.id} onPress={() => setShowDetails(r)} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowOptions(r); }} delayLongPress={500} activeOpacity={0.7} style={[styles.itemCard, { backgroundColor: theme.card }]}>
          <View><Text style={[styles.itemName, { color: theme.text }]}>{r.name}</Text><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ color: theme.text, opacity: 0.6, fontSize: 11 }}>Yield: {r.base_quantity} {r.base_unit}</Text></View></View><ChevronRight size={20} color={theme.text} opacity={0.5} />
        </TouchableOpacity>
      ))}
      <Modal visible={!!showOptions} transparent animationType="fade"><TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptions(null)}><BlurView intensity={20} tint={colorScheme} style={StyleSheet.absoluteFill} /><View style={[styles.optionsMenu, { backgroundColor: theme.background }]}>
          <Text style={[styles.optionsTitle, { color: theme.text }]}>{showOptions?.name}</Text>
          <TouchableOpacity onPress={() => handleEdit(showOptions)} style={styles.optionBtn}><Edit2 size={20} color={theme.text} /><Text style={[styles.optionText, { color: theme.text }]}>Edit Entry</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { Alert.alert('Delete Recipe?', 'This will remove the recipe.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { db.runSync('DELETE FROM recipes WHERE id = ?', [showOptions.id]); loadRecipes(); setShowOptions(null); } }]); }} style={styles.optionBtn}><Trash2 size={20} color="#FF3B30" /><Text style={[styles.optionText, { color: '#FF3B30' }]}>Delete Entry</Text></TouchableOpacity>
        </View></TouchableOpacity></Modal>
      <Modal visible={!!showDetails} animationType="slide" transparent><BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}><View style={[styles.modalContent, { backgroundColor: theme.background, maxHeight: '90%' }]}><View style={[styles.modalHeader, { borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)', paddingBottom: 15 }]}><Text style={[styles.modalTitle, { color: theme.text }]}>Item Details</Text><TouchableOpacity onPress={() => setShowDetails(null)}><X size={24} color={theme.text} /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false}><Text style={{ fontSize: 28, fontWeight: '900', color: theme.text, marginBottom: 5 }}>{showDetails?.name}</Text><View style={[styles.glassCard, { backgroundColor: '#FF2D55', marginBottom: 25 }]}><Text style={{ color: 'white', fontWeight: '800', marginBottom: 15 }}>NUTRIENT BREAKDOWN</Text><View style={styles.nutrientGrid}>{(metrics || []).map(m => { let total = 0; if (showDetails?.nutrients) { total = JSON.parse(showDetails.nutrients)[m.id] || 0; } else { const ings = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [showDetails?.id]) as any[] || []; total = calculateTotals(ings.map(i => ({...i, recipe_quantity: i.quantity})))[m.id]; } return <NutrientItem key={m.id} label={m.name} value={total?.toFixed(1)} unit={m.unit} color="white" /> })}</View></View></ScrollView></View></BlurView></Modal>
      <Modal visible={showAdd} animationType="slide" transparent><BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}><View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingRecipeId ? 'Edit' : 'Create'} Entry</Text><TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false}><TextInput placeholder="Item Name" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newRecipe.name} onChangeText={t => setNewRecipe({...newRecipe, name: t})} /><View style={[styles.segmentedContainer, { marginBottom: 25 }]}><TouchableOpacity onPress={() => setNewRecipe({...newRecipe, is_manual: false})} style={[styles.segmentButton, !newRecipe.is_manual && [styles.segmentActive, { backgroundColor: theme.card }]]}><Utensils size={14} color={!newRecipe.is_manual ? '#FF2D55' : theme.text} /><Text style={[styles.segmentText, { color: theme.text }]}>INGREDIENTS</Text></TouchableOpacity><TouchableOpacity onPress={() => setNewRecipe({...newRecipe, is_manual: true})} style={[styles.segmentButton, newRecipe.is_manual && [styles.segmentActive, { backgroundColor: theme.card }]]}><Save size={14} color={newRecipe.is_manual ? '#FF2D55' : theme.text} /><Text style={[styles.segmentText, { color: theme.text }]}>QUICK LOG</Text></TouchableOpacity></View><TouchableOpacity onPress={saveRecipe} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Entry</Text></TouchableOpacity></ScrollView></View></BlurView></Modal>
    </Animated.View>
  );
}

// ==========================================
// 3. INGREDIENTS TAB
// ==========================================
function IngredientsTab({ theme, searchQuery, userName }: any) {
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingIngId, setEditingIngId] = useState<string | null>(null);
  const [newIng, setNewIng] = useState({ name: '', category: 'General', nutrients: {} as any, base_quantity: 100, base_unit: 'g' });
  const colorScheme = useColorScheme() ?? 'light';
  
  useEffect(() => { loadIngredients(); }, []);
  const loadIngredients = () => setIngredients(db.getAllSync('SELECT * FROM ingredients ORDER BY name ASC') || []);
  
  const saveIngredient = () => {
    if (!newIng.name) return;
    const id = editingIngId || generateUUID();
    const payload = { id, name: newIng.name, category: newIng.category, nutrients: JSON.stringify(newIng.nutrients), base_quantity: newIng.base_quantity, base_unit: newIng.base_unit, user_id: userName, created_at: new Date().toISOString() };
    if (editingIngId) db.runSync('UPDATE ingredients SET name=?, category=?, nutrients=?, base_quantity=?, base_unit=? WHERE id=?', [payload.name, payload.category, payload.nutrients, payload.base_quantity, payload.base_unit, id]);
    else db.runSync('INSERT INTO ingredients (id, name, category, nutrients, base_quantity, base_unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [payload.id, payload.name, payload.category, payload.nutrients, payload.base_quantity, payload.base_unit, payload.user_id, payload.created_at]);
    setShowAdd(false); setEditingIngId(null); loadIngredients();
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Library</Text><TouchableOpacity onPress={() => { setEditingIngId(null); setShowAdd(true); }} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {(ingredients || []).filter(i => (i.name || '').toLowerCase().includes((searchQuery || '').toLowerCase())).map(ing => (
        <View key={ing.id} style={[styles.itemCard, { backgroundColor: theme.card, flexDirection: 'column', alignItems: 'flex-start' }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}><View><Text style={[styles.itemName, { color: theme.text, fontWeight: 'bold' }]}>{ing.name}</Text></View><Text style={{ color: '#FF2D55', fontSize: 12 }}>{ing.category}</Text></View>
        </View>
      ))}
      <Modal visible={showAdd} animationType="slide" transparent><BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}><View style={[styles.modalContent, { backgroundColor: theme.background, marginTop: 60 }]}><View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingIngId ? 'Edit' : 'Add'} Ingredient</Text><TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false}><TextInput placeholder="Ingredient Name" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newIng.name} onChangeText={t => setNewIng({...newIng, name: t})} /><TouchableOpacity onPress={saveIngredient} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Ingredient</Text></TouchableOpacity></ScrollView></View></BlurView></Modal>
    </Animated.View>
  );
}

// ==========================================
// 4. DIET REPORT TAB
// ==========================================
function DietReportTab({ theme, userName }: any) {
  const [filter, setFilter] = useState<FilterType>('week');
  const [reportData, setReportData] = useState<any>({ dates: [], me: [], partner: [] });

  useEffect(() => {
    const dates: string[] = [];
    const meData: number[] = [];
    const partnerData: number[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = subDays(new Date(), i);
      dates.push(format(d, 'MMM dd'));
      meData.push(Math.random() * 2000); 
      partnerData.push(Math.random() * 1800);
    }
    setReportData({ dates, me: meData, partner: partnerData });
  }, [filter]);

  const chartOptions = {
    chart: { type: 'areaspline', backgroundColor: 'transparent', height: 250 },
    xAxis: { categories: reportData.dates, labels: { style: { color: theme.text } } },
    series: [
      { name: 'My Intake', data: reportData.me, color: '#FF2D55' },
      { name: 'Partner Intake', data: reportData.partner, color: '#5AC8FA' }
    ],
    credits: { enabled: false }
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={[styles.glassCard, { backgroundColor: theme.card, marginBottom: 20 }]}>
        <HighchartsChart options={chartOptions} height={250} />
      </View>
    </Animated.View>
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
  glassCard: { borderRadius: 24, padding: 0, overflow: 'hidden' },
  glassCardFront: { borderRadius: 24, padding: 20, overflow: 'hidden' },
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
  inputLabel: { fontSize: 12, fontWeight: '900', marginBottom: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 1 },
  saveButton: { backgroundColor: '#FF2D55', flexDirection: 'row', padding: 16, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  saveButtonText: { color: 'white', fontWeight: '800', marginLeft: 10, fontSize: 16 },
  segmentedContainer: { flexDirection: 'row', backgroundColor: 'rgba(150,150,150,0.1)', borderRadius: 14, padding: 2, marginBottom: 15, gap: 2 },
  segmentButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, gap: 6 },
  segmentActive: { backgroundColor: 'white', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  segmentText: { fontSize: 11, fontWeight: '700' },
  dayCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(150,150,150,0.1)', justifyContent: 'center', alignItems: 'center' },
  smallHeaderButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, gap: 4 },
  sliderHandle: { width: 10, height: 60, borderRadius: 5, marginTop: 0 },
  sliderTrack: { width: 30, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-start' },
  optionsMenu: { position: 'absolute', bottom: 40, left: 20, right: 20, borderRadius: 24, padding: 20, elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  optionsTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  optionBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, backgroundColor: 'rgba(150,150,150,0.05)' },
  optionText: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
  smallTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(150,150,150,0.1)' },
  dropdownButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12 },
  dropdownList: { position: 'absolute', left: 0, right: 0, borderRadius: 12, elevation: 5, zIndex: 100 },
  dropdownItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(150,150,150,0.1)' },
});
