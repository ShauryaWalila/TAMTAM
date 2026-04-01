import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert, Dimensions, Pressable, Keyboard } from 'react-native';
import { Plus, X, Trash2, ArrowDownCircle, ArrowUpCircle, ReceiptText, Wallet, TrendingUp, Heart, User, Users, Tags, Sparkles, Download, RotateCcw } from 'lucide-react-native';
import { format } from 'date-fns';
import { MotiView, AnimatePresence } from 'moti';
import { BarChart } from "react-native-gifted-charts";
import * as SecureStore from 'expo-secure-store';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as LocalAuthentication from 'expo-local-authentication';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width } = Dimensions.get('window');
const COLUMN_WIDTH = (width - 60) / 2;

interface TripFinanceProps {
  tripId: string;
  trip: any;
  onClose: () => void;
}

const CATEGORIES = [
  { id: 'Food', icon: '🍲', color: '#FF9500' },
  { id: 'Travel', icon: '✈️', color: '#007AFF' },
  { id: 'Shopping', icon: '🛍️', color: '#AF52DE' },
  { id: 'Hotel', icon: '🏨', color: '#FFCC00' },
  { id: 'Activity', icon: '🎢', color: '#5856D6' },
  { id: 'Other', icon: '✨', color: '#8E8E93' },
];

export default function TripFinance({ tripId, trip, onClose }: TripFinanceProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const isDark = colorScheme === 'dark';

  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<'me' | 'partner' | 'both'>('both');
  const [showAnalytics, setShowAnalytics] = useState(true);

  // Trip Balances
  const [myStartBalance, setMyStartBalance] = useState<number | null>(null);
  const [partnerStartBalance, setPartnerStartBalance] = useState<number | null>(null);
  const [showStartBalanceModal, setShowStartBalanceModal] = useState(false);
  const [editStartBalance, setEditStartBalance] = useState('');

  // Form State
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [category, setCategory] = useState('Other');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
      promptMessage: 'Sign in to view Trip Finances',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      setIsAuthenticated(true);
    } else {
      Alert.alert('Auth Failed', 'Cannot show finances without authentication.', [
        { text: 'Retry', onPress: authenticate },
        { text: 'Cancel', style: 'cancel', onPress: onClose }
      ]);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    init();
    const sub = supabase.channel(`trip-finances-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finances', filter: `trip_id=eq.${tripId}` }, () => fetchTransactions())
      .subscribe();
      
    const subBalances = supabase.channel(`trip-balances-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_balances', filter: `trip_id=eq.${tripId}` }, () => {
        if (currentUserName && otherUserName) fetchBalances(currentUserName, otherUserName);
      })
      .subscribe();
      
    return () => { 
      supabase.removeChannel(sub); 
      supabase.removeChannel(subBalances);
    };
  }, [tripId, currentUserName, otherUserName, isAuthenticated]);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    setCurrentUserName(name);
    const other = name?.toLowerCase() === 'pratishth' ? 'love' : 'pratishth';
    setOtherUserName(other);
    
    if (name && other) {
      fetchBalances(name, other);
    }
    
    fetchTransactions();
  };

  const fetchBalances = async (me: string, partner: string) => {
    const { data: myData } = await supabase.from('trip_balances').select('start_balance').eq('trip_id', tripId).eq('user_id', me.toLowerCase()).single();
    if (myData) {
      setMyStartBalance(myData.start_balance);
    } else {
      setMyStartBalance(null);
      setShowStartBalanceModal(true);
    }
    
    const { data: pData } = await supabase.from('trip_balances').select('start_balance').eq('trip_id', tripId).eq('user_id', partner.toLowerCase()).single();
    if (pData) setPartnerStartBalance(pData.start_balance);
  };

  const fetchTransactions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('finances')
      .select('*')
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false });
    if (data) setTransactions(data);
    setLoading(false);
  };

  const handleSave = async () => {
    if (!amount || isNaN(parseFloat(amount)) || !currentUserName) return;
    setIsSaving(true);
    const { error } = await supabase.from('finances').insert([{
      trip_id: tripId,
      amount: parseFloat(amount),
      type,
      category,
      description: description.trim(),
      payer_id: currentUserName.toLowerCase()
    }]);
    if (!error) {
      setShowAddModal(false);
      setAmount('');
      setDescription('');
    } else {
      Alert.alert('Error', 'Could not save transaction');
    }
    setIsSaving(false);
  };

  const handleSaveStartBalance = async () => {
    if (!currentUserName) return;
    const targetUser = userFilter === 'me' ? currentUserName : userFilter === 'partner' ? otherUserName : currentUserName;
    if (!targetUser) return;
    
    setIsSaving(true);
    const { error } = await supabase.from('trip_balances').upsert({
      trip_id: tripId,
      user_id: targetUser.toLowerCase(),
      start_balance: parseFloat(editStartBalance) || 0
    });
    
    if (!error) {
      if (targetUser.toLowerCase() === currentUserName.toLowerCase()) setMyStartBalance(parseFloat(editStartBalance) || 0);
      else setPartnerStartBalance(parseFloat(editStartBalance) || 0);
      setShowStartBalanceModal(false);
    } else {
      Alert.alert('Error', 'Could not save starting money');
    }
    setIsSaving(false);
  };

  const deleteTransaction = async (id: string) => {
    Alert.alert('Delete?', 'Remove this record?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => await supabase.from('finances').delete().eq('id', id) }
    ]);
  };

  const filteredTransactions = useMemo(() => {
    if (userFilter === 'both') return transactions;
    const target = userFilter === 'me' ? currentUserName : otherUserName;
    return transactions.filter(t => t.payer_id === target?.toLowerCase());
  }, [transactions, userFilter, currentUserName, otherUserName]);

  const chartData = useMemo(() => {
    const cats: Record<string, number> = {};
    filteredTransactions.filter(t => t.type === 'debit').forEach(t => {
      cats[t.category] = (cats[t.category] || 0) + t.amount;
    });
    return Object.entries(cats).map(([label, value]) => ({
      value,
      label: label.substring(0, 3),
      frontColor: CATEGORIES.find(c => c.id === label)?.color || theme.tint,
    })).slice(0, 6);
  }, [filteredTransactions, theme.tint]);

  const totalSpent = filteredTransactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalReceived = filteredTransactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

  let currentStartBalance = 0;
  if (userFilter === 'me') currentStartBalance = myStartBalance || 0;
  else if (userFilter === 'partner') currentStartBalance = partnerStartBalance || 0;
  else currentStartBalance = (myStartBalance || 0) + (partnerStartBalance || 0);

  const moneyLeft = currentStartBalance + totalReceived - totalSpent;

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
          <h1>Trip Finance Report - ${trip?.title} (${targetUser?.toUpperCase()})</h1>
          <div class="summary">
            <h3>Summary</h3>
            <p><strong>Starting Money:</strong> ₹${currentStartBalance}</p>
            <p><strong>Total Spent:</strong> ₹${totalSpent}</p>
            <p><strong>Total Received:</strong> ₹${totalReceived}</p>
            <p><strong>Money Left:</strong> ₹${moneyLeft}</p>
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

  if (!isAuthenticated) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={theme.tint} />
        <Text style={{ marginTop: 20, color: theme.text, fontWeight: '600' }}>Waiting for authentication...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerSubtitle, { color: theme.tabIconDefault }]}>FINANCE</Text>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{trip?.title || 'Trip Plan'}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          {userFilter !== 'both' && (
            <TouchableOpacity onPress={exportPDF} style={[styles.secondaryBtn, { borderColor: theme.tint }]}>
              <Download size={14} color={theme.tint} />
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={[styles.secondaryBtn, { borderColor: theme.tint, backgroundColor: showAnalytics ? theme.tint + '10' : 'transparent' }]} 
            onPress={() => setShowAnalytics(!showAnalytics)}
          >
            <TrendingUp size={14} color={theme.tint} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.closeCircle}>
            <X size={20} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listPadding}>
        <AnimatePresence>
          {showAnalytics && (
            <MotiView from={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={styles.analyticsSection}>
              <View style={[styles.analyticsCard, { backgroundColor: theme.card }]}>
                <View style={styles.chartHeader}>
                  <Sparkles size={16} color={theme.tint} />
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Trip Summary</Text>
                  <TouchableOpacity onPress={() => { setEditStartBalance(currentStartBalance.toString()); setShowStartBalanceModal(true); }} style={{ marginLeft: 'auto' }}>
                    <RotateCcw size={14} color={theme.tabIconDefault} />
                  </TouchableOpacity>
                </View>
                
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View>
                    <Text style={styles.totalLabel}>Starting Money</Text>
                    <Text style={[styles.totalAmount, { color: theme.text, fontSize: 18 }]}>₹{currentStartBalance.toLocaleString()}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.totalLabel}>Money Left</Text>
                    <Text style={[styles.totalAmount, { color: theme.tint, fontSize: 18 }]}>₹{moneyLeft.toLocaleString()}</Text>
                  </View>
                </View>
                
                {chartData.length > 0 ? (
                  <BarChart
                    data={chartData}
                    barWidth={35}
                    noOfSections={3}
                    barBorderRadius={6}
                    frontColor={theme.tint}
                    yAxisThickness={0}
                    xAxisThickness={0}
                    hideRules
                    yAxisTextStyle={{ color: '#888', fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: '#888', fontSize: 10 }}
                    height={120}
                  />
                ) : (
                  <View style={styles.emptyChart}><TrendingUp size={40} color="#ccc" opacity={0.3} /><Text style={{ color: '#aaa' }}>No data yet</Text></View>
                )}

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Spent</Text>
                  <Text style={[styles.totalAmount, { color: theme.text }]}>₹{totalSpent.toLocaleString()}</Text>
                </View>
              </View>
            </MotiView>
          )}
        </AnimatePresence>

        <View style={[styles.filterBar, { backgroundColor: theme.card }]}>
          <TouchableOpacity onPress={() => setUserFilter('me')} style={[styles.filterOption, userFilter === 'me' && { backgroundColor: theme.tint }]}><User color={userFilter === 'me' ? '#FFF' : '#888'} size={14} /><Text style={[styles.filterText, { color: userFilter === 'me' ? '#FFF' : '#888' }]}>Me</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setUserFilter('both')} style={[styles.filterOption, userFilter === 'both' && { backgroundColor: theme.tint }]}><Users color={userFilter === 'both' ? '#FFF' : '#888'} size={14} /><Text style={[styles.filterText, { color: userFilter === 'both' ? '#FFF' : '#888' }]}>Us</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setUserFilter('partner')} style={[styles.filterOption, userFilter === 'partner' && { backgroundColor: theme.tint }]}><Heart color={userFilter === 'partner' ? '#FFF' : '#888'} size={14} /><Text style={[styles.filterText, { color: userFilter === 'partner' ? '#FFF' : '#888' }]}>Love</Text></TouchableOpacity>
        </View>

        <View style={styles.txGrid}>
          {loading ? <ActivityIndicator style={{ marginTop: 20 }} color={theme.tint} /> : 
            filteredTransactions.map((t, i) => (
              <MotiView key={t.id} from={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 50 }} style={[styles.txCard, { backgroundColor: theme.card }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.txIcon, { backgroundColor: theme.tint + '10' }]}><Text style={{ fontSize: 18 }}>{CATEGORIES.find(c => c.id === t.category)?.icon || '✨'}</Text></View>
                  <TouchableOpacity onPress={() => deleteTransaction(t.id)} style={styles.deleteBtn}><Trash2 color="#FF3B30" size={14} opacity={0.5} /></TouchableOpacity>
                </View>
                <Text style={[styles.txAmt, { color: t.type === 'debit' ? '#FF3B30' : '#34C759' }]}>{t.type === 'debit' ? '-' : '+'}₹{t.amount.toLocaleString()}</Text>
                <Text style={[styles.txDesc, { color: theme.text }]} numberOfLines={1}>{t.description || t.category}</Text>
                <Text style={styles.txDate}>{format(new Date(t.created_at), 'MMM d, HH:mm')}</Text>
                <View style={[styles.payerBadge, { backgroundColor: t.payer_id === 'pratishth' ? '#007AFF20' : '#FF2D5520' }]}>
                  <Text style={[styles.payerText, { color: t.payer_id === 'pratishth' ? '#007AFF' : '#FF2D55' }]}>{t.payer_id === 'pratishth' ? 'P' : 'S'}</Text>
                </View>
              </MotiView>
            ))
          }
        </View>
      </ScrollView>

      <TouchableOpacity onPress={() => setShowAddModal(true)} style={[styles.addFab, { backgroundColor: theme.tint }]}><Plus color="white" size={28} /></TouchableOpacity>

      <AnimatePresence>
        {showAddModal && (
          <MotiView key="addModal" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} />
            <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Add Expense</Text>
                <TouchableOpacity onPress={() => setShowAddModal(false)} style={styles.closeCircle}><X color={theme.text} size={20} /></TouchableOpacity>
              </View>
              <View style={styles.typeSwitch}>
                <TouchableOpacity onPress={() => setType('debit')} style={[styles.typeOption, type === 'debit' && { backgroundColor: '#FF3B30' }]}><Text style={{ color: type === 'debit' ? '#FFF' : '#888', fontWeight: 'bold' }}>Spent</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setType('credit')} style={[styles.typeOption, type === 'credit' && { backgroundColor: '#34C759' }]}><Text style={{ color: type === 'credit' ? '#FFF' : '#888', fontWeight: 'bold' }}>Received</Text></TouchableOpacity>
              </View>
              <TextInput 
                style={[styles.bigInput, { color: theme.text }]} 
                placeholder="₹ 0.00" 
                keyboardType="numeric" 
                value={amount} 
                onChangeText={setAmount} 
                autoFocus 
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <TextInput style={[styles.smallInput, { color: theme.text, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }]} placeholder="What was this for?..." value={description} onChangeText={setDescription} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 15 }}>
                {CATEGORIES.map(c => <TouchableOpacity key={c.id} onPress={() => setCategory(c.id)} style={[styles.catPill, { backgroundColor: theme.background }, category === c.id && { backgroundColor: theme.tint }]}><Text>{c.icon}</Text><Text style={{ color: category === c.id ? '#FFF' : theme.text, marginLeft: 6, fontWeight: '600' }}>{c.id}</Text></TouchableOpacity>)}
              </ScrollView>
              <TouchableOpacity onPress={handleSave} disabled={isSaving} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>{isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save Record</Text>}</TouchableOpacity>
            </MotiView>
          </MotiView>
        )}

        {showStartBalanceModal && (
          <MotiView key="startBalanceModal" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} />
            <MotiView from={{ translateY: 300 }} animate={{ translateY: 0 }} style={[styles.modalContent, { backgroundColor: theme.card }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Starting Money</Text>
                {myStartBalance !== null && (
                  <TouchableOpacity onPress={() => setShowStartBalanceModal(false)} style={styles.closeCircle}><X color={theme.text} size={20} /></TouchableOpacity>
                )}
              </View>
              <Text style={{ color: theme.tabIconDefault, marginBottom: 20, fontSize: 13, lineHeight: 18 }}>
                How much money is {userFilter === 'me' ? currentUserName?.toUpperCase() : userFilter === 'partner' ? otherUserName?.toUpperCase() : 'everyone'} starting this trip with?
              </Text>
              <TextInput 
                style={[styles.bigInput, { color: theme.text, marginBottom: 20 }]} 
                placeholder="₹ 0.00" 
                keyboardType="numeric" 
                value={editStartBalance} 
                onChangeText={setEditStartBalance} 
                autoFocus 
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
              />
              <TouchableOpacity onPress={handleSaveStartBalance} disabled={isSaving} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
                {isSaving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Set Starting Money</Text>}
              </TouchableOpacity>
            </MotiView>
          </MotiView>
        )}
      </AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, paddingTop: 80 },
  headerSubtitle: { fontSize: 8, fontWeight: '900', letterSpacing: 1.5 },
  headerTitle: { fontSize: 24, fontWeight: '900' },
  closeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  secondaryBtn: { width: 36, height: 36, borderRadius: 12, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
  listPadding: { paddingHorizontal: 20, paddingBottom: 150 },
  analyticsSection: { overflow: 'hidden', marginBottom: 15 },
  analyticsCard: { padding: 20, borderRadius: 30, elevation: 4, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10 },
  chartHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  emptyChart: { height: 120, justifyContent: 'center', alignItems: 'center' },
  totalRow: { marginTop: 20, paddingTop: 15, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: '#888', fontWeight: '700' },
  totalAmount: { fontSize: 22, fontWeight: '900' },
  filterBar: { flexDirection: 'row', padding: 4, borderRadius: 15, marginBottom: 20 },
  filterOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, gap: 6 },
  filterText: { fontSize: 12, fontWeight: '700' },
  txGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15 },
  txCard: { width: COLUMN_WIDTH, borderRadius: 20, padding: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', elevation: 3, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  txIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  deleteBtn: { padding: 4 },
  txAmt: { fontSize: 18, fontWeight: '900', marginBottom: 4 },
  txDesc: { fontSize: 13, fontWeight: '700' },
  txDate: { fontSize: 10, color: '#aaa', marginTop: 2 },
  payerBadge: { position: 'absolute', bottom: 10, right: 10, width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center' },
  payerText: { fontSize: 9, fontWeight: '900' },
  addFab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 8 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 40, borderTopRightRadius: 40, padding: 30 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 22, fontWeight: '900' },
  typeSwitch: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.05)', padding: 4, borderRadius: 15, marginBottom: 20 },
  typeOption: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
  bigInput: { fontSize: 40, fontWeight: '900', textAlign: 'center', marginVertical: 15 },
  smallInput: { fontSize: 16, fontWeight: '600', padding: 15, borderRadius: 15 },
  catPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 12, marginRight: 10 },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '800' }
});