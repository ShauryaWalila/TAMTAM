// Sticker picker — WhatsApp-style. Lets the user attach stickers (static or
// animated PNG/GIF/WebP) to a diary entry / medboard / draw board.
//
// Sources:
//   - Camera Roll (expo-image-picker) — any image from photos, including GIFs
//     and animated PNGs.
//   - Paste URL — for Tenor / Giphy / custom hosted stickers.
//
// Returns the resolved URI/URL via `onPicked` and dismisses itself.

import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, Image, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Image as ImageIcon, Link as LinkIcon, Check, Sparkles, ClipboardPaste } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as base64js from 'base64-js';
import { supabase } from '@/lib/supabase';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

type Props = {
  visible: boolean;
  onClose: () => void;
  onPicked: (uri: string) => void;
};

export default function StickerPicker({ visible, onClose, onPicked }: Props) {
  const theme = Colors[useColorScheme() ?? 'light'];
  const [tab, setTab] = useState<'paste' | 'photos' | 'url'>('paste');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const uploadToSupabase = async (localUri: string): Promise<string | null> => {
    try {
      const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
      // Try to detect extension. Default to .webp for stickers.
      const ext = (localUri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1] || 'png').toLowerCase();
      const filePath = `stickers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const contentType = ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
      const { error } = await supabase.storage
        .from('journal-assets')
        .upload(filePath, base64js.toByteArray(base64), { contentType });
      if (error) return null;
      const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
      return publicUrl;
    } catch {
      return null;
    }
  };

  const pickFromPhotos = async () => {
    try {
      setBusy(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access to pick stickers.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        // GIFs come through with their native extension on iOS.
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      const localUri = res.assets[0].uri;
      const remote = await uploadToSupabase(localUri);
      if (remote) {
        onPicked(remote);
        onClose();
      } else {
        // If upload failed, fall back to the local URI — works on this device
        // until network restores.
        onPicked(localUri);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const useUrl = () => {
    const trimmed = url.trim();
    if (!trimmed.match(/^https?:\/\//i)) { Alert.alert('Need a full URL', 'Paste an http(s) link to a PNG / GIF / WebP.'); return; }
    onPicked(trimmed);
    setUrl('');
    onClose();
  };

  // Reads the iOS pasteboard for image data. iOS keyboard's sticker tab puts
  // PNG / GIF data on the system pasteboard when the user long-presses a
  // sticker and chooses Copy. Same flow for Memoji and Live Stickers.
  const pasteFromClipboard = async () => {
    try {
      setBusy(true);
      const has = await Clipboard.hasImageAsync();
      if (!has) {
        Alert.alert(
          'Nothing on clipboard',
          'Open any sticker (iOS keyboard → emoji → leftmost tab, or Stickers app, or any chat). Long-press the sticker → Copy. Then come back and tap Paste again.'
        );
        setBusy(false);
        return;
      }
      const img = await Clipboard.getImageAsync({ format: 'png' });
      if (!img?.data) {
        Alert.alert('Could not read sticker', 'Clipboard had image data but the app could not decode it.');
        setBusy(false);
        return;
      }
      // img.data is a base64 string ALREADY prefixed with the data URI.
      // Save to a temp file then upload, so the resulting URL is shareable.
      const base64Body = img.data.replace(/^data:image\/[^;]+;base64,/, '');
      const tempUri = `${FileSystem.cacheDirectory}sticker_${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(tempUri, base64Body, { encoding: FileSystem.EncodingType.Base64 });
      const remote = await uploadToSupabase(tempUri);
      onPicked(remote || tempUri);
      onClose();
    } catch (e: any) {
      Alert.alert('Paste failed', e?.message || 'Could not paste a sticker from clipboard.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.header}>
            <Sparkles size={18} color={theme.tint} />
            <Text style={[styles.title, { color: theme.text }]}>Add Sticker</Text>
            <TouchableOpacity onPress={onClose} style={styles.close}><X size={22} color={theme.tabIconDefault} /></TouchableOpacity>
          </View>

          <View style={styles.tabs}>
            {(['paste', 'photos', 'url'] as const).map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setTab(t)}
                style={[styles.tab, tab === t && { backgroundColor: theme.tint }]}
              >
                {t === 'paste' ? <ClipboardPaste size={16} color={tab === t ? '#fff' : theme.text} /> : t === 'photos' ? <ImageIcon size={16} color={tab === t ? '#fff' : theme.text} /> : <LinkIcon size={16} color={tab === t ? '#fff' : theme.text} />}
                <Text style={{ color: tab === t ? '#fff' : theme.text, fontWeight: '800', fontSize: 12 }}>{t === 'paste' ? 'Paste' : t === 'photos' ? 'Photos / GIFs' : 'URL'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'paste' ? (
            <View style={styles.body}>
              <Text style={[styles.hint, { color: theme.tabIconDefault }]}>
                Open the iOS keyboard → tap the emoji icon → leftmost tab is Stickers (Memoji, Live, packs). Long-press any sticker → Copy. Come back and tap Paste below.
              </Text>
              <TouchableOpacity onPress={pasteFromClipboard} disabled={busy} style={[styles.bigBtn, { backgroundColor: theme.tint }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <>
                  <ClipboardPaste size={18} color="#fff" />
                  <Text style={styles.bigBtnText}>PASTE STICKER FROM CLIPBOARD</Text>
                </>}
              </TouchableOpacity>
            </View>
          ) : tab === 'photos' ? (
            <View style={styles.body}>
              <Text style={[styles.hint, { color: theme.tabIconDefault }]}>
                Pick any image — animated GIFs and WebP stickers are supported. Save the sticker to your Photos library first (e.g. share from WhatsApp → Save Image).
              </Text>
              <TouchableOpacity onPress={pickFromPhotos} disabled={busy} style={[styles.bigBtn, { backgroundColor: theme.tint }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <>
                  <ImageIcon size={18} color="#fff" />
                  <Text style={styles.bigBtnText}>OPEN PHOTOS</Text>
                </>}
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.body}>
              <Text style={[styles.hint, { color: theme.tabIconDefault }]}>
                Paste a direct link to a sticker image (Tenor, Giphy, Stickerly, anything). PNG / GIF / WebP supported.
              </Text>
              <TextInput
                value={url}
                onChangeText={setUrl}
                placeholder="https://..."
                placeholderTextColor={theme.tabIconDefault}
                autoCapitalize="none"
                keyboardType="url"
                style={[styles.input, { backgroundColor: theme.card, color: theme.text }]}
              />
              {!!url && (
                <View style={[styles.preview, { borderColor: theme.tabIconDefault + '40' }]}>
                  <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                </View>
              )}
              <TouchableOpacity onPress={useUrl} style={[styles.bigBtn, { backgroundColor: theme.tint }]}>
                <Check size={18} color="#fff" />
                <Text style={styles.bigBtnText}>USE THIS STICKER</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 36, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 18, fontWeight: '900' },
  close: { padding: 4 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(120,120,120,0.15)' },
  body: { gap: 14, marginTop: 6 },
  hint: { fontSize: 13, lineHeight: 19 },
  input: { padding: 14, borderRadius: 14, fontSize: 14 },
  preview: { height: 160, borderRadius: 14, borderWidth: 1, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.04)' },
  bigBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: 14 },
  bigBtnText: { color: '#fff', fontWeight: '900', letterSpacing: 0.4 },
});
