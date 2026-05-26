import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, ScrollView, Pressable, View, Dimensions, ActivityIndicator, Alert, TouchableOpacity, TextInput, DeviceEventEmitter, RefreshControl } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { MotiView, AnimatePresence } from 'moti';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Wallet, Plus, X, Trash2, ArrowDownCircle, ArrowUpCircle, Filter, PieChart as PieChartIcon, Landmark, ReceiptText, Users, User, Target, ChevronRight, TrendingUp, Heart, Calendar, Clock, RotateCcw, Download } from 'lucide-react-native';
import { format, addDays, addWeeks, addMonths, isAfter, isBefore, startOfDay, endOfDay, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { categoriseDescription, ALL_CATEGORIES, CATEGORY_META } from '@/lib/financeCategories';
import { runBudgetRollover } from '@/lib/budgets';
import { checkAllBudgetAlerts } from '@/lib/budgetAlerts';
import {
  processSmsInbox, listPendingReview, countPendingReview,
  approvePendingReview, discardPendingReview, blockSender,
  getConfidenceThreshold, setConfidenceThreshold,
  type PendingReviewRow,
} from '@/lib/smsParser';
import { Modal } from 'react-native';
import { AlertCircle, CheckCircle2, XCircle, Sliders, Ban, Repeat } from 'lucide-react-native';
import { displayName } from '@/lib/displayName';
import { refreshAllNow } from '@/lib/syncEngine';
import {
  smartCategorise, learnCategoryRule,
  detectSubscriptions, predictBills, computeSpendingForecast,
  splitTransactionWithPartner, ensureMonthlySnapshots,
} from '@/lib/financeIntelligence';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import { BarChart } from "react-native-gifted-charts";
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { extractMerchantName, extractSMSAmount } from '@/lib/utils';
import * as Haptics from 'expo-haptics';

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
  const [recatTxn, setRecatTxn] = useState<any | null>(null);

  // SMS Pending Review
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [pendingRows, setPendingRows] = useState<PendingReviewRow[]>([]);
  const [confidenceThreshold, setConfidenceThresholdState] = useState(0.7);
  const [isFinanceRefreshing, setIsFinanceRefreshing] = useState(false);
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
  // When set, the Add modal is in EDIT mode for this txn id (UPDATE not INSERT).
  // Setting state via openEditModal(txn) pre-fills all fields.
  const [editTxnId, setEditTxnId] = useState<string | null>(null);
  const [editOriginal, setEditOriginal] = useState<any | null>(null); // snapshot for learn-on-change

  // Target Form
  const [targetTitle, setTargetTitle] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetType, setTargetType] = useState<'budget' | 'savings'>('budget');
  const [targetPeriod, setTargetPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>('monthly');
  // Budget kind — drives the alert engine. period_overall = whole window.
  // period_category = window + single category. single_txn = any txn > amount.
  // velocity = transaction COUNT cap in window.
  const [targetKind, setTargetKind] = useState<'period_overall' | 'period_category' | 'single_txn' | 'velocity'>('period_overall');
  const [targetCategory, setTargetCategory] = useState<string>('All');
  const [targetThresholdPct, setTargetThresholdPct] = useState<number>(1.0); // 0.8 = warn at 80%
  const [targetRecurring, setTargetRecurring] = useState<boolean>(true);
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
      
      // Roll over any recurring budgets whose period ended.
      if (name) runBudgetRollover(name);
      // Background-check budget breaches every time the screen mounts so the
      // user gets reminded even if the breach happened on the partner's device.
      if (name) checkAllBudgetAlerts(name).catch(() => {});
      // Ensure last-12-months snapshot rows exist (idempotent, skips already-written months).
      if (name) ensureMonthlySnapshots(name);

      // SMS-inbox: process anything waiting, then refresh the pending-review count.
      if (name) {
        try { await processSmsInbox(name); } catch {}
        setPendingReviewCount(countPendingReview(name));
      }
      setConfidenceThresholdState(getConfidenceThreshold());

      // Load from SQLite first
      refreshFromSQLite();

      if (name && other) {
        fetchBalances(name, other);
      }
      
      fetchTransactions(true);
      fetchTargets();
    };
    init();

    // 🔗 DEEP LINK AUTOMATION
    const handleDeepLink = async (url: string) => {
      if (!url.includes('tamtam://transaction')) return;
      const parsed = Linking.parse(url);
      const { amount: rawAmt, merchant: rawMerc, raw: smsBody } = parsed.queryParams || {};
      
      if (rawAmt || smsBody) {
        const cleanedAmt = rawAmt ? parseFloat(rawAmt.toString()) : extractSMSAmount(smsBody?.toString() || '');
        const cleanedMerc = rawMerc ? rawMerc.toString() : extractMerchantName(smsBody?.toString() || '');
        
        if (cleanedAmt !== 0) {
          const id = generateUUID();
          const name = await SecureStore.getItemAsync('user_name');
          const payload = {
            id,
            amount: cleanedAmt,
            type: cleanedAmt < 0 ? 'debit' : 'credit',
            category: 'Other',
            description: cleanedMerc,
            user_id: name?.toLowerCase() || 'unknown',
            created_at: new Date().toISOString()
          };
          
          db.runSync(`INSERT INTO finances (id, amount, type, category, description, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
            [payload.id, Math.abs(payload.amount), payload.type, payload.category, payload.description, payload.user_id, payload.created_at]);
          queueSyncOperation('finances', id, 'INSERT', payload);
          
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refreshFromSQLite();
        }
      }
    };

    const urlListener = Linking.addEventListener('url', (e) => handleDeepLink(e.url));
    Linking.getInitialURL().then(url => { if (url) handleDeepLink(url); });

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

    const subRealtimeTransactions = supabase.channel('public:transactions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'finances' }, (payload) => {
        const n = payload.new;
        db.runSync(`INSERT OR REPLACE INTO finances (id, created_at, amount, category, description, user_id, type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.amount, n.category, n.description, n.user_id, n.type]);
        refreshFromSQLite();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      })
      .subscribe();

    return () => {
      urlListener.remove();
      supabase.removeChannel(subFinance);
      supabase.removeChannel(subTargets);
      supabase.removeChannel(subBalances);
      supabase.removeChannel(subRealtimeTransactions);
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

  const openEditModal = (t: any) => {
    setEditTxnId(t.id);
    setEditOriginal({ category: t.category, amount: t.amount, type: t.type, description: t.description, source: t.source });
    setAmount(String(t.amount));
    setType((t.type === 'credit' ? 'credit' : 'debit'));
    setCategory(t.category || 'Other');
    setDescription(t.description || '');
    if (t.transaction_date) {
      const d = new Date(t.transaction_date);
      setSelDay(String(d.getDate()).padStart(2, '0'));
      setSelMonth(MONTHS[d.getMonth()]);
      setSelYear(String(d.getFullYear()));
    }
    setShowAddModal(true);
  };

  const handleSaveTransaction = async () => {
    if (!amount || isNaN(parseFloat(amount)) || !currentUserName) return;
    setIsSaving(true);
    const desc = description.trim();
    const autoCategory = (category === 'Other' || !category)
      ? smartCategorise(currentUserName, desc, type === 'credit' ? parseFloat(amount) : -parseFloat(amount))
      : category;
    const monthIdx = Math.max(0, MONTHS.indexOf(selMonth));
    const txnDate = `${selYear}-${String(monthIdx + 1).padStart(2, '0')}-${String(selDay).padStart(2, '0')}`;

    try {
      if (editTxnId) {
        // EDIT path — UPDATE existing row + learn from any change.
        db.runSync(
          `UPDATE finances SET amount = ?, type = ?, category = ?, description = ?, transaction_date = ? WHERE id = ?`,
          [parseFloat(amount), type, autoCategory, desc, txnDate, editTxnId]
        );
        queueSyncOperation('finances', editTxnId, 'UPDATE', {
          amount: parseFloat(amount), type, category: autoCategory, description: desc, transaction_date: txnDate,
        });

        // Confidence boost / pattern learning: if the user changed the category
        // (or any signal) on a SMS-captured row, the parser was wrong about
        // *this kind of merchant*. Save a user_finance_rules pattern so the
        // next SMS with the same description root auto-categorises right.
        if (editOriginal && desc) {
          const catChanged = editOriginal.category !== autoCategory;
          const fromSms = editOriginal.source === 'sms_bank' || editOriginal.source === 'sms_bank_recurring';
          if (catChanged) {
            learnCategoryRule(currentUserName, desc, autoCategory);
          }
          // If the edit came from a SMS row AND the user kept it (didn't delete),
          // also persist the description as a positive sample — boosts confidence
          // next time a near-identical SMS arrives.
          if (fromSms) {
            learnCategoryRule(currentUserName, desc, autoCategory);
          }
        }
      } else {
        // ADD path — INSERT new row.
        const id = generateUUID();
        const payload: any = {
          id,
          amount: parseFloat(amount),
          type,
          category: autoCategory,
          description: desc,
          user_id: currentUserName.toLowerCase(),
          created_at: new Date().toISOString(),
          transaction_date: txnDate,
          source: 'manual',
        };
        db.runSync(`INSERT INTO finances (id, amount, type, category, description, user_id, created_at, transaction_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [payload.id, payload.amount, payload.type, payload.category, payload.description, payload.user_id, payload.created_at, payload.transaction_date, payload.source]);
        queueSyncOperation('finances', payload.id, 'INSERT', payload);
      }

      if (currentUserName) {
        checkAllBudgetAlerts(currentUserName, {
          amount: parseFloat(amount),
          category: autoCategory,
        }).catch(() => {});
      }

      setShowAddModal(false);
      setAmount(''); setDescription('');
      setEditTxnId(null); setEditOriginal(null);
      refreshFromSQLite();
    } catch (e) {}
    finally { setIsSaving(false); }
  };

  const handleSaveBalance = async () => {
    // Each user edits only their own balance. Behaviour:
    //   • FIRST-TIME (no base set yet AND no txns for this user) → write base directly.
    //   • SUBSEQUENT update → DO NOT mutate the base. Compute delta vs current displayed
    //     "my" balance and insert a "Balance Adjustment" finances row of type
    //     credit (if delta > 0) or debit (if delta < 0). This makes the change
    //     auditable + reversible: deleting the adjustment row reverts the
    //     change. Same machinery as any other transaction.
    if (!currentUserName) return;
    setIsSaving(true);
    const newBal = parseFloat(editBalance) || 0;
    const userIdLower = currentUserName.toLowerCase();

    // "My" current displayed balance = stored base + sum of my own txns.
    const myTxnNet = transactions
      .filter(t => t.user_id === userIdLower)
      .reduce((s, t) => s + (t.type === 'credit' ? t.amount : -t.amount), 0);
    const currentMineDisplay = myBalance + myTxnNet;
    const delta = newBal - currentMineDisplay;

    try {
      const isFirstTime = myBalance === 0 && myTxnNet === 0;
      if (isFirstTime) {
        // Initial base — direct upsert, no adjustment txn.
        const { error } = await supabase.from('user_balances').upsert({
          user_id: userIdLower,
          balance: newBal,
        });
        if (!error) setMyBalance(newBal);
      } else if (Math.abs(delta) > 0.005) {
        // Subsequent update — create an auditable adjustment txn.
        const id = generateUUID();
        const today = new Date().toISOString().slice(0, 10);
        const txnType = delta > 0 ? 'credit' : 'debit';
        const amount = Math.abs(delta);
        db.runSync(
          `INSERT INTO finances (id, created_at, amount, category, description, user_id, type, transaction_date, source)
           VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, 'balance_adjustment')`,
          [id, amount, 'Balance Adjustment', delta > 0 ? 'Balance correction (up)' : 'Balance correction (down)', userIdLower, txnType, today]
        );
        queueSyncOperation('finances', id, 'INSERT', {
          id, amount, category: 'Balance Adjustment',
          description: delta > 0 ? 'Balance correction (up)' : 'Balance correction (down)',
          user_id: userIdLower, type: txnType, transaction_date: today,
          source: 'balance_adjustment', created_at: new Date().toISOString(),
        });
        refreshFromSQLite();
      }
      setShowBalanceModal(false);
      setBalanceEditUser(null);
    } catch {}
    setIsSaving(false);
  };

  const handleSaveTarget = async () => {
    if (!targetTitle || !targetAmount || !currentUserName) return;
    setIsSaving(true);
    const id = generateUUID();
    
    let finalStart = startDate;
    let finalEnd = endDate;
    const todayStart = format(startOfDay(new Date()), 'yyyy-MM-dd');
    if (targetPeriod === 'daily') {
      finalStart = todayStart;
      finalEnd = todayStart;
    } else if (targetPeriod === 'weekly') {
      finalStart = todayStart;
      finalEnd = format(addDays(addWeeks(new Date(), 1), -1), 'yyyy-MM-dd');
    } else if (targetPeriod === 'monthly') {
      finalStart = todayStart;
      finalEnd = format(addDays(addMonths(new Date(), 1), -1), 'yyyy-MM-dd');
    } else if (targetPeriod === 'yearly') {
      finalStart = todayStart;
      finalEnd = format(addDays(addMonths(new Date(), 12), -1), 'yyyy-MM-dd');
    }

    const payload: any = {
      id,
      title: targetTitle,
      target_amount: parseFloat(targetAmount),
      current_amount: 0,
      type: targetType,
      period: targetPeriod,
      start_date: finalStart,
      end_date: finalEnd,
      category: targetKind === 'period_category' ? targetCategory : 'All',
      user_id: currentUserName.toLowerCase(),
      created_at: new Date().toISOString(),
      kind: targetKind,
      threshold_pct: targetThresholdPct,
      notify_on_warn: targetThresholdPct < 1.0 ? 1 : 0,
      is_recurring: targetRecurring ? 1 : 0,
      frequency: targetPeriod,
    };

    try {
      db.runSync(`INSERT INTO targets (id, title, target_amount, current_amount, type, period, start_date, end_date, category, user_id, created_at, kind, threshold_pct, notify_on_warn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [payload.id, payload.title, payload.target_amount, payload.current_amount, payload.type, payload.period, payload.start_date, payload.end_date, payload.category, payload.user_id, payload.created_at, payload.kind, payload.threshold_pct, payload.notify_on_warn]);
      
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

  const totalNetBalance = useMemo(() => {
    // Global net balance from all transactions ever recorded (not just filtered)
    return transactions.reduce((sum, t) => {
      return t.type === 'credit' ? sum + t.amount : sum - t.amount;
    }, 0);
  }, [transactions]);

  let currentBankBalance = (userFilter === 'both' ? (myBalance + partnerBalance) : (userFilter === 'me' ? myBalance : partnerBalance)) + totalNetBalance;

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
          <ScrollView
            showsVerticalScrollIndicator={false}
            onScroll={(e) => {
              handleScroll(e);
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300 && hasMore && !isFetchingMore) fetchTransactions();
            }}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
            refreshControl={<RefreshControl
              refreshing={isFinanceRefreshing}
              onRefresh={async () => {
                setIsFinanceRefreshing(true);
                try { await refreshAllNow(); fetchTransactions(true); if (currentUserName && otherUserName) fetchBalances(currentUserName, otherUserName); } catch {}
                setIsFinanceRefreshing(false);
              }}
              tintColor={theme.tint}
            />}
          >
            {pendingReviewCount > 0 && (
              <TouchableOpacity
                onPress={() => {
                  if (currentUserName) setPendingRows(listPendingReview(currentUserName));
                  setShowReviewModal(true);
                }}
                style={{ marginHorizontal: 20, marginTop: 12, padding: 14, borderRadius: 16, backgroundColor: '#FFB02E22', borderWidth: 1, borderColor: '#FFB02E66', flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <AlertCircle size={22} color="#FFB02E" />
                <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>{pendingReviewCount} SMS waiting for review</Text>
                  <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginTop: 2 }}>Parser is unsure — tap to approve or discard.</Text>
                </View>
                <ChevronRight size={18} color={theme.tabIconDefault} />
              </TouchableOpacity>
            )}
            <View style={styles.header}>
              <View style={{ backgroundColor: 'transparent' }}>
                <Text style={[styles.title, { color: theme.text }]}>Analytics</Text>
                <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Our financial journey</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {/* Bank balance editor — accessible to BOTH users so each can set / update their own starting balance. The modal's Me/Love toggle picks whose balance to edit. */}
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
                <TouchableOpacity onPress={() => setShowAddModal(true)} style={[styles.fab, { backgroundColor: theme.tint }]}><Plus color="#FFF" size={24} /></TouchableOpacity>
              </View>
            </View>

            <View style={[styles.filterBar, { backgroundColor: theme.card }]}>
              <TouchableOpacity onPress={() => setUserFilter('me')} style={[styles.filterOption, userFilter === 'me' && { backgroundColor: theme.tint }]}><User color={userFilter === 'me' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'me' ? '#FFF' : theme.tabIconDefault }]}>Me</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setUserFilter('both')} style={[styles.filterOption, userFilter === 'both' && { backgroundColor: theme.tint }]}><Users color={userFilter === 'both' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'both' ? '#FFF' : theme.tabIconDefault }]}>Us</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setUserFilter('partner')} style={[styles.filterOption, userFilter === 'partner' && { backgroundColor: theme.tint }]}><Heart color={userFilter === 'partner' ? '#FFF' : theme.tabIconDefault} size={16} /><Text style={[styles.filterText, { color: userFilter === 'partner' ? '#FFF' : theme.tabIconDefault }]}>{displayName(otherUserName)}</Text></TouchableOpacity>
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
                    // Each user can only edit their OWN base balance.
                    setBalanceEditUser('me');
                    setEditBalance(myBalance.toString());
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

            {filteredTransactions.map((t, i) => {
              const isDebit = t.type === 'debit';
              return (
                <MotiView 
                  key={t.id} 
                  from={{ opacity: 0, translateY: 10 }} 
                  animate={{ opacity: 1, translateY: 0 }} 
                  transition={{ delay: i < 10 ? i * 50 : 0 }} 
                  style={[styles.txCard, { backgroundColor: theme.card }]}
                >
                  <TouchableOpacity
                    onPress={() => setRecatTxn(t)}
                    style={[styles.txIcon, { backgroundColor: (CATEGORY_META[t.category as keyof typeof CATEGORY_META]?.color || (isDebit ? '#FF3B30' : '#34C759')) + '15' }]}
                  >
                    <Text style={{ fontSize: 18 }}>{CATEGORY_META[t.category as keyof typeof CATEGORY_META]?.emoji || CATEGORIES.find(c => c.id === t.category)?.icon || (isDebit ? '💸' : '💰')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.txMain} onPress={() => openEditModal(t)} activeOpacity={0.6}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' }}>
                      <Text style={[styles.txDesc, { color: theme.text, flexShrink: 1 }]} numberOfLines={1}>
                        {t.description || t.category}
                      </Text>
                      {(t.source === 'sms_bank' || t.source === 'sms_bank_recurring') && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#5856D620' }}>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: '#5856D6', letterSpacing: 0.5 }}>SMS</Text>
                        </View>
                      )}
                      {t.source === 'sms_bank_recurring' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#FF950020' }}>
                          <Repeat size={9} color="#FF9500" />
                          <Text style={{ fontSize: 9, fontWeight: '900', color: '#FF9500', letterSpacing: 0.5 }}>RECUR</Text>
                        </View>
                      )}
                      {t.source === 'balance_adjustment' && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: '#8E8E9320' }}>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: '#8E8E93', letterSpacing: 0.5 }}>ADJ</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.txDate, { color: theme.tabIconDefault }]}>
                      {t.transaction_date ? format(new Date(t.transaction_date), 'MMM d, yyyy') : format(new Date(t.created_at), 'MMM d, yyyy')} · {t.category || 'Misc'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.txEnd}>
                    <Text style={[styles.txAmt, { color: isDebit ? '#FF3B30' : '#34C759' }]}>
                      {isDebit ? '-' : '+'}₹{t.amount.toLocaleString()}
                    </Text>
                    <TouchableOpacity onPress={() => deleteTransaction(t.id)} onLongPress={() => deleteTransaction(t.id)} delayLongPress={350}>
                      <Trash2 color={theme.tabIconDefault} size={14} />
                    </TouchableOpacity>
                  </View>
                </MotiView>
              );
            })}
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
              <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => { setShowAddModal(false); setEditTxnId(null); setEditOriginal(null); }} />
              <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card }]}>
                <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: theme.text }]}>{editTxnId ? 'Edit Entry' : 'New Entry'}</Text><TouchableOpacity onPress={() => { setShowAddModal(false); setEditTxnId(null); setEditOriginal(null); }}><X color={theme.text} size={24} /></TouchableOpacity></View>
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
                  Setting your own initial balance ({displayName(currentUserName).toUpperCase()}). Partner sets theirs on their own device.
                </Text>
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
                  
                  <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginTop: 15 }]}>KIND</Text>
                  <View style={[styles.freqRow, { flexWrap: 'wrap' }]}>
                    {[
                      { k: 'period_overall',  label: 'OVERALL CAP' },
                      { k: 'period_category', label: 'CATEGORY CAP' },
                      { k: 'single_txn',      label: 'SINGLE-TXN CAP' },
                      { k: 'velocity',        label: 'TXN COUNT CAP' },
                    ].map(({ k, label }) => (
                      <TouchableOpacity key={k} onPress={() => setTargetKind(k as any)} style={[styles.freqBtn, { backgroundColor: theme.background }, targetKind === k && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.freqLabel, { color: targetKind === k ? '#FFF' : theme.text, fontSize: 10 }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {targetKind === 'period_category' && (
                    <>
                      <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginTop: 15 }]}>CATEGORY</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                        {ALL_CATEGORIES.map(c => (
                          <TouchableOpacity key={c} onPress={() => setTargetCategory(c)} style={[styles.freqBtn, { backgroundColor: targetCategory === c ? theme.tint : theme.background }]}>
                            <Text style={{ color: targetCategory === c ? '#FFF' : theme.text, fontSize: 11, fontWeight: '800' }}>{CATEGORY_META[c].emoji} {c}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </>
                  )}

                  <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginTop: 15 }]}>PERIOD</Text>
                  <View style={[styles.freqRow, { flexWrap: 'wrap' }]}>
                    {['daily', 'weekly', 'monthly', 'yearly', 'custom'].map(p => (
                      <TouchableOpacity key={p} onPress={() => setTargetPeriod(p as any)} style={[styles.freqBtn, { backgroundColor: theme.background }, targetPeriod === p && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.freqLabel, { color: targetPeriod === p ? '#FFF' : theme.text }]}>{p.toUpperCase()}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={[styles.inputLabel, { color: theme.tabIconDefault, marginTop: 15 }]}>ALERT WHEN</Text>
                  <View style={[styles.freqRow, { flexWrap: 'wrap' }]}>
                    {[
                      { pct: 0.5, label: '50%' },
                      { pct: 0.8, label: '80%' },
                      { pct: 1.0, label: '100%' },
                    ].map(({ pct, label }) => (
                      <TouchableOpacity key={pct} onPress={() => setTargetThresholdPct(pct)} style={[styles.freqBtn, { backgroundColor: theme.background }, targetThresholdPct === pct && { backgroundColor: theme.tint }]}>
                        <Text style={[styles.freqLabel, { color: targetThresholdPct === pct ? '#FFF' : theme.text }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={() => setTargetRecurring(r => !r)}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, marginTop: 10 }}
                  >
                    <Text style={{ color: theme.text, fontSize: 13, fontWeight: '700' }}>Auto-recur after period ends</Text>
                    <View style={{ width: 40, height: 24, borderRadius: 12, padding: 2, backgroundColor: targetRecurring ? theme.tint : theme.tabIconDefault + '40' }}>
                      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', transform: [{ translateX: targetRecurring ? 16 : 0 }] }} />
                    </View>
                  </TouchableOpacity>

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

      {/* Tap a transaction's icon → pick a new category. The choice is saved
          AND remembered, so the next time same merchant SMS / description
          arrives the app auto-tags it correctly. */}
      {recatTxn && (
        <View style={styles.modalOverlay}>
          <BlurView intensity={60} tint={colorScheme} style={StyleSheet.absoluteFill} />
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setRecatTxn(null)} />
          <View style={[styles.modalContent, { backgroundColor: theme.card, width: '90%', maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]} numberOfLines={1}>Categorise: {recatTxn.description || recatTxn.category}</Text>
              <TouchableOpacity onPress={() => setRecatTxn(null)}><X color={theme.text} size={24} /></TouchableOpacity>
            </View>
            <Text style={{ color: theme.tabIconDefault, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 }}>NEW CATEGORY · TAMTAM WILL REMEMBER THIS</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ALL_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => {
                      if (!currentUserName) return;
                      try {
                        db.runSync(`UPDATE finances SET category = ? WHERE id = ?`, [cat, recatTxn.id]);
                        queueSyncOperation('finances', recatTxn.id, 'UPDATE', { category: cat });
                        learnCategoryRule(currentUserName, recatTxn.description || '', cat);
                        refreshFromSQLite();
                      } catch {}
                      setRecatTxn(null);
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: cat === recatTxn.category ? theme.tint : theme.background }}
                  >
                    <Text style={{ fontSize: 14 }}>{CATEGORY_META[cat].emoji}</Text>
                    <Text style={{ color: cat === recatTxn.category ? '#fff' : theme.text, fontSize: 12, fontWeight: '700' }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {/* SMS Pending Review modal */}
      <Modal visible={showReviewModal} animationType="slide" transparent onRequestClose={() => setShowReviewModal(false)}>
        <View style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, maxHeight: '90%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>SMS Review</Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}><X size={24} color={theme.text} /></TouchableOpacity>
            </View>

            {/* Confidence threshold slider (stepped) */}
            <View style={{ backgroundColor: theme.card, padding: 14, borderRadius: 14, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Sliders size={16} color={theme.tabIconDefault} />
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>Auto-add confidence</Text>
                <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginLeft: 'auto' }}>≥ {Math.round(confidenceThreshold * 100)}%</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {[0.5, 0.6, 0.7, 0.8, 0.9].map(v => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => {
                      setConfidenceThreshold(v);
                      setConfidenceThresholdState(v);
                      if (currentUserName) {
                        processSmsInbox(currentUserName).then(() => {
                          setPendingRows(listPendingReview(currentUserName));
                          setPendingReviewCount(countPendingReview(currentUserName));
                        });
                      }
                    }}
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Math.abs(confidenceThreshold - v) < 0.01 ? theme.tint : theme.card, borderWidth: 1, borderColor: theme.tint + '55', alignItems: 'center' }}
                  >
                    <Text style={{ color: Math.abs(confidenceThreshold - v) < 0.01 ? '#fff' : theme.text, fontWeight: '700', fontSize: 12 }}>{Math.round(v * 100)}%</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: theme.tabIconDefault, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
                Higher = stricter. Lower = more auto-adds, more mistakes for you to discard. Default 70%.
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {pendingRows.length === 0 && (
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <CheckCircle2 size={48} color="#34C759" />
                  <Text style={{ color: theme.text, marginTop: 12, fontWeight: '700' }}>All clear</Text>
                  <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginTop: 4, textAlign: 'center' }}>No SMS waiting for your decision.</Text>
                </View>
              )}
              {pendingRows.map(row => (
                <View key={row.id} style={{ backgroundColor: theme.card, padding: 14, borderRadius: 14, marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Text style={{ color: theme.tabIconDefault, fontSize: 11, fontWeight: '700' }}>{row.sender || 'unknown'}</Text>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: '#FFB02E33' }}>
                      <Text style={{ color: '#FFB02E', fontSize: 10, fontWeight: '800' }}>{Math.round((row.confidence || 0) * 100)}%</Text>
                    </View>
                    {row.parsed_direction && (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: row.parsed_direction === 'credit' ? '#34C75933' : '#FF3B3033' }}>
                        <Text style={{ color: row.parsed_direction === 'credit' ? '#34C759' : '#FF3B30', fontSize: 10, fontWeight: '800' }}>{row.parsed_direction.toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                  {row.parsed_amount != null && (
                    <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
                      ₹{row.parsed_amount.toLocaleString()} {row.parsed_merchant ? `→ ${row.parsed_merchant}` : ''}
                    </Text>
                  )}
                  <Text style={{ color: theme.tabIconDefault, fontSize: 12, marginBottom: 10 }} numberOfLines={3}>{row.body}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (currentUserName) {
                          approvePendingReview(row.id, currentUserName);
                          setPendingRows(listPendingReview(currentUserName));
                          setPendingReviewCount(countPendingReview(currentUserName));
                          fetchTransactions(true);
                        }
                      }}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#34C759', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <CheckCircle2 size={16} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '700' }}>Add</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        discardPendingReview(row.id);
                        if (currentUserName) {
                          setPendingRows(listPendingReview(currentUserName));
                          setPendingReviewCount(countPendingReview(currentUserName));
                        }
                      }}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FF3B30', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <XCircle size={16} color="#fff" />
                      <Text style={{ color: '#fff', fontWeight: '700' }}>Discard</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (!currentUserName) return;
                        Alert.alert(
                          'Block sender?',
                          `Future SMS from "${row.sender || 'unknown'}" will be auto-marked spam.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Block', style: 'destructive', onPress: () => {
                              blockSender(currentUserName, row.sender || '');
                              setPendingRows(listPendingReview(currentUserName));
                              setPendingReviewCount(countPendingReview(currentUserName));
                            }},
                          ]
                        );
                      }}
                      style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: theme.card, borderWidth: 1, borderColor: '#FF3B3066', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Ban size={16} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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