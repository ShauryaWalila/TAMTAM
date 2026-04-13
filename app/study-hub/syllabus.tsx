import React, { useState, useEffect, useMemo, memo } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform, Dimensions,Modal } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import * as SecureStore from 'expo-secure-store';
import { ChevronLeft, Plus, Trash2, ChevronDown, ChevronRight, Circle, PlayCircle, CheckCircle2, Sparkles, Edit3, X, Search, BookOpen, Layers, Microscope, BookText } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Layout, FadeIn, FadeOut } from 'react-native-reanimated';
import { MotiView, AnimatePresence } from 'moti';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
type SyllabusStatus = 'none' | 'touched' | 'done' | 'revised';

interface SyllabusItem {
  id: string;
  parent_id: string | null;
  title: string;
  theory_status: SyllabusStatus;
  practical_status: SyllabusStatus;
  theory_last_reviewed?: string;
  practical_last_reviewed?: string;
  user_id: string;
  order_index: number;
  created_at: string;
}

const STATUS_CONFIG = {
  none: { icon: Circle, color: '#8E8E93', next: 'touched' },
  touched: { icon: PlayCircle, color: '#FF9500', next: 'done' },
  done: { icon: CheckCircle2, color: '#34C759', next: 'revised' },
  revised: { icon: Sparkles, color: '#AF52DE', next: 'none' },
};

const SyllabusNode = memo(({ 
  item, 
  allNodes, 
  level, 
  isEditMode, 
  onToggleStatus, 
  onAddSubtopic, 
  onDelete, 
  theme,
  isSearching,
  expandedIds
}: { 
  item: SyllabusItem, 
  allNodes: SyllabusItem[], 
  level: number, 
  isEditMode: boolean, 
  onToggleStatus: (id: string, type: 'theory' | 'practical', current: SyllabusStatus) => void,
  onAddSubtopic: (parentId: string) => void,
  onDelete: (id: string) => void,
  theme: any,
  isSearching: boolean,
  expandedIds: Set<string>
}) => {
  const children = useMemo(() => 
    allNodes.filter(n => n.parent_id === item.id).sort((a, b) => a.order_index - b.order_index),
    [allNodes, item.id]
  );
  
  const [internalExpanded, setInternalExpanded] = useState(level < 1);
  const isExpanded = isSearching ? expandedIds.has(item.id) : internalExpanded;
  const hasChildren = children.length > 0;

  const tStatus = item.theory_status || 'none';
  const pStatus = item.practical_status || 'none';

  const TIcon = STATUS_CONFIG[tStatus].icon;
  const PIcon = STATUS_CONFIG[pStatus].icon;

  const progress = useMemo(() => {
    if (!hasChildren) return null;
    // Calculate progress based on leaf nodes below this parent
    const getLeafNodes = (parentId: string): SyllabusItem[] => {
      const nodes = allNodes.filter(n => n.parent_id === parentId);
      let leaves: SyllabusItem[] = [];
      nodes.forEach(n => {
        const subChildren = allNodes.filter(child => child.parent_id === n.id);
        if (subChildren.length === 0) leaves.push(n);
        else leaves = [...leaves, ...getLeafNodes(n.id)];
      });
      return leaves;
    };

    const leaves = getLeafNodes(item.id);
    if (leaves.length === 0) return 0;
    const totalChecks = leaves.length * 2; // Each leaf has Theory + Practical
    const completedChecks = leaves.reduce((acc, curr) => {
      let count = 0;
      if (curr.theory_status === 'done' || curr.theory_status === 'revised') count++;
      if (curr.practical_status === 'done' || curr.practical_status === 'revised') count++;
      return acc + count;
    }, 0);
    return Math.round((completedChecks / totalChecks) * 100);
  }, [allNodes, item.id, hasChildren]);

  return (
    <Animated.View entering={FadeIn} layout={Layout.springify()} style={[styles.nodeContainer, { marginLeft: level > 0 ? 16 : 0 }]}>
      <View style={[styles.nodeRow, level === 0 && styles.rootNode, { backgroundColor: level === 0 ? theme.card : 'transparent' }]}>
        <TouchableOpacity 
          style={styles.chevron} 
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setInternalExpanded(!internalExpanded); }}
          disabled={!hasChildren || isSearching}
        >
          {hasChildren && !isSearching && (
            isExpanded ? <ChevronDown size={18} color={theme.tabIconDefault} /> : <ChevronRight size={18} color={theme.tabIconDefault} />
          )}
          {isSearching && hasChildren && <View style={styles.dotIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.titleContainer} 
          onPress={() => hasChildren ? setInternalExpanded(!internalExpanded) : null}
          activeOpacity={0.7}
        >
          <Text style={[styles.nodeTitle, { color: theme.text, fontSize: level === 0 ? 17 : 15, fontWeight: level === 0 ? '800' : '600' }]} numberOfLines={1}>
            {item.title}
          </Text>
          {progress !== null && (
            <View style={[styles.miniBadge, { backgroundColor: progress === 100 ? '#34C75920' : theme.background }]}>
              <Text style={[styles.miniBadgeText, { color: progress === 100 ? '#34C759' : theme.tabIconDefault }]}>{progress}%</Text>
            </View>
          )}
        </TouchableOpacity>

        {isEditMode ? (
          <View style={styles.editActions}>
            <TouchableOpacity onPress={() => onAddSubtopic(item.id)} style={styles.actionBtn}><Plus size={18} color={theme.tint} /></TouchableOpacity>
            <TouchableOpacity onPress={() => onDelete(item.id)} style={styles.actionBtn}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity>
          </View>
        ) : !hasChildren && (
          <View style={styles.dualStatusRow}>
            {/* Theory Toggle */}
            <TouchableOpacity onPress={() => onToggleStatus(item.id, 'theory', tStatus)} style={styles.statusBox}>
              <Text style={styles.statusLabel}>T</Text>
              <TIcon size={18} color={STATUS_CONFIG[tStatus].color} />
            </TouchableOpacity>
            
            <View style={styles.divider} />

            {/* Practical Toggle */}
            <TouchableOpacity onPress={() => onToggleStatus(item.id, 'practical', pStatus)} style={styles.statusBox}>
              <Text style={styles.statusLabel}>P</Text>
              <PIcon size={18} color={STATUS_CONFIG[pStatus].color} />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {isExpanded && hasChildren && (
        <View style={styles.childrenWrapper}>
          <View style={[styles.lineage, { backgroundColor: theme.tabIconDefault + '30' }]} />
          <View style={{ flex: 1 }}>
            {children.map(child => (
              <SyllabusNode 
                key={child.id} 
                item={child} 
                allNodes={allNodes} 
                level={level + 1} 
                isEditMode={isEditMode}
                onToggleStatus={onToggleStatus}
                onAddSubtopic={onAddSubtopic}
                onDelete={onDelete}
                theme={theme}
                isSearching={isSearching}
                expandedIds={expandedIds}
              />
            ))}
          </View>
        </View>
      )}
    </Animated.View>
  );
});

export default function SyllabusTracker() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];

  const [nodes, setNodes] = useState<SyllabusItem[]>([]);
  const [currentUser, setCurrentUser] = useState<string>('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [targetParentId, setTargetParentId] = useState<string | null>(null);

  useEffect(() => { init(); }, []);

  const init = async () => {
    const name = await SecureStore.getItemAsync('user_name');
    if (name) { setCurrentUser(name.toLowerCase()); loadSyllabus(); }
  };

  const loadSyllabus = () => {
    try {
      const data = db.getAllSync(`SELECT * FROM study_syllabus ORDER BY order_index ASC`) as SyllabusItem[];
      setNodes(data || []);
    } catch (e) {}
  };

  const { filteredNodes, expandedIds } = useMemo(() => {
    if (!searchQuery.trim()) return { filteredNodes: nodes, expandedIds: new Set<string>() };
    const query = searchQuery.toLowerCase();
    const matches = nodes.filter(n => n.title.toLowerCase().includes(query));
    const resultIds = new Set<string>();
    const toExpand = new Set<string>();
    const includeWithParents = (node: SyllabusItem) => {
      resultIds.add(node.id);
      if (node.parent_id) {
        toExpand.add(node.parent_id);
        const parent = nodes.find(n => n.id === node.parent_id);
        if (parent) includeWithParents(parent);
      }
    };
    matches.forEach(includeWithParents);
    return { filteredNodes: nodes.filter(n => resultIds.has(n.id)), expandedIds: toExpand };
  }, [nodes, searchQuery]);

  const rootNodes = useMemo(() => filteredNodes.filter(n => !n.parent_id).sort((a, b) => a.order_index - b.order_index), [filteredNodes]);

  const toggleStatus = (id: string, type: 'theory' | 'practical', currentStatus: SyllabusStatus) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextStatus = STATUS_CONFIG[currentStatus].next as SyllabusStatus;
    const now = new Date().toISOString();
    
    const updateObj: any = {};
    if (type === 'theory') {
      updateObj.theory_status = nextStatus;
      updateObj.theory_last_reviewed = now;
    } else {
      updateObj.practical_status = nextStatus;
      updateObj.practical_last_reviewed = now;
    }

    setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updateObj } : n));
    
    try {
      const query = type === 'theory' 
        ? `UPDATE study_syllabus SET theory_status = ?, theory_last_reviewed = ? WHERE id = ?`
        : `UPDATE study_syllabus SET practical_status = ?, practical_last_reviewed = ? WHERE id = ?`;
      db.runSync(query, [nextStatus, now, id]);
      queueSyncOperation('study_syllabus', id, 'UPDATE', updateObj);
    } catch (e) {}
  };

  const handleAddItem = () => {
    if (!newItemTitle.trim()) return;
    const newItem: SyllabusItem = { 
      id: generateUUID(), 
      parent_id: targetParentId, 
      title: newItemTitle.trim(), 
      theory_status: 'none', 
      practical_status: 'none',
      user_id: currentUser, 
      order_index: nodes.filter(n => n.parent_id === targetParentId).length, 
      created_at: new Date().toISOString() 
    };
    db.runSync(`INSERT INTO study_syllabus (id, parent_id, title, theory_status, practical_status, user_id, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [newItem.id, newItem.parent_id, newItem.title, newItem.theory_status, newItem.practical_status, newItem.user_id, newItem.order_index, newItem.created_at]);
    queueSyncOperation('study_syllabus', newItem.id, 'INSERT', newItem);
    setNodes(prev => [...prev, newItem]); setIsAddModalVisible(false); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = (id: string) => {
    const getDescendants = (pId: string): string[] => {
      const children = nodes.filter(n => n.parent_id === pId).map(n => n.id);
      let desc = [...children];
      children.forEach(c => { desc = [...desc, ...getDescendants(c)]; });
      return desc;
    };
    const ids = [id, ...getDescendants(id)];
    Alert.alert("Delete Topic?", `Permanently remove this and ${ids.length - 1} subtopics?`, [
      { text: "Cancel" },
      { text: "Delete", style: "destructive", onPress: () => {
        db.withTransactionSync(() => { ids.forEach(delId => { db.runSync(`DELETE FROM study_syllabus WHERE id = ?`, [delId]); queueSyncOperation('study_syllabus', delId, 'DELETE', {}); }); });
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
      }}
    ]);
  };

  const overallProgress = useMemo(() => {
    const leafNodes = nodes.filter(item => !nodes.some(s => s.parent_id === item.id));
    if (leafNodes.length === 0) return 0;
    const totalChecks = leafNodes.length * 2;
    const completedChecks = leafNodes.reduce((acc, curr) => {
      let count = 0;
      if (curr.theory_status === 'done' || curr.theory_status === 'revised') count++;
      if (curr.practical_status === 'done' || curr.practical_status === 'revised') count++;
      return acc + count;
    }, 0);
    return Math.round((completedChecks / totalChecks) * 100);
  }, [nodes]);

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.title, { color: theme.text }]}>Syllabus</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{overallProgress}% Mastered (T+P)</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => { setIsSearchVisible(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={styles.headerBtn}><Search size={20} color={theme.text} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setIsEditMode(!isEditMode)} style={[styles.headerBtn, isEditMode && { backgroundColor: theme.tint }]}>{isEditMode ? <CheckCircle2 size={20} color="#fff" /> : <Edit3 size={20} color={theme.text} />}</TouchableOpacity>
          </View>
        </View>

        <AnimatePresence>
          {isSearchVisible && (
            <MotiView from={{ opacity: 0, height: 0, marginTop: 0 }} animate={{ opacity: 1, height: 46, marginTop: 10 }} exit={{ opacity: 0, height: 0, marginTop: 0 }} style={[styles.searchBar, { backgroundColor: theme.card }]}>
              <Search size={18} color={theme.tabIconDefault} />
              <TextInput style={[styles.searchInput, { color: theme.text }]} placeholder="Search subjects or chapters..." placeholderTextColor={theme.tabIconDefault} value={searchQuery} onChangeText={setSearchQuery} autoFocus />
              <TouchableOpacity onPress={() => { setIsSearchVisible(false); setSearchQuery(''); }} style={styles.closeSearch}><X size={18} color={theme.text} /></TouchableOpacity>
            </MotiView>
          )}
        </AnimatePresence>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {rootNodes.map(root => (
          <SyllabusNode key={root.id} item={root} allNodes={filteredNodes} level={0} isEditMode={isEditMode} onToggleStatus={toggleStatus} onAddSubtopic={(pid) => { setTargetParentId(pid); setIsAddModalVisible(true); }} onDelete={handleDelete} theme={theme} isSearching={searchQuery.length > 0} expandedIds={expandedIds} />
        ))}
        {nodes.length === 0 && (
          <View style={styles.empty}><Layers size={48} color={theme.tabIconDefault} opacity={0.3} /><Text style={styles.emptyText}>Start your MBBS journey</Text><TouchableOpacity style={[styles.addFirst, { backgroundColor: theme.tint }]} onPress={() => { setTargetParentId(null); setIsAddModalVisible(true); }}><Text style={styles.addFirstText}>Add First Subject</Text></TouchableOpacity></View>
        )}
        {isEditMode && nodes.length > 0 && (
          <TouchableOpacity style={[styles.addRoot, { borderColor: theme.tint }]} onPress={() => { setTargetParentId(null); setIsAddModalVisible(true); }}><Plus size={20} color={theme.tint} /><Text style={{ color: theme.tint, fontWeight: '800' }}>New Subject</Text></TouchableOpacity>
        )}
      </ScrollView>

      {!isEditMode && !searchQuery && (
        <View style={[styles.legend, { backgroundColor: theme.card, paddingBottom: insets.bottom + 10 }]}><View style={styles.legendItem}><Circle size={12} color="#8E8E93" /><Text style={styles.legTxt}>New</Text></View><View style={styles.legendItem}><PlayCircle size={12} color="#FF9500" /><Text style={styles.legTxt}>Touched</Text></View><View style={styles.legendItem}><CheckCircle2 size={12} color="#34C759" /><Text style={styles.legTxt}>Done</Text></View><View style={styles.legendItem}><Sparkles size={12} color="#AF52DE" /><Text style={styles.legTxt}>Revised</Text></View></View>
      )}

      <Modal visible={isAddModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}><View style={[styles.modalContent, { backgroundColor: theme.card }]}><View style={styles.mHeader}><Text style={[styles.mTitle, { color: theme.text }]}>{targetParentId ? 'Add Subtopic' : 'Add Subject'}</Text><TouchableOpacity onPress={() => setIsAddModalVisible(false)}><X size={24} color={theme.text} /></TouchableOpacity></View><TextInput style={[styles.input, { backgroundColor: theme.background, color: theme.text }]} placeholder="Topic Title..." value={newItemTitle} onChangeText={setNewItemTitle} autoFocus /><TouchableOpacity onPress={handleAddItem} style={[styles.saveBtn, { backgroundColor: theme.tint }]}><Text style={styles.saveBtnText}>Add Topic</Text></TouchableOpacity></View></KeyboardAvoidingView></View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  headerTop: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontWeight: '700' },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, borderRadius: 14, overflow: 'hidden' },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, fontWeight: '600' },
  closeSearch: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20, paddingBottom: 150 },
  nodeContainer: { marginVertical: 4 },
  nodeRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  rootNode: { borderRadius: 18, padding: 6, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 10, elevation: 2 },
  chevron: { width: 32, height: 40, justifyContent: 'center', alignItems: 'center' },
  titleContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  nodeTitle: { flexShrink: 1 },
  miniBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  miniBadgeText: { fontSize: 9, fontWeight: '900' },
  
  // DUAL STATUS STYLES
  dualStatusRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 4 },
  statusBox: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 2, minWidth: 35 },
  statusLabel: { fontSize: 8, fontWeight: '900', color: '#888', marginBottom: 2 },
  divider: { width: 1, height: 20, backgroundColor: 'rgba(0,0,0,0.05)' },

  editActions: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.03)', justifyContent: 'center', alignItems: 'center' },
  childrenWrapper: { flexDirection: 'row' },
  lineage: { width: 1.5, marginLeft: 15, marginRight: 15, borderRadius: 1 },
  dotIndicator: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#AF52DE' },
  empty: { flex: 1, alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 16, fontWeight: '700', color: '#888', marginTop: 15 },
  addFirst: { marginTop: 20, paddingHorizontal: 25, paddingVertical: 12, borderRadius: 15 },
  addFirstText: { color: '#fff', fontWeight: '800' },
  addRoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 18, borderRadius: 18, borderStyle: 'dashed', borderWidth: 2, marginTop: 20 },
  legend: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 15, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.05)' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legTxt: { fontSize: 11, fontWeight: '800', color: '#888' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { padding: 30, borderTopLeftRadius: 40, borderTopRightRadius: 40, gap: 20 },
  mHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mTitle: { fontSize: 22, fontWeight: '900' },
  input: { padding: 20, borderRadius: 20, fontSize: 16, fontWeight: '600' },
  saveBtn: { height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  saveBtnText: { color: 'white', fontSize: 18, fontWeight: '900' }
});
