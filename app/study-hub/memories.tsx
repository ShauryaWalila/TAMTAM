import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Alert } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Plus, Trash2, X, Bookmark, AlertTriangle, Star, Calendar, Sparkles } from 'lucide-react-native';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { listMemories, addMemory, deleteMemory, MemoryKind, Memory } from '@/lib/studyMemories';

const KIND_META: { kind: MemoryKind; label: string; icon: any; color: string }[] = [
  { kind: 'pinned_answer', label: 'Pinned answer', icon: Star, color: '#FFD60A' },
  { kind: 'fact', label: 'Fact', icon: Bookmark, color: '#AF52DE' },
  { kind: 'preference', label: 'Preference', icon: Sparkles, color: '#5AC8FA' },
  { kind: 'weak_topic', label: 'Weak topic', icon: AlertTriangle, color: '#FF3B30' },
  { kind: 'strong_topic', label: 'Strong topic', icon: Star, color: '#34C759' },
  { kind: 'exam_date', label: 'Exam date', icon: Calendar, color: '#FF9500' },
  { kind: 'manual', label: 'Note', icon: Bookmark, color: '#8E8E93' },
];

export default function MemoriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  const [userId, setUserId] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newKind, setNewKind] = useState<MemoryKind>('manual');
  const [newContent, setNewContent] = useState('');

  const refresh = (uid: string) => setMemories(listMemories(uid));

  useEffect(() => {
    SecureStore.getItemAsync('user_name').then(n => {
      const uid = (n || 'doc').toLowerCase();
      setUserId(uid);
      refresh(uid);
    });
  }, []);

  const handleAdd = () => {
    if (!newContent.trim()) return;
    addMemory(newKind, newContent.trim(), userId);
    setNewContent('');
    setAddOpen(false);
    refresh(userId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = (m: Memory) => {
    Alert.alert('Delete memory?', m.content.slice(0, 60), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteMemory(m.id); refresh(userId); } },
    ]);
  };

  const grouped: Record<string, Memory[]> = {};
  memories.forEach(m => { (grouped[m.kind] ||= []).push(m); });

  return (
    <ThemedView style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>Buddy Memory</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{memories.length} long-term facts the buddy uses on every answer</Text>
        </View>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={[styles.iconBtn, { backgroundColor: theme.tint + '15' }]}><Plus size={22} color={theme.tint} /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {KIND_META.map(meta => {
          const list = grouped[meta.kind] || [];
          if (list.length === 0) return null;
          const Icon = meta.icon;
          return (
            <View key={meta.kind} style={{ marginBottom: 22 }}>
              <View style={styles.sectionHeader}>
                <Icon size={14} color={meta.color} />
                <Text style={[styles.sectionTitle, { color: meta.color }]}>{meta.label.toUpperCase()}  ·  {list.length}</Text>
              </View>
              {list.map(m => (
                <View key={m.id} style={[styles.row, { backgroundColor: theme.card }]}>
                  <Text style={[styles.rowText, { color: theme.text }]}>{m.content}</Text>
                  <TouchableOpacity onPress={() => handleDelete(m)} style={styles.delBtn}><Trash2 size={16} color="#FF3B30" /></TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}
        {memories.length === 0 && (
          <Text style={{ color: theme.tabIconDefault, textAlign: 'center', marginTop: 40, fontSize: 13 }}>
            No memories yet. Long-press an AI answer in Med Buddy to pin it, or add manually with +.
          </Text>
        )}
      </ScrollView>

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.addBg}>
          <View style={[styles.addCard, { backgroundColor: theme.background }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.title, { color: theme.text, fontSize: 18 }]}>New Memory</Text>
              <TouchableOpacity onPress={() => setAddOpen(false)}><X size={22} color={theme.tabIconDefault} /></TouchableOpacity>
            </View>
            <Text style={[styles.kindLabel, { color: theme.tabIconDefault }]}>KIND</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
              {KIND_META.map(meta => (
                <TouchableOpacity key={meta.kind} onPress={() => setNewKind(meta.kind)} style={[styles.kindChip, { backgroundColor: newKind === meta.kind ? meta.color : theme.card }]}>
                  <Text style={{ color: newKind === meta.kind ? '#fff' : theme.text, fontWeight: '800', fontSize: 12 }}>{meta.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TextInput
              value={newContent}
              onChangeText={setNewContent}
              placeholder="e.g. PORTAL exam on 2026-08-12. Renal pharma is weak. Prefer mnemonic explanations."
              placeholderTextColor={theme.tabIconDefault}
              multiline
              style={[styles.addInput, { color: theme.text, backgroundColor: theme.card }]}
            />
            <TouchableOpacity onPress={handleAdd} style={[styles.saveBtn, { backgroundColor: theme.tint }]}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  iconBtn: { width: 42, height: 42, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginLeft: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 8 },
  rowText: { flex: 1, fontSize: 14, lineHeight: 20 },
  delBtn: { padding: 6, marginLeft: 10 },
  addBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 22 },
  addCard: { borderRadius: 22, padding: 22, gap: 6 },
  kindLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginTop: 10 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  addInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, minHeight: 100, textAlignVertical: 'top', marginTop: 10 },
  saveBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
});
