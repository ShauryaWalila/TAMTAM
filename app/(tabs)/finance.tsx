import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, ActivityIndicator, Alert, TouchableOpacity, TextInput, DeviceEventEmitter } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView, AnimatePresence } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Wallet, Plus, X, Trash2, ArrowDownCircle, ArrowUpCircle, Filter, PieChart as PieChartIcon, Landmark, ReceiptText, Users, User, Target, ChevronRight, TrendingUp, Heart, Calendar, Clock, RotateCcw, Download } from 'lucide-react-native';
import { format, addDays, addWeeks, addMonths, isAfter, isBefore, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation } from '@/lib/db';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import { BarChart } from "react-native-gifted-charts";
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface Transaction {
  id: string;
  created_at: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  description: string;
  user_id: string;
}

interface SavingTarget {
  id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  type: 'budget' | 'savings';
  period: 'weekly' | 'monthly' | 'custom';
  start_date: string;
  end_date: string;
  category: string;
}

const CATEGORIES = [
  { id: 'Food', icon: '🍲', color: '#FF9500' },
  { id: 'Travel', icon: '✈️', color: '#007AFF' },
  { id: 'Shopping', icon: '🛍️', color: '#AF52DE' },
  { id: 'Utilities', icon: '💡', color: '#FFCC00' },
  { id: 'Rent', icon: '🏠', color: '#5856D6' },
  { id: 'Gift', icon: '🎁', color: '#FF2D55' },
  { id: 'Other', icon: '✨', color: '#8E8E93' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const YEARS = [new Date().getFullYear().toString(), (new Date().getFullYear() + 1).toString()];

export default function FinanceScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [currentPage, setCurrentPage] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Data States
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [targets, setTargets] = useState<SavingTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 15;

  // Filter & Balance States
  const [userFilter, setUserFilter] = useState<'me' | 'partner' | 'both'>('both');
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [myBalance, setMyBalance] = useState(0);
  const [partnerBalance, setPartnerBalance] = useState(0);

  // Modal States
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceEditUser, setBalanceEditUser] = useState<'me' | 'partner' | null>(null);
  const [editBalance, setEditBalance] = useState('');
  
  // Date Picker States (Shared)
  const [showDatePicker, setShowDatePicker] = useState<'start' | 'end' | null>(null);
  const [selDay, setSelDay] = useState(new Date().getDate().toString().padStart(2, '0'));
  const [selMonth, setSelMonth] = useState(MONTHS[new Date().getMonth()]);
  const [selYear, setSelYear] = useState(new Date().getFullYear().toString());

  // Transaction Form
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [category, setCategory] = useState('Other');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Target Form
  const [targetTitle, setTargetTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetType, setTargetType] = useState<'budget' | 'savings'>('budget');
  const [targetPeriod, setTargetPeriod] = useState<'weekly' | 'monthly' | 'custom'>('monthly');
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(addMonths(new Date(), 1), 'yyyy-MM-dd'));

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
    authenticate();
  }, []);

  const authenticate = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    
    if (!hasHardware || !isEnrolled) {
      setIsAuthenticated(true);
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to view Finances',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      setIsAuthenticated(true);
    } else {
      Alert.alert('Auth Failed', 'Cannot show finances without authentication.', [
        { text: 'Retry', onPress: authenticate },
        { text: 'Cancel', style: 'cancel', onPress: () => router.replace('/') }
      ]);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    const init = async () => {
      const name = await SecureStore.getItemAsync('user_name');
      setCurrentUserName(name);
      const other = name?.toLowerCase() === 'pratishth' ? 'love' : 'pratishth';
      setOtherUserName(other);
      
      // Load from SQLite first
      refreshFromSQLite();
      
      if (name && other) {
        fetchBalances(name, other);
      }
      
      fetchTransactions(true);
      fetchTargets();
    };
    init();

    const subFinance = supabase.channel('finance_updates').on('postgres_changes', { event: '*', schema: 'public', table: 'finances' }, (p) => {
      if (p.eventType !== 'DELETE') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO finances (id, created_at, amount, category, description, user_id, type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.amount, n.category, n.description, n.user_id, n.type]);
      } else {
        db.runSync(`DELETE FROM finances WHERE id = ?`, [p.old.id]);
      }
      refreshFromSQLite();
    }).subscribe();

    const subTargets = supabase.channel('target_updates').on('postgres_changes', { event: '*', schema: 'public', table: 'targets' }, (p) => {
      if (p.eventType !== 'DELETE') {
        const n = p.new;
        db.runSync(`INSERT OR REPLACE INTO targets (id, created_at, title, target_amount, current_amount, category, user_id, type, period, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.title, n.target_amount, n.current_amount, n.category, n.user_id, n.type, n.period, n.start_date, n.end_date]);
      } else {
        db.runSync(`DELETE FROM targets WHERE id = ?`, [p.old.id]);
      }
      refreshFromSQLite();
    }).subscribe();

    const subBalances = supabase.channel('balance_updates').on('postgres_changes', { event: '*', schema: 'public', table: 'user_balances' }, () => {
      if (currentUserName && otherUserName) fetchBalances(currentUserName, otherUserName);
    }).subscribe();

    return () => {
      supabase.removeChannel(subFinance);
      supabase.removeChannel(subTargets);
      supabase.removeChannel(subBalances);
    };
  }, [currentUserName, otherUserName, isAuthenticated]);

  const refreshFromSQLite = () => {
    try {
      const tx = db.getAllSync(`SELECT * FROM finances ORDER BY created_at DESC LIMIT 100`) as any[];
      setTransactions(tx || []);
      
      const tg = db.getAllSync(`SELECT * FROM targets ORDER BY created_at DESC`) as any[];
      setTargets(tg || []);
    } catch (e) {}
  };

  const fetchBalances = async (me: string, partner: string) => {
    const { data: myData } = await supabase.from('user_balances').select('balance').eq('user_id', me.toLowerCase()).single();
    if (myData) setMyBalance(myData.balance);
    
    const { data: pData } = await supabase.from('user_balances').select('balance').eq('user_id', partner.toLowerCase()).single();
    if (pData) setPartnerBalance(pData.balance);
  };

  const fetchTransactions = async (reset = false) => {
    if (isFetchingMore && !reset) return;
    if (reset) {
      setLoading(true);
      refreshFromSQLite();
    } else {
      setIsFetchingMore(true);
    }

    const start = reset ? 0 : (page + 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;

    const { data, error } = await supabase.from('finances').select('*').order('created_at', { ascending: false }).range(start, end);
    if (!error && data) {
      data.forEach(n => {
        db.runSync(`INSERT OR REPLACE INTO finances (id, created_at, amount, category, description, user_id, type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.amount, n.category, n.description, n.user_id, n.type]);
      });

      if (reset) setPage(0);
      else setPage(page + 1);
      setHasMore(data.length === PAGE_SIZE);
      refreshFromSQLite();
    }
    setLoading(false);
    setIsFetchingMore(false);
  };

  const fetchTargets = async () => {
    const { data } = await supabase.from('targets').select('*').order('created_at', { ascending: false });
    if (data) {
      data.forEach(n => {
        db.runSync(`INSERT OR REPLACE INTO targets (id, created_at, title, target_amount, current_amount, category, user_id, type, period, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.title, n.target_amount, n.current_amount, n.category, n.user_id, n.type, n.period, n.start_date, n.end_date]);
      });
      refreshFromSQLite();
    }
  };

  const handleSaveTransaction = async () => {
    if (!amount || isNaN(parseFloat(amount)) || !currentUserName) return;
    setIsSaving(true);
    const id = Math.random().toString(36).substr(2, 9);
    const payload = {
      id,
      amount: parseFloat(amount),
      type,
      category,
      description: description.trim(),
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO finances (id, amount, type, category, description, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.amount, payload.type, payload.category, payload.description, payload.user_id, payload.created_at]);
      
      queueSyncOperation('finances', payload.id, 'INSERT', payload);

      setShowAddModal(false);
      setAmount(''); setDescription('');
      refreshFromSQLite();
    } catch (e) {}
    finally { setIsSaving(false); }
  };

  const handleSaveBalance = async () => {
    const targetId = balanceEditUser === 'me' ? currentUserName : otherUserName;
    if (!targetId) return;
    
    setIsSaving(true);
    const newBal = parseFloat(editBalance) || 0;
    try {
      // For balance, we just queue an upsert to Supabase but update local state immediately
      const { error } = await supabase.from('user_balances').upsert({
        user_id: targetId.toLowerCase(),
        balance: newBal
      });
      
      if (!error) {
        if (balanceEditUser === 'me') setMyBalance(newBal);
        else setPartnerBalance(newBal);
        setShowBalanceModal(false);
        setBalanceEditUser(null);
      }
    } catch (e) {}
    setIsSaving(false);
  };

  const handleSaveTarget = async () => {
    if (!targetTitle || !targetAmount || !currentUserName) return;
    setIsSaving(true);
    const id = Math.random().toString(36).substr(2, 9);
    
    let finalStart = startDate;
    let finalEnd = endDate;
    if (targetPeriod === 'weekly') {
      finalStart = format(startOfDay(new Date()), 'yyyy-MM-dd');
      finalEnd = format(addWeeks(new Date(), 1), 'yyyy-MM-dd');
    } else if (targetPeriod === 'monthly') {
      finalStart = format(startOfDay(new Date()), 'yyyy-MM-dd');
      finalEnd = format(addMonths(new Date(), 1), 'yyyy-MM-dd');
    }

    const payload = {
      id,
      title: targetTitle,
      target_amount: parseFloat(targetAmount),
      current_amount: 0,
      type: targetType,
      period: targetPeriod,
      start_date: finalStart,
      end_date: finalEnd,
      category: 'General',
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString()
    };

    try {
      db.runSync(`INSERT INTO targets (id, title, target_amount, current_amount, type, period, start_date, end_date, category, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.title, payload.target_amount, payload.current_amount, payload.type, payload.period, payload.start_date, payload.end_date, payload.category, payload.user_id, payload.created_at]);
      
      queueSyncOperation('targets', payload.id, 'INSERT', payload);

      setShowTargetModal(false);
      setTargetTitle(''); setTargetAmount('');
      refreshFromSQLite();
    } catch (e) {}
    finally { setIsSaving(false); }
  };

  const deleteTarget = async (id: string) => {
    Alert.alert('Delete Goal?', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        db.runSync(`DELETE FROM targets WHERE id = ?`, [id]);
        queueSyncOperation('targets', id, 'DELETE', {});
        refreshFromSQLite();
      }}
    ]);
  };

  const deleteTransaction = async (id: string) => {
    Alert.alert('Delete?', 'Remove this record?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        db.runSync(`DELETE FROM finances WHERE id = ?`, [id]);
        queueSyncOperation('finances', id, 'DELETE', {});
        refreshFromSQLite();
      }}
    ]);
  };

  const filteredTransactions = useMemo(() => {
    if (userFilter === 'both') return transactions;
    const targetId = userFilter === 'me' ? currentUserName : otherUserName;
    return transactions.filter(t => t.user_id === targetId?.toLowerCase());
  }, [transactions, userFilter, currentUserName, otherUserName]);

  const chartData = useMemo(() => {
    const categories: Record<string, number> = {};
    filteredTransactions.filter(t => t.type === 'debit').forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });
    return Object.entries(categories).map(([label, value]) => ({
      value,
      label: label.substring(0, 3),
      frontColor: CATEGORIES.find(c => c.id === label)?.color || theme.tint,
    })).slice(0, 6);
  }, [filteredTransactions, theme.tint]);

  const totalSpent = filteredTransactions.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
  const totalReceived = filteredTransactions.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);

  let currentBankBalance = 0;
  if (userFilter === 'me') {
    currentBankBalance = myBalance + totalReceived - totalSpent;
  } else if (userFilter === 'partner') {
    currentBankBalance = partnerBalance + totalReceived - totalSpent;
  } else {
    currentBankBalance = myBalance + partnerBalance + totalReceived - totalSpent;
  }

  const exportPDF = async () => {
    if (userFilter === 'both') {
      Alert.alert('Select User', 'Please select Me or Love to export individual transactions.');
      return;
    }
    const targetUser = userFilter === 'me' ? currentUserName : otherUserName;
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Helvetica, sans-serif; padding: 20px; color: #333; }
            h1 { color: #111; border-bottom: 2px solid #ddd; padding-bottom: 10px; }
            .summary { background: #f9f9f9; padding: 15px; border-radius: 10px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            th { background-color: #f4f4f4; font-weight: bold; }
            .debit { color: #d93025; font-weight: bold; }
            .credit { color: #34c759; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Transaction Report - ${targetUser?.toUpperCase()}</h1>
          <div class="summary">
            <h3>Financial Summary</h3>
            <p><strong>Base Balance:</strong> ₹${userFilter === 'me' ? myBalance : partnerBalance}</p>
            <p><strong>Total Spent:</strong> ₹${totalSpent}</p>
            <p><strong>Total Received:</strong> ₹${totalReceived}</p>
            <p><strong>Current Balance:</strong> ₹${currentBankBalance}</p>
          </div>
          <table>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Amount</th>
            </tr>
            ${filteredTransactions.map(t => `
              <tr>
                <td>${format(new Date(t.created_at), 'dd MMM yyyy, h:mm a')}</td>
                <td>${t.description || t.category}</td>
                <td>${t.category}</td>
                <td class="${t.type}">₹${t.amount}</td>
              </tr>
            `).join('')}
          </table>
        </body>
      </html>
    `;
    try {
      const { uri } = await Print.printToFileAsync({ html: htmlContent });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) { Alert.alert('Error', 'Failed to generate PDF'); }
  };

  const scrollPage = (index: number) => {
    scrollViewRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentPage(index);
  };

  const confirmDate = () => {
    const monthIdx = MONTHS.indexOf(selMonth);
    const dateStr = `${selYear}-${(monthIdx + 1).toString().padStart(2, '0')}-${selDay.padStart(2, '0')}`;
    if (showDatePicker === 'start') setStartDate(dateStr);
    else if (showDatePicker === 'end') setEndDate(dateStr);
    setShowDatePicker(null);
  };

  const getTargetProgress = (target: SavingTarget) => {
    const start = new Date(target.start_date);
    const end = new Date(target.end_date);
    const relevantAmount = transactions
      .filter(t => {
        const d = new Date(t.created_at);
        const isWithinTime = d >= start && d <= end;
        const isRelevantType = target.type === 'budget' ? t.type === 'debit' : t.type === 'credit';
        return isWithinTime && isRelevantType;
      })
      .reduce((sum, t) => sum + t.amount, 0);
    return relevantAmount;
  };

  if (!isAuthenticated) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={{ marginTop: 20, color: theme.text, fontWeight: '600' }}>Waiting for authentication...</Text>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.tabHeader}>
        <TouchableOpacity onPress={() => scrollPage(0)} style={[styles.tabBtn, currentPage === 0 && { borderBottomColor: theme.tint, borderBottomWidth: 3 }]}>
          <TrendingUp color={currentPage === 0 ? theme.tint : theme.tabIconDefault} size={20} />
          <Text style={[styles.tabLabel, { color: currentPage === 0 ? theme.text : theme.tabIconDefault }]}>Activity</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => scrollPage(1)} style={[styles.tabBtn, currentPage === 1 && { borderBottomColor: theme.tint, borderBottomWidth: 3 }]}>
          <Target color={currentPage === 1 ? theme.tint : theme.tabIconDefault} size={20} />
          <Text style={[styles.tabLabel, { color: currentPage === 1 ? theme.text : theme.tabIconDefault }]}>Goals</Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollViewRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setCurrentPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH))} style={styles.pagerView}>
        {/* CARD 1: ACTIVITY */}
        <View style={{ width: SCREEN_WIDTH }}>
          <ScrollView showsVerticalScrollIndicator={false} onScroll={(e) => {
            handleScroll(e);
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300 && hasMore && !isFetchingMore) fetchTransactions();
          }} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
            <View style={styles.header}>
              <View style={{ backgroundColor: 'transparent' }}>
                <Text style={[styles.title, { color: theme.text }]}>Analytics</Text>
                <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Our financial journey</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {currentUserName?.toLowerCase() === 'pratishth' && (
                  <TouchableOpacity 
                    onPress={() => {
                      setBalanceEditUser('me');
                      setEditBalance(myBalance.toString());
                      setShowBalanceModal(true);
                    }} 
                    style={[styles.fab, { backgroundColor: '#555' }]}
                  >
                    <Landmark color="#FFF" size={20} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowAddModal(true)} style={[styles.fab, { backgroundColor: theme.tint }]}><Plus color="#FFF" size={24} /></TouchableOpacity>
              </View>
            </View>

            <View style={[styles.filterBar, { backgroundColor: theme.card }]}>
              <TouchableOpacity onPress={() => setUserFilter('me')} style={[styles.filterOption, userFilter === 'me' && { backgroundColor: theme.tint }]}><User color={userFilter === 'me' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'me' ? '#FFF' : theme.tabIconDefault }]}>Me</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setUserFilter('both')} style={[styles.filterOption, userFilter === 'both' && { backgroundColor: theme.tint }]}><Users color={userFilter === 'both' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'both' ? '#FFF' : theme.tabIconDefault }]}>Us</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setUserFilter('partner')} style={[styles.filterOption, userFilter === 'partner' && { backgroundColor: theme.tint }]}><Heart color={userFilter === 'partner' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'partner' ? '#FFF' : theme.tabIconDefault }]}>Love</Text></TouchableOpacity>
            </View>

            {/* Bank Balance Card */}
            <View style={[styles.bankCard, { backgroundColor: theme.tint }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Landmark size={18} color="white" opacity={0.9} />
                  <Text style={{ color: 'white', fontWeight: 'bold', opacity: 0.9 }}>TOTAL MONEY IN BANK</Text>
                </View>
                <TouchableOpacity 
                  onPress={() => { 
                    if (userFilter === 'both') {
                      Alert.alert('Select User', 'Please select Me or Love to update individual base balances.');
                      return;
                    }
                    setBalanceEditUser(userFilter === 'me' ? 'me' : 'partner');
                    setEditBalance(userFilter === 'me' ? myBalance.toString() : partnerBalance.toString()); 
                    setShowBalanceModal(true); 
                  }}
                  style={{ padding: 4 }}
                >
                  <RotateCcw size={16} color="white" opacity={0.9} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: 'white', fontSize: 36, fontWeight: '900', marginTop: 10, letterSpacing: -0.5 }}>₹{currentBankBalance.toLocaleString()}</Text>
            </View>

            <View style={[styles.chartContainer, { backgroundColor: theme.card }]}>
              <Text style={[styles.chartTitle, { color: theme.tabIconDefault }]}>SPENDING BY CATEGORY</Text>
              {chartData.length > 0 ? (
                <BarChart data={chartData} barWidth={35} noOfSections={3} barBorderRadius={6} frontColor={theme.tint} yAxisThickness={0} xAxisThickness={0} hideRules yAxisTextStyle={{ color: theme.tabIconDefault, fontSize: 10 }} xAxisLabelTextStyle={{ color: theme.tabIconDefault, fontSize: 10 }} height={150} />
              ) : (
                <View style={styles.emptyChart}><TrendingUp color={theme.tabIconDefault} size={40} opacity={0.3} /><Text style={{ color: theme.tabIconDefault }}>No spending data</Text></View>
              )}
            </View>

            <View style={styles.summaryGrid}>
              <SummaryCard label="Spent" amount={totalSpent} type="debit" theme={theme} />
              <SummaryCard label="Received" amount={totalReceived} type="credit" theme={theme} />
            </View>

            <View style={styles.listHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>History</Text>
                <ReceiptText color={theme.tabIconDefault} size={20} />
              </View>
              {userFilter !== 'both' && (
                <TouchableOpacity onPress={exportPDF} style={styles.exportBtn}>
                  <Download size={14} color={theme.tint} />
                  <Text style={{ color: theme.tint, fontSize: 12, fontWeight: 'bold' }}>Export PDF</Text>
                </TouchableOpacity>
              )}
            </View>

            {filteredTransactions.map((t, i) => (
              <MotiView key={t.id} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: i < 10 ? i * 50 : 0 }} style={[styles.txCard, { backgroundColor: theme.card }]}>
                <View style={[styles.txIcon, { backgroundColor: theme.tint + '15' }]}><Text style={{ fontSize: 18 }}>{CATEGORIES.find(c => c.id === t.category)?.icon || '✨'}</Text></View>
                <View style={styles.txMain}><Text style={[styles.txDesc, { color: theme.text }]} numberOfLines={1}>{t.description || t.category}</Text><Text style={[styles.txDate, { color: theme.tabIconDefault }]}>{format(new Date(t.created_at), 'MMM d, h:mm a')}</Text></View>
                <View style={styles.txEnd}><Text style={[styles.txAmt, { color: t.type === 'debit' ? '#FF3B30' : '#34C759' }]}>{t.type === 'debit' ? '-' : '+'}₹{t.amount.toLocaleString()}</Text><TouchableOpacity onPress={() => deleteTransaction(t.id)}><Trash2 color={theme.tabIconDefault} size={14} /></TouchableOpacity></View>
              </MotiView>
            ))}
          </ScrollView>
        </View>

        {/* CARD 2: GOALS */}
        <View style={{ width: SCREEN_WIDTH }}>
          <ScrollView onScroll={handleScroll} scrollEventThrottle={16} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 80 }}>
            <View style={styles.header}>
              <View style={{ backgroundColor: 'transparent' }}>
                <Text style={[styles.title, { color: theme.text }]}>Shared Goals</Text>
                <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Budgeting & Saving</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTargetModal(true)} style={[styles.fab, { backgroundColor: theme.secondary }]}><Plus color="#FFF" size={24} /></TouchableOpacity>
            </View>

            {targets.length === 0 ? (
              <View style={styles.emptyTargets}><Target color={theme.tabIconDefault} size={64} opacity={0.2} /><Text style={[styles.emptyText, { color: theme.tabIconDefault }]}>No goals yet.</Text></View>
            ) : (
              targets.map((target, i) => {
                const current = getTargetProgress(target);
                const progress = Math.min(current / target.target_amount, 1);
                const daysLeft = differenceInDays(new Date(target.end_date), new Date());
                const isOverBudget = target.type === 'budget' && current > target.target_amount;

                return (
                  <MotiView key={target.id} from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 100 }} style={[styles.targetCard, { backgroundColor: theme.card }]}>
                    <View style={styles.targetHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={[styles.targetTitle, { color: theme.text }]}>{target.title}</Text>
                          <View style={[styles.typeBadge, { backgroundColor: target.type === 'budget' ? '#FF3B3020' : '#34C75920' }]}>
                            <Text style={{ color: target.type === 'budget' ? '#FF3B30' : '#34C759', fontSize: 10, fontWeight: '800' }}>{target.type.toUpperCase()}</Text>
                          </View>
                        </View>
                        <Text style={[styles.targetSubtitle, { color: theme.tabIconDefault }]}>
                          {target.period.toUpperCase()} • {daysLeft > 0 ? `${daysLeft}d left` : 'Finished'}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => deleteTarget(target.id)}><Trash2 color={theme.tabIconDefault} size={16} /></TouchableOpacity>
                    </View>
                    
                    <View style={styles.progressBarContainer}>
                      <View style={[styles.progressBarBackground, { backgroundColor: theme.tabIconDefault + '20' }]}>
                        <MotiView from={{ width: '0%' }} animate={{ width: `${progress * 100}%` }} style={[styles.progressBarFill, { backgroundColor: isOverBudget ? '#FF3B30' : theme.tint }]} />
                      </View>
                    </View>

                    <View style={styles.targetFooter}>
                      <Text style={[styles.targetValue, { color: isOverBudget ? '#FF3B30' : theme.text }]}>₹{current.toLocaleString()}</Text>
                      <Text style={[styles.targetGoal, { color: theme.tabIconDefault }]}>Limit: ₹{target.target_amount.toLocaleString()}</Text>
                    </View>
                  </MotiView>
                );
              })
            )}
          </ScrollView>
        </View>
      </ScrollView>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showAddModal && (
          <MotiView key="txModal" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowAddModal(false)} />
              <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card }]}>
                <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>New Entry</Text><TouchableOpacity onPress={() => setShowAddModal(false)}><X color={theme.text} size={24} /></TouchableOpacity></View>
                <View style={styles.typeSwitch}>
                  <TouchableOpacity onPress={() => setType('debit')} style={[styles.typeOption, type === 'debit' && { backgroundColor: '#FF3B30' }]}><Text style={[styles.typeText, { color: type === 'debit' ? '#FFF' : theme.tabIconDefault }]}>Spent</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setType('credit')} style={[styles.typeOption, type === 'credit' && { backgroundColor: '#34C759' }]}><Text style={[styles.typeText, { color: type === 'credit' ? '#FFF' : theme.tabIconDefault }]}>Received</Text></TouchableOpacity>
                </View>
                <TextInput style={[styles.bigInput, { color: theme.text }]} placeholder="₹ 0.00" placeholderTextColor={theme.tabIconDefault} keyboardType="numeric" value={amount} onChangeText={setAmount} autoFocus />
                <TextInput style={[styles.smallInput, { color: theme.text }]} placeholder="What was this for?..." placeholderTextColor={theme.tabIconDefault} value={description} onChangeText={setDescription} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 15 }}>
                  {CATEGORIES.map(c => <TouchableOpacity key={c.id} onPress={() => setCategory(c.id)} style={[styles.catPill, { backgroundColor: theme.background }, category === c.id && { backgroundColor: theme.tint }]}><Text>{c.icon}</Text><Text style={[styles.catLabel, { color: category === c.id ? '#FFF' : theme.text }]}>{c.id}</Text></TouchableOpacity>)}
                </ScrollView>
                <TouchableOpacity onPress={handleSaveTransaction} disabled={isSaving} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>{isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save</Text>}</TouchableOpacity>
              </MotiView>
            </View>
          </MotiView>
        )}

        {/* Balance Update Modal */}
        {showBalanceModal && (
          <MotiView key="balanceModal" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowBalanceModal(false)} />
              <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card }]}>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.text }]}>Set Base Balance</Text>
                  <TouchableOpacity onPress={() => setShowBalanceModal(false)}><X color={theme.text} size={24} /></TouchableOpacity>
                </View>
                <Text style={{ color: theme.tabIconDefault, marginBottom: 20, fontSize: 13, lineHeight: 18 }}>
                  Setting initial balance for {balanceEditUser === 'me' ? currentUserName?.toUpperCase() : otherUserName?.toUpperCase()}.
                </Text>
                {currentUserName?.toLowerCase() === 'pratishth' && (
                  <View style={[styles.typeSwitch, { marginBottom: 15 }]}>
                    <TouchableOpacity onPress={() => { setBalanceEditUser('me'); setEditBalance(myBalance.toString()); }} style={[styles.typeOption, balanceEditUser === 'me' && { backgroundColor: theme.tint }]}><Text style={{ color: balanceEditUser === 'me' ? '#FFF' : '#888', fontWeight: 'bold' }}>Me</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => { setBalanceEditUser('partner'); setEditBalance(partnerBalance.toString()); }} style={[styles.typeOption, balanceEditUser === 'partner' && { backgroundColor: theme.tint }]}><Text style={{ color: balanceEditUser === 'partner' ? '#FFF' : '#888', fontWeight: 'bold' }}>Love</Text></TouchableOpacity>
                  </View>
                )}
                <TextInput 
                  style={[styles.bigInput, { color: theme.text, marginBottom: 20 }]} 
                  placeholder="₹ 0.00" 
                  placeholderTextColor={theme.tabIconDefault} 
                  keyboardType="numeric" 
                  value={editBalance} 
                  onChangeText={setEditBalance} 
                  autoFocus 
                />
                <TouchableOpacity onPress={handleSaveBalance} disabled={isSaving} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                  {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Update Balance</Text>}
                </TouchableOpacity>
              </MotiView>
            </View>
          </MotiView>
        )}

        {showTargetModal && (
          <MotiView key="targetModal" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setShowTargetModal(false)} />
              <ScrollView contentContainerStyle={{ flex: 1, justifyContent: 'center', padding: 24 }}>
                <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card, width: '100%' }]}>
                  <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>Set Goal</Text><TouchableOpacity onPress={() => setShowTargetModal(false)}><X color={theme.text} size={24} /></TouchableOpacity></View>
                  
                  <View style={styles.typeSwitch}>
                    <TouchableOpacity onPress={() => setTargetType('budget')} style={[styles.typeOption, targetType === 'budget' && { backgroundColor: theme.tint }]}><Text style={[styles.typeText, { color: targetType === 'budget' ? '#FFF' : theme.tabIconDefault }]}>Budget</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setTargetType('savings')} style={[styles.typeOption, targetType === 'savings' && { backgroundColor: theme.secondary }]}><Text style={[styles.typeText, { color: targetType === 'savings' ? '#FFF' : theme.tabIconDefault }]}>Savings</Text></TouchableOpacity>
                  </View>

                  <TextInput style={[styles.smallInput, { color: theme.text, fontSize: 20 }]} placeholder="Goal Name (e.g. New Trip)" placeholderTextColor={theme.tabIconDefault} value={targetTitle} onChangeText={setTargetTitle} />
                  <TextInput style={[styles.bigInput, { color: theme.text }]} placeholder="Amount ₹" placeholderTextColor={theme.tabIconDefault} keyboardType="numeric" value={targetAmount} onChangeText={setTargetAmount} />
                  
                  <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginTop: 15 }]}>PERIOD</Text>
                  <View style={styles.freqRow}>
                    {['weekly', 'monthly', 'custom'].map(p => (
                      <TouchableOpacity key={p} onPress={() => setTargetPeriod(p as any)} style={[styles.freqBtn, { backgroundColor: theme.background }, targetPeriod === p && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.freqLabel, { color: targetPeriod === p ? '#FFF' : theme.text }]}>{p.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {targetPeriod === 'custom' && (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
                      <TouchableOpacity onPress={() => setShowDatePicker('start')} style={[styles.dateBtn, { backgroundColor: theme.background }]}><Calendar size={16} color={theme.tint} /><Text style={{ color: theme.text, fontSize: 12 }}>{startDate}</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowDatePicker('end')} style={[styles.dateBtn, { backgroundColor: theme.background }]}><Calendar size={16} color={theme.tint} /><Text style={{ color: theme.text, fontSize: 12 }}>{endDate}</Text></TouchableOpacity>
                    </View>
                  )}

                  <TouchableOpacity onPress={handleSaveTarget} disabled={isSaving} style={[styles.saveBtn, { backgroundColor: theme.tint, marginTop: 20 }]}>{isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Set Goal</Text>}</TouchableOpacity>
                </MotiView>
              </ScrollView>
            </View>
          </MotiView>
        )}

        {showDatePicker && (
          <MotiView key="pickerOverlay" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={StyleSheet.absoluteFill}>
            <View style={styles.modalOverlay}>
              <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
              <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.pickerBox, { backgroundColor: theme.card }]}>
                <Text style={[styles.pickerTitle, { color: theme.text }]}>Select Date</Text>
                <View style={styles.pickerWheelRow}>
                  <Wheel data={Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'))} selected={selDay} onSelect={setSelDay} theme={theme} />
                  <Wheel data={MONTHS} selected={selMonth} onSelect={setSelMonth} theme={theme} />
                  <Wheel data={YEARS} selected={selYear} onSelect={setSelYear} theme={theme} />
                </View>
                <View style={styles.pickerActions}>
                  <TouchableOpacity onPress={() => setShowDatePicker(null)} style={styles.cancelBtn}><Text style={[styles.cancelText, { color: theme.tabIconDefault }]}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={confirmDate} style={[styles.confirmBtn, { backgroundColor: theme.tint }]}><Text style={styles.confirmText}>Set Date</Text></TouchableOpacity>
                </View>
              </MotiView>
            </View>
          </MotiView>
        )}
      </AnimatePresence>
    </ThemedView>
  );
}

function Wheel({ data, selected, onSelect, theme }: any) {
  return (
    <ScrollView style={styles.wheel} showsVerticalScrollIndicator={false}>
      {data.map((item: string) => (
        <TouchableOpacity key={item} onPress={() => onSelect(item)} style={[styles.wheelItem, selected === item && { backgroundColor: theme.tint + '20', borderRadius: 10 }]}><Text style={[styles.wheelText, { color: selected === item ? theme.tint : theme.text }]}>{item}</Text></TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function SummaryCard({ label, amount, type, theme }: any) {
  return (
    <View style={[styles.sumCard, { backgroundColor: theme.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {type === 'debit' ? <ArrowDownCircle color="#FF3B30" size={16} /> : <ArrowUpCircle color="#34C759" size={16} />}
        <Text style={[styles.sumLabel, { color: theme.tabIconDefault }]}>{label}</Text>
      </View>
      <Text style={[styles.sumAmt, { color: theme.text }]}>₹{amount.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabHeader: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 10, gap: 20 },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  tabLabel: { fontSize: 15, fontWeight: '700' },
  pagerView: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontWeight: '600' },
  fab: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  filterBar: { flexDirection: 'row', marginHorizontal: 20, padding: 4, borderRadius: 14, marginBottom: 20 },
  filterOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, gap: 6 },
  filterText: { fontSize: 13, fontWeight: '700' },
  bankCard: { marginHorizontal: 20, marginBottom: 20, padding: 25, borderRadius: 28, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 15 },
  chartContainer: { marginHorizontal: 20, padding: 20, borderRadius: 28, marginBottom: 20, alignItems: 'center' },
  chartTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 20 },
  emptyChart: { height: 150, justifyContent: 'center', alignItems: 'center', gap: 10 },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 24 },
  sumCard: { flex: 0.48, padding: 16, borderRadius: 24, gap: 4 },
  sumLabel: { fontSize: 12, fontWeight: '700' },
  sumAmt: { fontSize: 18, fontWeight: '800' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(175, 82, 222, 0.1)' },
  txCard: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, padding: 14, borderRadius: 20, marginBottom: 10, gap: 14 },
  txIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  txMain: { flex: 1 },
  txDesc: { fontSize: 15, fontWeight: '700' },
  txDate: { fontSize: 11, fontWeight: '600' },
  txEnd: { alignItems: 'flex-end', gap: 4 },
  txAmt: { fontSize: 16, fontWeight: '800' },
  emptyTargets: { flex: 1, height: 400, justifyContent: 'center', alignItems: 'center', gap: 20 },
  emptyText: { fontSize: 16, fontWeight: '600' },
  targetCard: { padding: 20, borderRadius: 28, marginBottom: 16, gap: 16 },
  targetHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  targetTitle: { fontSize: 18, fontWeight: '800' },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  targetSubtitle: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  progressBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  progressBarContainer: { height: 10, width: '100%', borderRadius: 5, overflow: 'hidden' },
  progressBarBackground: { flex: 1 },
  progressBarFill: { height: '100%', borderRadius: 5 },
  targetFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  targetValue: { fontSize: 20, fontWeight: '900' },
  targetGoal: { fontSize: 13, fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalContent: { borderRadius: 40, padding: 24, width: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '800' },
  bigInput: { fontSize: 36, fontWeight: '900', textAlign: 'center' },
  smallInput: { fontSize: 16, fontWeight: '600', paddingVertical: 10 },
  inputLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
  typeSwitch: { flexDirection: 'row', backgroundColor: 'rgba(150,150,150,0.1)', padding: 4, borderRadius: 14, marginBottom: 20 },
  typeOption: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  typeText: { fontWeight: '800', fontSize: 13 },
  catPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, gap: 6 },
  catLabel: { fontSize: 13, fontWeight: '700' },
  saveBtn: { height: 56, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  freqRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  freqBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  freqLabel: { fontSize: 11, fontWeight: '800' },
  dateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12 },
  pickerBox: { width: SCREEN_WIDTH * 0.9, padding: 24, borderRadius: 32, alignItems: 'center', gap: 20 },
  pickerTitle: { fontSize: 20, fontWeight: '800' },
  pickerWheelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 180 },
  wheel: { width: 70 },
  wheelItem: { paddingVertical: 12, alignItems: 'center' },
  wheelText: { fontSize: 18, fontWeight: '700' },
  pickerActions: { flexDirection: 'row', gap: 12, marginTop: 10 },
  cancelBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: 'rgba(150,150,150,0.1)' },
  cancelText: { fontWeight: '700' },
  confirmBtn: { flex: 1, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  confirmText: { color: '#FFF', fontWeight: '800' }
});