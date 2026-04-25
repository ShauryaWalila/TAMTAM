// app/touch-view/[momentId].tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, X } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch, TouchRecording } from '@/components/PinGrid/types';
import { buildHexGrid } from '@/components/PinGrid/geometry';
import { base64ToFloat32, createPlayer, Player } from '@/lib/touchRecording';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TouchViewScreen() {
  const { momentId } = useLocalSearchParams<{ momentId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState<TouchRecording | null>(null);
  const [senderName, setSenderName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const pinCount = React.useMemo(
    () => buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT).pinCount,
    []
  );
  const heldImprint = useSharedValue<Float32Array>(new Float32Array(pinCount));
  const activeTouches = useSharedValue<Touch[]>([]);
  const isClearing = useSharedValue(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = React.useRef<Player | null>(null);
  const playStartRef = React.useRef<number>(0);
  const lastFrameIdsRef = React.useRef<Set<number>>(new Set());

  const scaleX = recording ? SCREEN_WIDTH / recording.screen.w : 1;
  const scaleY = recording ? SCREEN_HEIGHT / recording.screen.h : 1;

  React.useEffect(() => {
    if (!isPlaying || !playerRef.current) return;
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - playStartRef.current;
      const player = playerRef.current!;
      if (elapsed >= player.totalDurationMs) {
        activeTouches.value = [];
        lastFrameIdsRef.current = new Set();
        setIsPlaying(false);
        return;
      }
      const points = player.frameAt(elapsed);
      const scaled: Touch[] = points.map((p) => ({
        id: p.id,
        x: p.x * scaleX,
        y: p.y * scaleY,
        r: p.r,
      }));
      const ids = new Set(scaled.map((p) => p.id));
      let newFinger = false;
      for (const id of ids) if (!lastFrameIdsRef.current.has(id)) { newFinger = true; break; }
      if (newFinger) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      lastFrameIdsRef.current = ids;
      activeTouches.value = scaled;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, scaleX, scaleY]);

  const startReplay = () => {
    if (!recording) return;
    if (!playerRef.current) playerRef.current = createPlayer(recording);
    lastFrameIdsRef.current = new Set();
    playStartRef.current = Date.now();
    setIsPlaying(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: dbErr } = await supabase
          .from('moments')
          .select('user_id, touch_payload')
          .eq('id', momentId)
          .single();
        if (cancelled) return;
        if (dbErr) {
          setError(dbErr.message);
          return;
        }
        setSenderName(data?.user_id ?? '');
        const payload = data?.touch_payload as TouchRecording | null;
        if (!payload || payload.v !== 1) {
          setRecording(null);
          return;
        }
        setRecording(payload);
        const decoded = base64ToFloat32(payload.final_imprint);
        if (decoded.length === pinCount) {
          heldImprint.value = decoded;
        } else {
          // Sender's pin count differs — Task 13 fills this from frames.
          heldImprint.value = new Float32Array(pinCount);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [momentId, pinCount]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator color="#FFF" />
      </View>
    );
  }

  if (error || !recording) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <Text style={styles.fallbackText}>
          {error ?? `${senderName || 'someone'} sent a touch`}
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.closeBtn, { marginTop: 24 }]}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />

      <PinGrid activeTouches={activeTouches} heldImprint={heldImprint} isClearing={isClearing} />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{senderName ? `${senderName} sent you this` : 'A touch'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={startReplay}
          disabled={isPlaying || (recording.frames?.length ?? 0) === 0}
          style={[
            styles.replayButton,
            { backgroundColor: (recording.frames?.length ?? 0) === 0 ? '#444' : '#E91E63' },
          ]}
        >
          <View style={styles.replayContent}>
            <Heart size={24} color="white" fill="white" />
            <Text style={styles.replayText}>
              {isPlaying ? 'Feeling…' : (recording.frames?.length ?? 0) === 0 ? 'No replay' : 'Feel it'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { justifyContent: 'center', alignItems: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', zIndex: 10 },
  replayButton: { width: SCREEN_WIDTH * 0.85, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  replayContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  replayText: { color: 'white', fontSize: 16, fontWeight: '900' },
  fallbackText: { color: '#FFF', fontSize: 18 },
});
