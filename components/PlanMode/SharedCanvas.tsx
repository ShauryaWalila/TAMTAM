import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Dimensions, ScrollView, Platform } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, Points, vec } from '@shopify/react-native-skia';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Eraser, Pencil, Trash2, X, Palette, Target, Hand, ZoomIn, Cloud, CloudCheck, Users } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';

import { supabase } from '@/lib/supabase';
import { generateUUID } from '@/lib/db';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const INFINITE_SIZE = 10000;
const GRID_SPACING = 100;

interface DrawingPath {
  id: string;
  path: any;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
}

interface CanvasProps {
  tripId: string;
  onClose: () => void;
}

const COLOR_PALETTE = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', 
  '#5856D6', '#AF52DE', '#FF2D55', '#000000', '#8E8E93'
];

export default function SharedCanvas({ tripId, onClose }: CanvasProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const canvasRef = useCanvasRef();
  
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [remotePaths, setRemotePaths] = useState<Record<string, DrawingPath>>({});
  const [color, setColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [eraserWidth, setEraserWidth] = useState(40);
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
  const [activeMenu, setActiveMenu] = useState<'none' | 'color' | 'pen' | 'eraser'>('none');
  const [isSaving, setIsSaving] = useState(false);
  const [isPartnerPresent, setIsPartnerPresent] = useState(false);
  const [zoomText, setZoomText] = useState('100%');
  
  const channelRef = useRef<any>(null);
  const currentPathId = useRef<string | null>(null);

  // Zoom & Pan states
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const [currentLocalPath, setCurrentLocalPath] = useState<DrawingPath | null>(null);

  useEffect(() => {
    fetchCanvas();
    setupRealtime();
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [tripId]);

  const setupRealtime = () => {
    const channel = supabase.channel(`canvas_collaboration_${tripId}`, {
      config: { broadcast: { self: false }, presence: { key: 'user' } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        setIsPartnerPresent(Object.keys(state).length > 1);
      })
      .on('broadcast', { event: 'stroke_start' }, ({ payload }) => {
        const path = Skia.Path.Make();
        path.moveTo(payload.x, payload.y);
        setRemotePaths(prev => ({
          ...prev,
          [payload.id]: {
            id: payload.id,
            path,
            color: payload.color,
            strokeWidth: payload.strokeWidth,
            isEraser: payload.isEraser
          }
        }));
      })
      .on('broadcast', { event: 'stroke_update' }, ({ payload }) => {
        setRemotePaths(prev => {
          const target = prev[payload.id];
          if (target) {
            target.path.lineTo(payload.x, payload.y);
            return { ...prev, [payload.id]: { ...target } };
          }
          return prev;
        });
      })
      .on('broadcast', { event: 'stroke_end' }, ({ payload }) => {
        setRemotePaths(prev => {
          const newState = { ...prev };
          delete newState[payload.id];
          return newState;
        });
        fetchCanvas(); // Refresh from DB to get the permanent version
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_canvas', filter: `trip_id=eq.${tripId}` }, fetchCanvas)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    channelRef.current = channel;
  };

  const fetchCanvas = async () => {
    const { data } = await supabase.from('trip_canvas').select('paths').eq('trip_id', tripId).maybeSingle();
    if (data && data.paths) {
      const reconstructed = data.paths.map((p: any) => ({
        ...p,
        id: p.id || generateUUID(),
        path: Skia.Path.MakeFromSVGString(p.pathString)
      }));
      setPaths(reconstructed);
    }
  };

  const saveCanvas = async (allPaths: DrawingPath[]) => {
    setIsSaving(true);
    const serialized = allPaths.map(p => ({
      id: p.id,
      color: p.color,
      strokeWidth: p.strokeWidth,
      isEraser: p.isEraser,
      pathString: p.path.toSVGString()
    }));
    await supabase.from('trip_canvas').upsert({ 
      trip_id: tripId, 
      paths: serialized, 
      updated_at: new Date().toISOString() 
    });
    setTimeout(() => setIsSaving(false), 500);
  };

  const updateZoomText = (s: number) => {
    setZoomText(`${Math.round(s * 100)}%`);
  };

  const onStart = useCallback((x: number, y: number) => {
    const id = generateUUID();
    currentPathId.current = id;
    const newPath = Skia.Path.Make();
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    newPath.moveTo(adjX, adjY);
    
    const stroke = { 
      id,
      path: newPath, 
      color: activeTool === 'eraser' ? '#000000' : color, 
      strokeWidth: activeTool === 'eraser' ? eraserWidth / scale.value : strokeWidth / scale.value,
      isEraser: activeTool === 'eraser'
    };
    
    setCurrentLocalPath(stroke);
    setActiveMenu('none');

    // Broadcast start
    channelRef.current?.send({
      type: 'broadcast',
      event: 'stroke_start',
      payload: { id, x: adjX, y: adjY, color: stroke.color, strokeWidth: stroke.strokeWidth, isEraser: stroke.isEraser }
    });
  }, [color, activeTool, strokeWidth, eraserWidth, translateX, translateY, scale]);

  const onUpdate = useCallback((x: number, y: number) => {
    if (!currentLocalPath) return;
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    currentLocalPath.path.lineTo(adjX, adjY);
    setCurrentLocalPath({ ...currentLocalPath });

    // Broadcast update
    channelRef.current?.send({
      type: 'broadcast',
      event: 'stroke_update',
      payload: { id: currentLocalPath.id, x: adjX, y: adjY }
    });
  }, [currentLocalPath, translateX, translateY, scale]);

  const onEnd = useCallback(() => {
    if (currentLocalPath) {
      const newPaths = [...paths, currentLocalPath];
      setPaths(newPaths);
      
      // Broadcast end
      channelRef.current?.send({
        type: 'broadcast',
        event: 'stroke_end',
        payload: { id: currentLocalPath.id }
      });

      setCurrentLocalPath(null);
      saveCanvas(newPaths);
    }
  }, [currentLocalPath, paths]);

  const drawGesture = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .enabled(activeTool !== 'pan')
    .onBegin((e) => runOnJS(onStart)(e.x, e.y))
    .onUpdate((e) => runOnJS(onUpdate)(e.x, e.y))
    .onEnd(() => runOnJS(onEnd)());

  const oneFingerPanGesture = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .enabled(activeTool === 'pan')
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onStart((e) => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      focalX.value = e.focalX;
      focalY.value = e.focalY;
    })
    .onUpdate((e) => {
      const newScale = Math.max(0.1, Math.min(savedScale.value * e.scale, 10));
      const s = newScale / savedScale.value;
      translateX.value = focalX.value - (focalX.value - savedTranslateX.value) * s;
      translateY.value = focalY.value - (focalY.value - savedTranslateY.value) * s;
      scale.value = newScale;
      runOnJS(updateZoomText)(newScale);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const twoFingerPanGesture = Gesture.Pan()
    .minPointers(2)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(
    Gesture.Exclusive(drawGesture, oneFingerPanGesture),
    Gesture.Simultaneous(twoFingerPanGesture, pinchGesture)
  );

  const animatedTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value }
  ]);

  const animatedZoomStyle = useAnimatedStyle(() => ({
    opacity: scale.value !== 1 ? 1 : 0.4,
  }));

  const resetView = () => {
    scale.value = 1; savedScale.value = 1;
    translateX.value = 0; savedTranslateX.value = 0;
    translateY.value = 0; savedTranslateY.value = 0;
    setZoomText('100%');
  };

  const clearCanvas = () => {
    setPaths([]);
    setCurrentLocalPath(null);
    saveCanvas([]);
    resetView();
  };

  const toggleMenu = (menu: 'color' | 'pen' | 'eraser') => {
    setActiveMenu(activeMenu === menu ? 'none' : menu);
    if (menu === 'eraser') setActiveTool('eraser');
    if (menu === 'pen') setActiveTool('pen');
  };

  const gridPoints = useMemo(() => {
    const pts = [];
    for (let x = -INFINITE_SIZE/2; x <= INFINITE_SIZE/2; x += GRID_SPACING) {
      for (let y = -INFINITE_SIZE/2; y <= INFINITE_SIZE/2; y += GRID_SPACING) {
        pts.push(vec(x, y));
      }
    }
    return pts;
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>SHARED CANVAS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Animated.View style={[styles.zoomBadge, animatedZoomStyle]}>
              <ZoomIn size={12} color="#666" />
              <Text style={styles.zoomText}>{zoomText}</Text>
            </Animated.View>
            <AnimatePresence>
              {isSaving ? (
                <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.syncIndicator}>
                  <Cloud size={10} color={theme.tint} />
                  <Text style={styles.syncText}>Saving...</Text>
                </MotiView>
              ) : (
                <MotiView from={{ opacity: 0 }} animate={{ opacity: 0.5 }} style={styles.syncIndicator}>
                  <CloudCheck size={10} color="#888" />
                  <Text style={[styles.syncText, { color: '#888' }]}>Synced</Text>
                </MotiView>
              )}
              {isPartnerPresent && (
                <MotiView from={{ scale: 0 }} animate={{ scale: 1 }} style={styles.presenceBadge}>
                  <Users size={10} color="#4CAF50" />
                  <Text style={[styles.syncText, { color: '#4CAF50' }]}>Partner In</Text>
                </MotiView>
              )}
            </AnimatePresence>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeCircle}>
          <X size={20} color="#000" />
        </TouchableOpacity>
      </View>

      <GestureDetector gesture={composedGesture}>
        <View style={styles.canvasContainer}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
            <Group transform={animatedTransform}>
              <Rect x={-INFINITE_SIZE/2} y={-INFINITE_SIZE/2} width={INFINITE_SIZE} height={INFINITE_SIZE} color="white" />
              <Points points={gridPoints} mode="points" color="#f2f2f2" strokeWidth={2} />
              
              <Group layer>
                {/* Permanent Paths */}
                {paths.map((p) => (
                  <Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" blendMode={p.isEraser ? "clear" : "srcOver"} />
                ))}
                
                {/* Partner's Live Paths */}
                {Object.values(remotePaths).map((rp) => (
                  <Path key={rp.id} path={rp.path} color={rp.color} style="stroke" strokeWidth={rp.strokeWidth} strokeCap="round" strokeJoin="round" blendMode={rp.isEraser ? "clear" : "srcOver"} />
                ))}

                {/* Local Live Path */}
                {currentLocalPath && (
                  <Path path={currentLocalPath.path} color={currentLocalPath.color} style="stroke" strokeWidth={currentLocalPath.strokeWidth} strokeCap="round" strokeJoin="round" blendMode={currentLocalPath.isEraser ? "clear" : "srcOver"} />
                )}
              </Group>
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.toolbarContainer}>
        <AnimatePresence>
          {activeMenu !== 'none' && (
            <MotiView from={{ opacity: 0, translateY: 20, scale: 0.9 }} animate={{ opacity: 1, translateY: 0, scale: 1 }} exit={{ opacity: 0, translateY: 20, scale: 0.9 }} style={styles.subToolbar}>
              <BlurView intensity={90} tint="light" style={styles.subToolbarBlur}>
                {activeMenu === 'color' && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                    {COLOR_PALETTE.map(c => (
                      <TouchableOpacity key={c} onPress={() => { setColor(c); setActiveMenu('none'); setActiveTool('pen'); }} style={[styles.colorOption, { backgroundColor: c }, color === c && styles.activeBorder]} />
                    ))}
                  </ScrollView>
                )}
                {activeMenu === 'pen' && (
                  <View style={styles.sizeRow}>
                    {[2, 4, 8, 16, 24].map(s => (
                      <TouchableOpacity key={s} onPress={() => { setStrokeWidth(s); setActiveMenu('none'); }} style={styles.sizeBtn}>
                        <View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: '#000' }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {activeMenu === 'eraser' && (
                  <View style={styles.sizeRow}>
                    {[20, 40, 60, 80, 100].map(s => (
                      <TouchableOpacity key={s} onPress={() => { setEraserWidth(s); setActiveMenu('none'); }} style={styles.sizeBtn}>
                        <View style={{ width: s/3, height: s/3, borderRadius: s/6, backgroundColor: '#888' }} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </BlurView>
            </MotiView>
          )}
        </AnimatePresence>

        <View style={styles.mainDock}>
          <BlurView intensity={100} tint="light" style={styles.dockBlur}>
            <TouchableOpacity onPress={() => toggleMenu('pen')} style={[styles.tool, activeTool === 'pen' && styles.activeTool]}>
              <Pencil size={22} color={activeTool === 'pen' ? theme.tint : '#333'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleMenu('eraser')} style={[styles.tool, activeTool === 'eraser' && styles.activeTool]}>
              <Eraser size={22} color={activeTool === 'eraser' ? theme.tint : '#333'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTool('pan')} style={[styles.tool, activeTool === 'pan' && styles.activeTool]}>
              <Hand size={22} color={activeTool === 'pan' ? theme.tint : '#333'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleMenu('color')} style={styles.tool}>
              <View style={[styles.colorPreview, { backgroundColor: color }]} />
            </TouchableOpacity>
            <View style={styles.dockDivider} />
            <TouchableOpacity onPress={resetView} style={styles.tool}>
              <Target size={22} color="#000" />
            </TouchableOpacity>
            <TouchableOpacity onPress={clearCanvas} style={styles.tool}>
              <Trash2 size={22} color="#FF3B30" />
            </TouchableOpacity>
          </BlurView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: '#fff', zIndex: 5000 },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 25, alignItems: 'center', backgroundColor: 'transparent', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  headerTitle: { fontWeight: '900', letterSpacing: 3, fontSize: 10, color: '#000', opacity: 0.4 },
  closeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)', justifyContent: 'center', alignItems: 'center' },
  zoomBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  zoomText: { fontSize: 10, fontWeight: 'bold', color: '#666' },
  syncIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  presenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginLeft: 6 },
  syncText: { fontSize: 9, fontWeight: 'bold', color: '#888', textTransform: 'uppercase' },
  canvasContainer: { flex: 1 },
  toolbarContainer: { position: 'absolute', bottom: 50, alignSelf: 'center', width: '90%', alignItems: 'center', gap: 15 },
  mainDock: { height: 64, borderRadius: 32, overflow: 'hidden', elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15 },
  dockBlur: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 10 },
  tool: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  activeTool: { backgroundColor: 'rgba(0,0,0,0.08)' },
  dockDivider: { width: 1, height: 24, backgroundColor: 'rgba(0,0,0,0.1)', marginHorizontal: 5 },
  colorPreview: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)' },
  subToolbar: { width: '100%', borderRadius: 24, overflow: 'hidden', elevation: 5 },
  subToolbarBlur: { padding: 15 },
  scrollContent: { gap: 15, paddingRight: 10 },
  colorOption: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  activeBorder: { borderColor: '#000' },
  sizeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10 },
  sizeBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
});
