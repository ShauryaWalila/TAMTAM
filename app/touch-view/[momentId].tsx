// app/touch-view/[momentId].tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/Themed';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, X } from 'lucide-react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSharedValue, SharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Canvas, Circle, Group, BlurMask, Rect } from '@shopify/react-native-skia';
import { supabase } from '@/lib/supabase';
import PinGrid from '@/components/PinGrid/PinGrid';
import { Touch, TouchRecording } from '@/components/PinGrid/types';
import { buildHexGrid, imprintFromTouches } from '@/components/PinGrid/geometry';
import { base64ToFloat32, createPlayer, Player } from '@/lib/touchRecording';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

type HeatTouch = { x: number; y: number; r: number };
type HeatmapPayload = {
  v: 1;
  type: 'heatmap';
  screen: { w: number; h: number };
  touches: HeatTouch[];
};
type PatternPayload = TouchRecording & { type?: 'pattern' };
type AnyPayload = HeatmapPayload | PatternPayload;

const HEAT_VISUAL_SCALE = 3.5;
const HEAT_BLUR_PX = 36;

export default function TouchViewScreen() {
  const { momentId } = useLocalSearchParams<{ momentId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<AnyPayload | null>(null);
  const [senderName, setSenderName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

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
        const raw = data?.touch_payload as AnyPayload | null;
        if (!raw || raw.v !== 1) {
          setPayload(null);
        } else {
          setPayload(raw);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [momentId]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: '#000' }]}>
        <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />
        <ActivityIndicator color="#FFF" />
      </View>
    );
  }

  if (error || !payload) {
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

  const isHeatmap = (payload as HeatmapPayload).type === 'heatmap';

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <Stack.Screen options={{ presentation: 'fullScreenModal', headerShown: false }} />

      {isHeatmap
        ? <HeatmapView payload={payload as HeatmapPayload} color={theme.tint} />
        : <PatternView payload={payload as PatternPayload} />}

      <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.title}>{senderName ? `${senderName} sent you this` : 'A touch'}</Text>
        <View style={{ width: 44 }} />
      </View>
    </View>
  );
}

// ─── Heatmap (single snapshot) ──────────────────────────────────────────────

const MAX_HEAT_POINTS = 20;

function HeatmapView({ payload, color }: { payload: HeatmapPayload; color: string }) {
  const sx = SCREEN_WIDTH / payload.screen.w;
  const sy = SCREEN_HEIGHT / payload.screen.h;
  const scaled: HeatTouch[] = React.useMemo(
    () => payload.touches.map((t) => ({ x: t.x * sx, y: t.y * sy, r: t.r })),
    [payload, sx, sy]
  );
  const touches = useSharedValue<HeatTouch[]>(scaled);
  React.useEffect(() => { touches.value = scaled; }, [scaled, touches]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Rect x={0} y={0} width={SCREEN_WIDTH} height={SCREEN_HEIGHT} color="#000" />
      <Group>
        <BlurMask blur={HEAT_BLUR_PX} style="normal" />
        {Array.from({ length: MAX_HEAT_POINTS }, (_, i) => (
          <HeatBlob key={i} index={i} touches={touches} color={color} />
        ))}
      </Group>
    </Canvas>
  );
}

function HeatBlob({
  index,
  touches,
  color,
}: {
  index: number;
  touches: SharedValue<HeatTouch[]>;
  color: string;
}) {
  const cx = useSharedValue<number>(touches.value[index]?.x ?? -10000);
  const cy = useSharedValue<number>(touches.value[index]?.y ?? -10000);
  const r = useSharedValue<number>(touches.value[index] ? touches.value[index].r * HEAT_VISUAL_SCALE : 0);
  React.useEffect(() => {
    cx.value = touches.value[index]?.x ?? -10000;
    cy.value = touches.value[index]?.y ?? -10000;
    r.value = touches.value[index] ? touches.value[index].r * HEAT_VISUAL_SCALE : 0;
  });
  return <Circle cx={cx} cy={cy} r={r} color={color} />;
}

// ─── Pattern (replayable pin-grid recording) ────────────────────────────────

function PatternView({ payload }: { payload: PatternPayload }) {
  const insets = useSafeAreaInsets();
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

  const scaleX = SCREEN_WIDTH / payload.screen.w;
  const scaleY = SCREEN_HEIGHT / payload.screen.h;

  // Decode held imprint on mount.
  React.useEffect(() => {
    const decoded = base64ToFloat32(payload.final_imprint);
    if (decoded.length === pinCount) {
      heldImprint.value = decoded;
    } else {
      // Sender's pin count differs — synthesize from frames using receiver's grid.
      const grid = buildHexGrid(SCREEN_WIDTH, SCREEN_HEIGHT);
      const acc = new Float32Array(pinCount);
      for (const f of payload.frames) {
        const sc = f.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY, r: p.r }));
        const im = imprintFromTouches(grid.X, grid.Y, pinCount, sc);
        for (let i = 0; i < pinCount; i++) if (im[i] > acc[i]) acc[i] = im[i];
      }
      heldImprint.value = acc;
    }
  }, [payload, pinCount, scaleX, scaleY, heldImprint]);

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
  }, [isPlaying, scaleX, scaleY, activeTouches]);

  const startReplay = () => {
    if (!playerRef.current) playerRef.current = createPlayer(payload);
    lastFrameIdsRef.current = new Set();
    playStartRef.current = Date.now();
    setIsPlaying(true);
  };

  return (
    <>
      <PinGrid activeTouches={activeTouches} heldImprint={heldImprint} isClearing={isClearing} />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={startReplay}
          disabled={isPlaying || (payload.frames?.length ?? 0) === 0}
          style={[
            styles.replayButton,
            { backgroundColor: (payload.frames?.length ?? 0) === 0 ? '#444' : '#E91E63' },
          ]}
        >
          <View style={styles.replayContent}>
            <Heart size={24} color="white" fill="white" />
            <Text style={styles.replayText}>
              {isPlaying ? 'Feeling…' : (payload.frames?.length ?? 0) === 0 ? 'No replay' : 'Feel it'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </>
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
