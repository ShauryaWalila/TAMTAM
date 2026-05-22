import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, Image, Modal, ActivityIndicator, Dimensions, Alert, TextInput } from 'react-native';
import { Text, View as ThemedView } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Download, Trash2, ExternalLink, X, Wifi, WifiOff, Globe, Plus, Search } from 'lucide-react-native';
import { WebView } from 'react-native-webview';
import { ensureSeeded, listLibrary, listSystems, saveOffline, removeOffline, LibraryItem } from '@/lib/anatomyLibrary';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function AnatomyLibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  const params = useLocalSearchParams<{ from?: string; chatId?: string; focus?: string }>();
  const fromBuddy = params.from === 'buddy';

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [systems, setSystems] = useState<string[]>([]);
  const [activeSystem, setActiveSystem] = useState<string>('All');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<LibraryItem | null>(null);
  const [webview, setWebView] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addSystem, setAddSystem] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addKind, setAddKind] = useState<'image' | 'web' | '3d'>('image');

  const refresh = () => {
    ensureSeeded();
    setItems(listLibrary());
    setSystems(['All', ...listSystems()]);
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (params.focus) setSearch(String(params.focus)); }, [params.focus]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(i => {
      if (activeSystem !== 'All' && i.system !== activeSystem) return false;
      if (!q) return true;
      return (i.title || '').toLowerCase().includes(q) || (i.system || '').toLowerCase().includes(q);
    });
  }, [items, activeSystem, search]);

  const handleAdd = () => {
    if (!addTitle.trim() || !addUrl.trim()) { Alert.alert('Need title + URL'); return; }
    const id = generateUUID();
    const row = {
      id,
      title: addTitle.trim(),
      system: addSystem.trim() || 'Custom',
      url: addUrl.trim(),
      kind: addKind,
      license: 'User-added',
      local_path: null,
      is_offline: 0,
    };
    db.runSync(
      `INSERT INTO anatomy_library (id, title, system, url, kind, license) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.title, row.system, row.url, row.kind, row.license]
    );
    queueSyncOperation('anatomy_library', id, 'INSERT', row);
    setAddTitle(''); setAddSystem(''); setAddUrl(''); setAddKind('image');
    setAddOpen(false);
    refresh();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDeleteItem = (item: LibraryItem) => {
    Alert.alert('Delete entry?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        if (item.local_path) {
          try { /* fire & forget */ } catch {}
        }
        db.runSync(`DELETE FROM anatomy_library WHERE id = ?`, [item.id]);
        queueSyncOperation('anatomy_library', item.id, 'DELETE', {});
        refresh();
      } },
    ]);
  };

  const onToggleOffline = async (item: LibraryItem) => {
    setBusyId(item.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (item.is_offline) await removeOffline(item);
      else await saveOffline(item);
      refresh();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not download.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}><ChevronLeft size={24} color={theme.text} /></TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>Anatomy Library</Text>
          <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>{filtered.length} entries · tap download to keep offline</Text>
        </View>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={[styles.iconBtn, { backgroundColor: theme.tint + '15' }]}>
          <Plus size={22} color={theme.tint} />
        </TouchableOpacity>
      </View>

      <View style={[styles.searchRow, { backgroundColor: theme.card }]}>
        <Search size={16} color={theme.tabIconDefault} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search heart, nephron, brain..."
          placeholderTextColor={theme.tabIconDefault}
          style={[styles.searchInput, { color: theme.text }]}
        />
        {!!search && (
          <TouchableOpacity onPress={() => setSearch('')}><X size={16} color={theme.tabIconDefault} /></TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.systemBar} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {systems.map(s => (
          <TouchableOpacity key={s} onPress={() => setActiveSystem(s)} style={[styles.chip, { backgroundColor: activeSystem === s ? theme.tint : theme.card }]}>
            <Text style={{ color: activeSystem === s ? '#fff' : theme.text, fontWeight: '800', fontSize: 12, letterSpacing: 0.4 }}>{s.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.grid}>
        {filtered.map(item => {
          const isWeb = item.kind === 'web';
          const is3d = item.kind === '3d';
          const src = item.local_path && item.is_offline ? item.local_path : item.url;
          const onCardPress = () => {
            if (isWeb) { setWebView(item.url); return; }
            if (is3d) {
              router.push({ pathname: '/study-hub/model-viewer', params: { url: src, title: item.title } });
              return;
            }
            setViewer(item);
          };
          return (
            <View key={item.id} style={[styles.card, { backgroundColor: theme.card }]}>
              <TouchableOpacity onPress={onCardPress} activeOpacity={0.85}>
                {isWeb ? (
                  <View style={[styles.thumb, { backgroundColor: '#AF52DE22', justifyContent: 'center', alignItems: 'center' }]}>
                    <Globe size={42} color="#AF52DE" />
                    <Text style={{ color: '#AF52DE', marginTop: 8, fontWeight: '800', fontSize: 11, letterSpacing: 1 }}>OPEN 3D PORTAL</Text>
                  </View>
                ) : is3d ? (
                  <View style={[styles.thumb, { backgroundColor: '#1C1C1E', justifyContent: 'center', alignItems: 'center' }]}>
                    <Globe size={42} color="#0AE" />
                    <Text style={{ color: '#0AE', marginTop: 8, fontWeight: '800', fontSize: 11, letterSpacing: 1 }}>INTERACTIVE 3D</Text>
                  </View>
                ) : (
                  <Image source={{ uri: src }} style={styles.thumb} resizeMode="cover" />
                )}
              </TouchableOpacity>
              <View style={{ padding: 10, gap: 4 }}>
                <Text numberOfLines={2} style={[styles.cardTitle, { color: theme.text }]}>{item.title}</Text>
                <Text style={[styles.cardMeta, { color: theme.tabIconDefault }]}>{item.system} · {item.license}</Text>
                <View style={styles.cardActions}>
                  {!isWeb && (
                    <TouchableOpacity onPress={() => onToggleOffline(item)} disabled={busyId === item.id} style={[styles.actionBtn, { backgroundColor: item.is_offline ? '#34C75920' : theme.tint + '20' }]}>
                      {busyId === item.id ? <ActivityIndicator size="small" color={theme.tint} /> : (
                        <>
                          {item.is_offline ? <Download size={14} color="#34C759" /> : <Download size={14} color={theme.tint} />}
                          <Text style={[styles.actionLabel, { color: item.is_offline ? '#34C759' : theme.tint }]}>{item.is_offline ? 'OFFLINE' : 'SAVE'}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                  {isWeb && (
                    <View style={[styles.actionBtn, { backgroundColor: '#FF950020' }]}>
                      <Wifi size={14} color="#FF9500" />
                      <Text style={[styles.actionLabel, { color: '#FF9500' }]}>ONLINE</Text>
                    </View>
                  )}
                  <TouchableOpacity onPress={() => handleDeleteItem(item)} style={[styles.actionBtn, { backgroundColor: '#FF3B3020' }]}>
                    <Trash2 size={14} color="#FF3B30" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Floating "Back to Buddy" chip when entered from a chat */}
      {fromBuddy && (
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/study-hub/buddy', params: params.chatId ? { resume: String(params.chatId) } : {} })}
          style={[styles.backToBuddyChip, { bottom: insets.bottom + 20 }]}
        >
          <Globe size={14} color="#fff" />
          <Text style={styles.backToBuddyText}>Back to Buddy</Text>
        </TouchableOpacity>
      )}

      {/* Full-screen image viewer */}
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewerBg}>
          <TouchableOpacity onPress={() => setViewer(null)} style={[styles.viewerClose, { top: insets.top + 10 }]}>
            <X size={26} color="#fff" />
          </TouchableOpacity>
          {viewer && (
            <View style={styles.viewerContent}>
              <Image
                source={{ uri: viewer.local_path && viewer.is_offline ? viewer.local_path : viewer.url }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
              <View style={styles.viewerCaption}>
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{viewer.title}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 }}>
                  {viewer.system} · {viewer.license} {viewer.is_offline ? '· OFFLINE COPY' : ''}
                </Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Add custom entry */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.addBg}>
          <View style={[styles.addCard, { backgroundColor: theme.background }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={[styles.title, { color: theme.text, fontSize: 18 }]}>Add Reference</Text>
              <TouchableOpacity onPress={() => setAddOpen(false)}><X size={22} color={theme.tabIconDefault} /></TouchableOpacity>
            </View>
            <Text style={[styles.addLabel, { color: theme.tabIconDefault }]}>TITLE</Text>
            <TextInput value={addTitle} onChangeText={setAddTitle} placeholder="e.g. Brachial plexus" placeholderTextColor={theme.tabIconDefault} style={[styles.addInput, { color: theme.text, backgroundColor: theme.card }]} />
            <Text style={[styles.addLabel, { color: theme.tabIconDefault }]}>SYSTEM (Anatomy/Neuro/etc.)</Text>
            <TextInput value={addSystem} onChangeText={setAddSystem} placeholder="Custom" placeholderTextColor={theme.tabIconDefault} style={[styles.addInput, { color: theme.text, backgroundColor: theme.card }]} />
            <Text style={[styles.addLabel, { color: theme.tabIconDefault }]}>URL (image or 3D/web)</Text>
            <TextInput value={addUrl} onChangeText={setAddUrl} placeholder="https://..." placeholderTextColor={theme.tabIconDefault} autoCapitalize="none" keyboardType="url" style={[styles.addInput, { color: theme.text, backgroundColor: theme.card }]} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              {(['image', '3d', 'web'] as const).map(k => (
                <TouchableOpacity key={k} onPress={() => setAddKind(k)} style={[styles.kindChip, { backgroundColor: addKind === k ? theme.tint : theme.card }]}>
                  <Text style={{ color: addKind === k ? '#fff' : theme.text, fontWeight: '800', fontSize: 12 }}>{k.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={handleAdd} style={[styles.addSaveBtn, { backgroundColor: theme.tint }]}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* In-app browser for web/3D entries */}
      <Modal visible={!!webview} animationType="slide" onRequestClose={() => setWebView(null)}>
        <View style={{ flex: 1 }}>
          <View style={[styles.webHeader, { paddingTop: insets.top + 6 }]}>
            <TouchableOpacity onPress={() => setWebView(null)} style={styles.iconBtn}><X size={22} color="#fff" /></TouchableOpacity>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800', flex: 1, marginLeft: 12 }} numberOfLines={1}>{webview}</Text>
          </View>
          {!!webview && (
            <WebView
              source={{ uri: webview }}
              style={{ flex: 1 }}
              userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1"
            />
          )}
        </View>
      </Modal>
    </ThemedView>
  );
}

const CARD_W = (SCREEN_WIDTH - 48) / 2;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  iconBtn: { width: 42, height: 42, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
  title: { fontSize: 22, fontWeight: '900' },
  subtitle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  systemBar: { paddingVertical: 12, maxHeight: 56, flexGrow: 0 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  grid: { padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingBottom: 60 },
  card: { width: CARD_W, borderRadius: 18, overflow: 'hidden', elevation: 2 },
  thumb: { width: '100%', height: CARD_W },
  cardTitle: { fontSize: 13, fontWeight: '800', lineHeight: 16 },
  cardMeta: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  actionLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerClose: { position: 'absolute', right: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  viewerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  viewerImage: { width: SCREEN_WIDTH, height: '70%' },
  viewerCaption: { position: 'absolute', bottom: 40, left: 20, right: 20, alignItems: 'center' },
  webHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10, backgroundColor: '#000' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  addBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 22 },
  addCard: { borderRadius: 22, padding: 22, gap: 6 },
  addLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 0.7, marginTop: 10 },
  addInput: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  kindChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12 },
  addSaveBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  backToBuddyChip: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, backgroundColor: '#AF52DE', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  backToBuddyText: { color: '#fff', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
