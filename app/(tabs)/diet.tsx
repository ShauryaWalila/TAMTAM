import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, Modal, FlatList, Alert, Dimensions } from 'react-native';
import { Stack } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Plus, Search, ChevronRight, ChevronDown, Trash2, Edit2, Save, X, Utensils, TrendingUp, Calendar } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import * as SecureStore from 'expo-secure-store';
import HighchartsChart from '@/components/HighchartsChart';
import * as Haptics from 'expo-haptics';

type TabType = 'PLAN' | 'RECIPES' | 'INGREDIENTS' | 'REPORT';
type FilterType = 'week' | 'month' | '3months' | '6months' | 'year' | 'overall';

export default function DietScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const [activeTab, setActiveTab] = useState<TabType>('PLAN');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [userName, setUserName] = useState('');

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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: 'Diet Plan', headerShown: false }} />
      
      <View style={[styles.header, { borderBottomColor: theme.card }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>TAMTAM DIET</Text>
        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity onPress={() => {
            setIsSearchVisible(!isSearchVisible);
            if (isSearchVisible) setSearchQuery('');
          }}>
            {isSearchVisible ? <X size={24} color={theme.text} /> : <Search size={24} color={theme.text} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('REPORT')}>
            <TrendingUp size={24} color={activeTab === 'REPORT' ? '#FF2D55' : theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {isSearchVisible && (
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
        {activeTab === 'PLAN' && <DietPlanTab theme={theme} searchQuery={searchQuery} userName={userName} />}
        {activeTab === 'RECIPES' && <RecipesTab theme={theme} searchQuery={searchQuery} userName={userName} />}
        {activeTab === 'INGREDIENTS' && <IngredientsTab theme={theme} searchQuery={searchQuery} userName={userName} />}
        {activeTab === 'REPORT' && <DietReportTab theme={theme} userName={userName} />}
      </ScrollView>
    </View>
  );
}

// ==========================================
// 1. DIET PLAN TAB (ROUTINE POPUP RESTORED)
// ==========================================
function DietPlanTab({ theme, searchQuery, userName }: any) {
  const [plans, setPlans] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({ me: {}, them: {} });
  const colorScheme = useColorScheme() ?? 'light';

  const [newPlan, setNewPlan] = useState({ meal_time: 'Breakfast', type: 'recipe' as 'recipe' | 'ingredient', item_id: '', quantity: 100, unit: 'serving' });

  useEffect(() => {
    if (userName) {
      loadLibrary(); loadMetrics(); loadUnits(); loadPlans();
    }
  }, [userName]);

  const loadPlans = () => {
    const today = new Date().toISOString().split('T')[0];
    const data = db.getAllSync('SELECT * FROM diet_plans WHERE date = ?', [today]);
    setPlans(data);
    calculateDailyTotals(data);
  };

  const loadLibrary = () => {
    setAllRecipes(db.getAllSync('SELECT * FROM recipes'));
    setAllIngredients(db.getAllSync('SELECT * FROM ingredients'));
  };

  const loadMetrics = () => setMetrics(db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1'));
  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));

  const calculateDailyTotals = (currentPlans: any[]) => {
    const dailyTotals: any = { me: {}, them: {} };
    metrics.forEach(m => { dailyTotals.me[m.id] = 0; dailyTotals.them[m.id] = 0; });
    currentPlans.forEach(plan => {
      const isMe = plan.user_id === userName;
      const target = isMe ? dailyTotals.me : dailyTotals.them;
      if (plan.type === 'ingredient') {
        const ing = db.getFirstSync('SELECT * FROM ingredients WHERE id = ?', [plan.item_id]) as any;
        if (ing) {
          const nutrients = JSON.parse(ing.nutrients || '{}');
          const ratio = plan.quantity / ing.base_quantity;
          metrics.forEach(m => target[m.id] += (nutrients[m.id] || 0) * ratio);
        }
      } else {
        const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [plan.item_id]) as any[];
        recipeIngs.forEach(ri => {
          const nutrients = JSON.parse(ri.nutrients || '{}');
          const ratio = ri.quantity / ri.base_quantity;
          metrics.forEach(m => target[m.id] += (nutrients[m.id] || 0) * ratio);
        });
      }
    });
    setTotals(dailyTotals);
  };

  const savePlanItem = () => {
    if (!newPlan.item_id) return;
    const id = generateUUID();
    const today = new Date().toISOString().split('T')[0];
    const payload = { id, date: today, meal_time: newPlan.meal_time, type: newPlan.type, item_id: newPlan.item_id, quantity: newPlan.quantity, unit: newPlan.unit, user_id: userName, created_at: new Date().toISOString() };
    db.runSync('INSERT INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [payload.id, payload.date, payload.meal_time, payload.type, payload.item_id, payload.quantity, payload.unit, payload.user_id, payload.created_at]);
    queueSyncOperation('diet_plans', id, 'INSERT', payload);
    setShowAdd(false); loadPlans();
  };

  const deletePlanItem = (id: string) => {
    db.runSync('DELETE FROM diet_plans WHERE id = ?', [id]);
    queueSyncOperation('diet_plans', id, 'DELETE', { id });
    loadPlans();
  };

  const chartOptions = {
    chart: { type: 'column', backgroundColor: 'transparent' },
    title: { text: '' },
    xAxis: { categories: ['Calories', 'Protein'], labels: { style: { color: theme.text } } },
    yAxis: { title: { text: '' }, gridLineColor: theme.card, labels: { style: { color: theme.text } } },
    legend: { itemStyle: { color: theme.text } },
    credits: { enabled: false },
    series: [
      { name: 'Me', data: [totals.me['m1'] || 0, totals.me['m2'] || 0], color: '#FF2D55' },
      { name: 'Partner', data: [totals.them['m1'] || 0, totals.them['m2'] || 0], color: '#5AC8FA' }
    ]
  };

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.summaryCard}>
        <BlurView intensity={80} style={[styles.glassCard, { backgroundColor: 'rgba(255,45,85,0.1)' }]}>
          <Text style={[styles.cardTitle, { color: '#FF2D55' }]}>Daily Summary</Text>
          <HighchartsChart height={200} options={chartOptions} />
          <View style={styles.nutrientGrid}>
             {metrics.map(m => (<NutrientItem key={m.id} label={m.name} value={totals.me[m.id]?.toFixed(0) || '0'} unit={m.unit} color={m.id === 'm1' ? '#FF2D55' : theme.text} />))}
          </View>
        </BlurView>
      </View>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Today's Routine</Text><TouchableOpacity onPress={() => setShowAdd(true)} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {plans.filter(p => {
        const item = p.type === 'recipe' ? allRecipes.find(r => r.id === p.item_id) : allIngredients.find(i => i.id === p.item_id);
        return (item?.name || '').toLowerCase().includes(searchQuery.toLowerCase());
      }).map(plan => {
        const item = plan.type === 'recipe' ? allRecipes.find(r => r.id === plan.item_id) : allIngredients.find(i => i.id === plan.item_id);
        const isMe = plan.user_id === userName;
        return (
          <View key={plan.id} style={[styles.itemCard, { backgroundColor: theme.card, borderLeftWidth: 4, borderLeftColor: isMe ? '#FF2D55' : '#5AC8FA' }]}>
            <View><Text style={[styles.itemTime, { color: isMe ? '#FF2D55' : '#5AC8FA' }]}>{plan.meal_time} {!isMe && '(Partner)'}</Text><Text style={[styles.itemName, { color: theme.text }]}>{item?.name}</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
               <Text style={[styles.itemValue, { color: theme.text, marginRight: 15 }]}>{plan.quantity} {plan.unit}</Text>
               {isMe && <TouchableOpacity onPress={() => deletePlanItem(plan.id)}><Trash2 size={16} color="#FF2D55" opacity={0.5} /></TouchableOpacity>}
            </View>
          </View>
        );
      })}
      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
              <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Add Meal</Text><TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <Text style={[styles.inputLabel, { color: theme.text }]}>Meal Time</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                {['Breakfast', 'Lunch', 'Dinner', 'Snack'].map(t => (
                  <TouchableOpacity key={t} onPress={() => setNewPlan({...newPlan, meal_time: t})} style={[styles.tabButton, newPlan.meal_time === t && { backgroundColor: '#FF2D55' }]}><Text style={{ color: newPlan.meal_time === t ? 'white' : theme.text }}>{t}</Text></TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.inputLabel, { color: theme.text }]}>Type</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                {['recipe', 'ingredient'].map(t => (
                  <TouchableOpacity key={t} onPress={() => setNewPlan({...newPlan, type: t as any, item_id: ''})} style={[styles.tabButton, newPlan.type === t && { backgroundColor: '#FF2D55' }]}><Text style={{ color: newPlan.type === t ? 'white' : theme.text }}>{t.toUpperCase()}</Text></TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.inputLabel, { color: theme.text }]}>Select {newPlan.type}</Text>
              <ScrollView style={{ maxHeight: 200, marginBottom: 20 }}>
                {(newPlan.type === 'recipe' ? allRecipes : allIngredients).map(item => (
                  <TouchableOpacity key={item.id} onPress={() => setNewPlan({...newPlan, item_id: item.id})} style={[styles.itemCard, { backgroundColor: theme.card, borderWidth: newPlan.item_id === item.id ? 1 : 0, borderColor: '#FF2D55' }]}><Text style={{ color: theme.text }}>{item.name}</Text></TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20 }}>
                <View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Qty</Text><TextInput keyboardType="numeric" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newPlan.quantity.toString()} onChangeText={(v) => setNewPlan({...newPlan, quantity: parseFloat(v) || 0})} /></View>
                <View style={{ flex: 1 }}><Text style={[styles.inputLabel, { color: theme.text }]}>Unit</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{units.map(u => (
                  <TouchableOpacity key={u.id} onPress={() => setNewPlan({...newPlan, unit: u.id})} style={[styles.smallTab, newPlan.unit === u.id && { backgroundColor: '#FF2D55' }]}><Text style={{ color: newPlan.unit === u.id ? 'white' : theme.text }}>{u.name}</Text></TouchableOpacity>
                ))}</ScrollView></View>
              </View>
              <TouchableOpacity onPress={savePlanItem} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Add to Plan</Text></TouchableOpacity>
           </View>
        </BlurView>
      </Modal>
    </Animated.View>
  );
}

// ==========================================
// 2. RECIPES TAB (BUILDER POPUP RESTORED)
// ==========================================
function RecipesTab({ theme, searchQuery, userName }: any) {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState<any | null>(null);
  const [newRecipe, setNewRecipe] = useState({ name: '', description: '', ingredients: [] as any[] });
  const [allIngredients, setAllIngredients] = useState<any[]>([]);
  const [ingSearch, setIngSearch] = useState('');
  const [metrics, setMetrics] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const colorScheme = useColorScheme() ?? 'light';

  useEffect(() => { loadRecipes(); loadIngredients(); loadMetrics(); loadUnits(); }, []);
  const loadRecipes = () => setRecipes(db.getAllSync('SELECT * FROM recipes ORDER BY created_at DESC'));
  const loadIngredients = () => setAllIngredients(db.getAllSync('SELECT * FROM ingredients ORDER BY name ASC'));
  const loadMetrics = () => setMetrics(db.getAllSync('SELECT * FROM diet_metrics WHERE is_active = 1'));
  const loadUnits = () => setUnits(db.getAllSync('SELECT * FROM diet_units ORDER BY name ASC'));

  const handleEdit = (recipe: any) => {
    const recipeIngs = db.getAllSync('SELECT ri.*, i.name, i.nutrients, i.base_quantity, i.base_unit FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [recipe.id]) as any[];
    setNewRecipe({ name: recipe.name, description: recipe.description, ingredients: recipeIngs.map(ri => ({ ...ri, id: ri.ingredient_id, recipe_quantity: ri.quantity, recipe_unit: ri.unit })) });
    setEditingRecipeId(recipe.id); setShowOptions(null); setShowAdd(true);
  };

  const handleDelete = (recipeId: string) => {
    Alert.alert('Delete Recipe?', 'This will permanently remove this recipe.', [
      { text: 'Cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        db.withTransactionSync(() => { db.runSync('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]); db.runSync('DELETE FROM recipes WHERE id = ?', [recipeId]); });
        queueSyncOperation('recipes', recipeId, 'DELETE', { id: recipeId });
        loadRecipes(); setShowOptions(null);
      }}
    ]);
  };

  const saveRecipe = () => {
    if (!newRecipe.name) return;
    const recipeId = editingRecipeId || generateUUID();
    db.withTransactionSync(() => {
      const payload = { id: recipeId, name: newRecipe.name, description: newRecipe.description, user_id: userName, created_at: new Date().toISOString() };
      if (editingRecipeId) {
        db.runSync('UPDATE recipes SET name=?, description=? WHERE id=?', [payload.name, payload.description, recipeId]);
        db.runSync('DELETE FROM recipe_ingredients WHERE recipe_id=?', [recipeId]);
        queueSyncOperation('recipes', recipeId, 'UPDATE', payload);
      } else {
        db.runSync('INSERT INTO recipes (id, name, description, user_id, created_at) VALUES (?, ?, ?, ?, ?)', [recipeId, newRecipe.name, newRecipe.description, userName, payload.created_at]);
        queueSyncOperation('recipes', recipeId, 'INSERT', payload);
      }
      newRecipe.ingredients.forEach(ing => {
        const riId = generateUUID();
        db.runSync('INSERT INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?, ?)', [riId, recipeId, ing.id, ing.recipe_quantity, ing.recipe_unit]);
        queueSyncOperation('recipe_ingredients', riId, 'INSERT', { id: riId, recipe_id: recipeId, ingredient_id: ing.id, quantity: ing.recipe_quantity, unit: ing.recipe_unit });
      });
    });
    setShowAdd(false); setEditingRecipeId(null); setNewRecipe({ name: '', description: '', ingredients: [] }); loadRecipes();
  };

  const totals = (() => {
    const t: any = {}; metrics.forEach(m => t[m.id] = 0);
    newRecipe.ingredients.forEach(ing => {
      const nutrients = JSON.parse(ing.nutrients || '{}');
      const ratio = (ing.recipe_quantity || 0) / (ing.base_quantity || 100);
      metrics.forEach(m => t[m.id] += (nutrients[m.id] || 0) * ratio);
    });
    return t;
  })();

  return (
    <Animated.View entering={FadeInDown} style={styles.tabView}>
      <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: theme.text }]}>Shared Recipes</Text><TouchableOpacity onPress={() => { setEditingRecipeId(null); setShowAdd(true); }} style={styles.addButton}><Plus size={20} color="white" /></TouchableOpacity></View>
      {recipes.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase())).map(r => (
        <TouchableOpacity key={r.id} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setShowOptions(r); }} delayLongPress={500} activeOpacity={0.7} style={[styles.itemCard, { backgroundColor: theme.card }]}>
          <View><Text style={[styles.itemName, { color: theme.text }]}>{r.name}</Text><Text style={{ color: theme.text, opacity: 0.6, fontSize: 12 }}>{r.description}</Text></View>
          <ChevronRight size={20} color={theme.text} opacity={0.5} />
        </TouchableOpacity>
      ))}

      <Modal visible={!!showOptions} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowOptions(null)}>
          <BlurView intensity={20} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <View style={[styles.optionsMenu, { backgroundColor: theme.background }]}>
            <Text style={[styles.optionsTitle, { color: theme.text }]}>{showOptions?.name}</Text>
            <TouchableOpacity onPress={() => handleEdit(showOptions)} style={styles.optionBtn}>
              <Edit2 size={20} color={theme.text} /><Text style={[styles.optionText, { color: theme.text }]}>Edit Recipe</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(showOptions?.id)} style={styles.optionBtn}>
              <Trash2 size={20} color="#FF3B30" /><Text style={[styles.optionText, { color: '#FF3B30' }]}>Delete Recipe</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showAdd} animationType="slide" transparent>
        <BlurView intensity={100} tint={colorScheme} style={styles.modalOverlay}>
           <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
              <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Recipe Builder</Text><TouchableOpacity onPress={() => setShowAdd(false)}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <TextInput placeholder="Recipe Name" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newRecipe.name} onChangeText={t => setNewRecipe({...newRecipe, name: t})} />
                <View style={[styles.miniNutrientGrid, { marginBottom: 20, backgroundColor: theme.card, padding: 15, borderRadius: 16 }]}>
                   {metrics.map(m => (<View key={m.id} style={{ width: '33%', marginBottom: 10 }}><Text style={{ color: '#FF2D55', fontSize: 10, fontWeight: 'bold' }}>{m.name.toUpperCase()}</Text><Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>{totals[m.id]?.toFixed(1)}{m.unit}</Text></View>))}
                </View>
                <Text style={[styles.inputLabel, { color: theme.text }]}>Ingredients</Text>
                {newRecipe.ingredients.map((ing, idx) => (
                  <View key={idx} style={[styles.itemCard, { backgroundColor: theme.card, marginBottom: 5, flexDirection: 'column', alignItems: 'flex-start' }]}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 10 }}><Text style={{ color: theme.text, fontWeight: 'bold' }}>{ing.name}</Text><TouchableOpacity onPress={() => { const ings = [...newRecipe.ingredients]; ings.splice(idx, 1); setNewRecipe({...newRecipe, ingredients: ings}); }}><Trash2 size={16} color="#FF2D55" /></TouchableOpacity></View>
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><TextInput keyboardType="numeric" style={[styles.smallInput, { color: theme.text, borderColor: 'rgba(150,150,150,0.2)', width: 80 }]} value={ing.recipe_quantity.toString()} onChangeText={(v) => { const ings = [...newRecipe.ingredients]; ings[idx].recipe_quantity = parseFloat(v) || 0; setNewRecipe({...newRecipe, ingredients: ings}); }} /><ScrollView horizontal showsHorizontalScrollIndicator={false}>{units.map(u => (<TouchableOpacity key={u.id} onPress={() => { const ings = [...newRecipe.ingredients]; ings[idx].recipe_unit = u.id; setNewRecipe({...newRecipe, ingredients: ings}); }} style={[styles.smallTab, ing.recipe_unit === u.id && { backgroundColor: '#FF2D55' }]}><Text style={{ fontSize: 10, color: ing.recipe_unit === u.id ? 'white' : theme.text }}>{u.name}</Text></TouchableOpacity>))}</ScrollView></View>
                  </View>
                ))}
                <Text style={[styles.inputLabel, { color: theme.text, marginTop: 20 }]}>Add from Library</Text>
                <View style={[styles.searchBar, { backgroundColor: theme.card, marginBottom: 15 }]}>
                  <Search size={16} color={theme.text} opacity={0.5} />
                  <TextInput placeholder="Search library..." style={{ flex: 1, color: theme.text, fontSize: 14 }} value={ingSearch} onChangeText={setIngSearch} />
                </View>
                <View style={{ maxHeight: 200, backgroundColor: 'rgba(150,150,150,0.05)', borderRadius: 16, padding: 10 }}>
                  <ScrollView nestedScrollEnabled>{allIngredients.filter(i => i.name.toLowerCase().includes(ingSearch.toLowerCase())).map(ing => (
                    <TouchableOpacity key={ing.id} onPress={() => { setNewRecipe({ ...newRecipe, ingredients: [...newRecipe.ingredients, { ...ing, recipe_quantity: 100, recipe_unit: ing.base_unit }] }); setIngSearch(''); }} style={[styles.itemCard, { backgroundColor: theme.card, marginBottom: 5 }]}><Text style={{ color: theme.text }}>{ing.name}</Text><Plus size={16} color="#FF2D55" /></TouchableOpacity>
                  ))}</ScrollView>
                </View>
                <TouchableOpacity onPress={saveRecipe} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Recipe</Text></TouchableOpacity>
              </ScrollView>
           </View>
        </BlurView>
      </Modal>
    </Animated.View>
  );
}

// ==========================================
// 3. INGREDIENTS TAB (RESTORED POPUP)
// ==========================================
function IngredientsTab({ theme, searchQuery, userName }: any) {
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
      n[metricId] = Math.max(0, (parseFloat(n[metricId]) || 0) + amount);
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
        db.runSync('DELETE FROM ingredients WHERE id = ?', [ingId]);
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
    else db.runSync('INSERT INTO ingredients (id, name, category, nutrients, base_quantity, base_unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, newIng.name, newIng.category, JSON.stringify(newIng.nutrients), newIng.base_quantity, newIng.base_unit, userName, payload.created_at]);
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
           <View style={[styles.modalContent, { backgroundColor: theme.background }]}>
              <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editingIngId ? 'Edit' : 'Add'} Ingredient</Text><TouchableOpacity onPress={() => { setShowAdd(false); setEditingIngId(null); }}><X size={24} color={theme.text} /></TouchableOpacity></View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <TextInput placeholder="Ingredient Name" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newIng.name} onChangeText={t => setNewIng({...newIng, name: t})} />
                
                <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Base Qty</Text>
                    <TextInput keyboardType="numeric" style={[styles.input, { color: theme.text, borderColor: theme.card }]} value={newIng.base_quantity.toString()} onChangeText={v => setNewIng({...newIng, base_quantity: parseFloat(v) || 0})} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Base Unit</Text>
                    <TouchableOpacity onPress={() => setIsUnitDropdownOpen(!isUnitDropdownOpen)} style={[styles.dropdownButton, { backgroundColor: theme.card }]}>
                      <Text style={{ color: theme.text, fontWeight: '700' }}>{units.find(u => u.id === newIng.base_unit)?.name || 'Select'}</Text>
                      <ChevronDown size={18} color={theme.text} />
                    </TouchableOpacity>
                    {isUnitDropdownOpen && (
                      <View style={[styles.dropdownList, { backgroundColor: theme.card }]}>
                        <ScrollView style={{ maxHeight: 150 }}>
                          {units.map(u => (
                            <TouchableOpacity key={u.id} onPress={() => { setNewIng({...newIng, base_unit: u.id}); setIsUnitDropdownOpen(false); }} style={styles.dropdownItem}>
                              <Text style={{ color: theme.text, fontWeight: newIng.base_unit === u.id ? '800' : '400' }}>{u.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
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
                          <TextInput keyboardType="numeric" style={[styles.smallInput, { color: theme.text, borderColor: 'transparent', width: 60 }]} value={String((newIng.nutrients as any)[m.id] || 0)} onChangeText={v => { const n = {...newIng.nutrients}; (n as any)[m.id] = parseFloat(v) || 0; setNewIng({...newIng, nutrients: n}); }} />
                          <TouchableOpacity onPressIn={() => handlePressIn(m.id, 1)} onPressOut={handlePressOut} style={[styles.stepperBtn, { backgroundColor: theme.card }]}><Text style={{ color: theme.text, fontSize: 18, fontWeight: 'bold' }}>+</Text></TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                </View>
                <TouchableOpacity onPress={saveIngredient} style={styles.saveButton}><Save size={20} color="white" /><Text style={styles.saveButtonText}>Save Ingredient</Text></TouchableOpacity>
                <View style={{ height: 100 }} />
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

    const data = db.getAllSync('SELECT * FROM diet_plans WHERE date >= ? ORDER BY date ASC', [startDate.toISOString().split('T')[0]]) as any[];
    const categories: string[] = []; const meData: number[] = []; const themData: number[] = [];
    const grouped: any = {};
    data.forEach(p => {
      if (!grouped[p.date]) grouped[p.date] = { me: 0, them: 0 };
      const isMe = p.user_id === userName;
      let cals = 0;
      if (p.type === 'ingredient') {
        const ing = db.getFirstSync('SELECT nutrients, base_quantity FROM ingredients WHERE id = ?', [p.item_id]) as any;
        if (ing) cals = (JSON.parse(ing.nutrients || '{}')['m1'] || 0) * (p.quantity / ing.base_quantity);
      } else {
        const recipeIngs = db.getAllSync('SELECT ri.quantity, i.nutrients, i.base_quantity FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.recipe_id = ?', [p.item_id]) as any[];
        recipeIngs.forEach(ri => cals += (JSON.parse(ri.nutrients || '{}')['m1'] || 0) * (ri.quantity / ri.base_quantity));
      }
      if (isMe) grouped[p.date].me += cals; else grouped[p.date].them += cals;
    });

    Object.keys(grouped).sort().forEach(date => { categories.push(date.split('-').slice(1).join('/')); meData.push(grouped[date].me); themData.push(grouped[date].them); });
    setChartOptions({ chart: { type: 'area', backgroundColor: 'transparent' }, title: { text: '' }, xAxis: { categories, labels: { style: { color: theme.text } } }, yAxis: { title: { text: 'Calories' }, gridLineColor: theme.card, labels: { style: { color: theme.text } } }, legend: { itemStyle: { color: theme.text } }, credits: { enabled: false }, series: [{ name: 'Me', data: meData, color: '#FF2D55' }, { name: 'Partner', data: themData, color: '#5AC8FA' }] });
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
    </Animated.View>
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
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, minHeight: '85%' },
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
  filterContainer: { paddingHorizontal: 0, marginTop: 5 },
  optionsMenu: { position: 'absolute', bottom: 40, left: 20, right: 20, borderRadius: 24, padding: 20, elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  optionsTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, textAlign: 'center' },
  optionBtn: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, marginBottom: 10, backgroundColor: 'rgba(150,150,150,0.05)' },
  optionText: { fontSize: 16, fontWeight: '700', marginLeft: 12 },
});
