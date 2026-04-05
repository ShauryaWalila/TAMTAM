import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, Points, vec } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, runOnJS, useDerivedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Eraser, Pencil, Trash2, ChevronLeft, Target, Hand, ZoomIn, Save, Eye, EyeOff, RotateCcw, Highlighter, Palette, Type } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const INFINITE_SIZE = 10000;
const GRID_SPACING = 100;

interface DrawingPath {
  id: string;
  path: any; 
  color: string;
  strokeWidth: number;
  isEraser: boolean;
  opacity: number;
}

const RAINBOW_COLORS = [
  '#000000', '#8E8E93', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55',
  '#FF5E5E', '#FFD35E', '#BEFF5E', '#5EFF8B', '#5EFFFF', '#5EB1FF', '#8B5EFF', '#FF5EFF', '#FF5E9D', '#FFFFFF'
];

export default function WhiteboardScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const canvasRef = useCanvasRef();

  const [board, setBoard] = useState<any>(null);
  
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [glassPaths, setGlassPaths] = useState<DrawingPath[]>([]);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const [color, setColor] = useState('#000000');
  const [penSize, setPenSize] = useState(4);
  const [highSize, setHighSize] = useState(20);
  const [eraserSize, setEraserSize] = useState(40);
  
  const [penOpacity, setPenOpacity] = useState(1);
  const [highOpacity, setHighOpacity] = useState(0.35);
  
  const [activeTool, setActiveTool] = useState<'pen' | 'high' | 'eraser' | 'pan'>('pen');
  const [isSaving, setIsSaving] = useState(false);
  const [isReviseMode, setIsReviseMode] = useState(false);
  const [zoomText, setZoomText] = useState('100%');
  const [showGrid, setShowGrid] = useState(true);
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [isDraggable, setIsDraggable] = useState(false);

  // FAB Position States
  const fabX = useSharedValue(20);
  const fabY = useSharedValue(SCREEN_HEIGHT / 2 - 32);
  const savedFabX = useSharedValue(20);
  const savedFabY = useSharedValue(SCREEN_HEIGHT / 2 - 32);

  const activePathRef = useRef<DrawingPath | null>(null);

  // Zoom & Pan states
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  useEffect(() => {
    fetchBoard();
  }, [id]);

  const fetchBoard = async () => {
    const { data } = await supabase.from('study_whiteboards').select('*').eq('id', id).single();
    if (data) {
      setBoard(data);
      if (data.canvas_data && Array.isArray(data.canvas_data)) {
        const reconstructed = data.canvas_data.map((p: any) => ({
          ...p,
          path: Skia.Path.MakeFromSVGString(p.pathString)
        }));
        setPaths(reconstructed);
      }
    }
  };

  const handleSave = async () => {
    if (isReviseMode) return;
    setIsSaving(true);
    
    const serialized = paths.map(p => ({
      id: p.id,
      color: p.color,
      strokeWidth: p.strokeWidth,
      isEraser: p.isEraser,
      opacity: p.opacity || 1,
      pathString: p.path.toSVGString()
    }));

    await supabase.from('study_whiteboards').update({ 
      canvas_data: serialized, 
      updated_at: new Date().toISOString() 
    }).eq('id', id);

    setIsSaving(false);
  };

  // Auto-save logic
  useEffect(() => {
    if (paths.length > 0 && !isReviseMode) {
      const timer = setTimeout(() => {
        handleSave();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [paths, isReviseMode]);

  const updateZoomText = (s: number) => {
    setZoomText(`${Math.round(s * 100)}%`);
  };

  const onStart = useCallback((x: number, y: number) => {
    if (activeTool === 'pan') return;
    
    const pathId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const newPath = Skia.Path.Make();
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    newPath.moveTo(adjX, adjY);
    // Micro-line for dot visibility
    newPath.lineTo(adjX + 0.1, adjY + 0.1);
    
    let currentSize = penSize;
    let currentOpacity = penOpacity;
    if (activeTool === 'high') {
      currentSize = highSize;
      currentOpacity = highOpacity;
    }
    if (activeTool === 'eraser') {
      currentSize = eraserSize;
      currentOpacity = 1;
    }

    const stroke: DrawingPath = { 
      id: pathId,
      path: newPath, 
      color: activeTool === 'eraser' ? '#ffffff' : color, 
      strokeWidth: currentSize / scale.value,
      isEraser: activeTool === 'eraser',
      opacity: currentOpacity
    };
    
    activePathRef.current = stroke;
    // CRITICAL: Add to permanent list IMMEDIATELY on touch so it's never lost
    if (isReviseMode) {
      setGlassPaths(prev => [...prev, stroke]);
    } else {
      setPaths(prev => [...prev, stroke]);
    }
  }, [color, activeTool, penSize, highSize, eraserSize, penOpacity, highOpacity, isReviseMode, translateX, translateY, scale]);

  const onUpdate = useCallback((x: number, y: number) => {
    const path = activePathRef.current;
    if (!path) return;
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    path.path.lineTo(adjX, adjY);
    // Force a redraw of the Skia canvas
    setRenderTrigger(prev => prev + 1);
  }, [translateX, translateY, scale]);

  const onEnd = useCallback(() => {
    activePathRef.current = null;
  }, []);

  const drawGesture = Gesture.Pan()
    .minPointers(1).maxPointers(1)
    .minDistance(0)
    .enabled(activeTool !== 'pan')
    .onBegin((e) => runOnJS(onStart)(e.x, e.y))
    .onUpdate((e) => runOnJS(onUpdate)(e.x, e.y))
    .onFinalize(() => runOnJS(onEnd)());

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
      const newScale = Math.max(0.1, Math.min(savedScale.value * e.scale, 15));
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

  const threeFingerPanGesture = Gesture.Pan()
    .minPointers(3)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
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
    Gesture.Simultaneous(threeFingerPanGesture, pinchGesture)
  );

  const singleTapGesture = Gesture.Tap().numberOfTaps(1).onEnd(() => {
    runOnJS(setIsToolsExpanded)(!isToolsExpanded);
    runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
  });
  const doubleTapGesture = Gesture.Tap().numberOfTaps(2).onEnd(() => {
    runOnJS(setIsDraggable)(!isDraggable);
    runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success);
  });
  const fabPanGesture = Gesture.Pan().enabled(isDraggable)
    .onStart(() => { savedFabX.value = fabX.value; savedFabY.value = fabY.value; })
    .onUpdate((e) => { fabX.value = savedFabX.value + e.translationX; fabY.value = savedFabY.value + e.translationY; })
    .onEnd(() => { savedFabX.value = fabX.value; savedFabY.value = fabY.value; });

  const combinedFabGesture = Gesture.Exclusive(doubleTapGesture, singleTapGesture, fabPanGesture);

  const animatedTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value }
  ]);

  const fabAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: fabX.value }, { translateY: fabY.value }],
    borderWidth: isDraggable ? 2 : 0,
    borderColor: '#fff',
    shadowOpacity: isDraggable ? 0.8 : 0.4,
  }));

  const menuAnimatedStyle = useAnimatedStyle(() => {
    const expandUp = fabY.value > SCREEN_HEIGHT / 2;
    return {
      position: 'absolute',
      left: Math.max(20, Math.min(fabX.value - (SCREEN_WIDTH * 0.45) + 32, SCREEN_WIDTH - (SCREEN_WIDTH * 0.9) - 20)),
      bottom: expandUp ? (SCREEN_HEIGHT - fabY.value + 10) : undefined,
      top: expandUp ? undefined : (fabY.value + 74),
      width: SCREEN_WIDTH * 0.9,
    };
  });

  const resetView = () => {
    scale.value = 1; savedScale.value = 1;
    translateX.value = 0; savedTranslateX.value = 0;
    translateY.value = 0; savedTranslateY.value = 0;
    setZoomText('100%');
  };

  const clearCanvas = () => {
    Alert.alert("Clear Board?", "This will remove all drawings.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => {
        if (isReviseMode) setGlassPaths([]);
        else setPaths([]);
      }}
    ]);
  };

  const getActiveRange = () => {
    if (activeTool === 'pen') return { min: 1, max: 40, current: penSize, setter: setPenSize, title: 'Pen Size' };
    if (activeTool === 'high') return { min: 5, max: 150, current: highSize, setter: setHighSize, title: 'Highlighter Size' };
    if (activeTool === 'eraser') return { min: 10, max: 200, current: eraserSize, setter: setEraserSize, title: 'Eraser Size' };
    return null;
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

  const CustomSlider = ({ value, onValueChange, min, max, title }: any) => {
    const sliderWidth = SCREEN_WIDTH * 0.65;
    const isActive = useSharedValue(false);
    const knobX = useSharedValue(((value - min) / (max - min)) * sliderWidth);

    useEffect(() => {
      knobX.value = ((value - min) / (max - min)) * sliderWidth;
    }, [value, min, max]);

    const gesture = Gesture.Pan()
      .onStart(() => { isActive.value = true; })
      .onUpdate((e) => {
        const x = Math.max(0, Math.min(sliderWidth, e.x));
        knobX.value = x;
        const newValue = min + (x / sliderWidth) * (max - min);
        runOnJS(onValueChange)(newValue);
      })
      .onEnd(() => {
        isActive.value = false;
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
      });

    const animatedKnobStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: knobX.value - 12 },
        { scale: withSpring(isActive.value ? 1.3 : 1) }
      ],
      backgroundColor: isActive.value ? theme.tint : '#fff',
    }));

    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderTitle}>{title}</Text>
          <Text style={styles.sliderValue}>{Math.round(value)}</Text>
        </View>
        <GestureDetector gesture={gesture}>
          <View style={[styles.sliderTrack, { width: sliderWidth }]}>
            <Animated.View style={[styles.sliderProgress, { width: knobX.value, backgroundColor: theme.tint }]} />
            <Animated.View style={[styles.sliderKnob, animatedKnobStyle, { borderColor: theme.tint }]} />
          </View>
        </GestureDetector>
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={[styles.headerWrapper, { paddingTop: insets.top + 5 }]}>
        <BlurView intensity={90} tint="light" style={styles.headerBlur}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerIconBtn}><ChevronLeft size={22} color="#000" strokeWidth={2.5} /></TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={styles.boardTitle} numberOfLines={1}>{board?.title || "Med-Board"}</Text>
            <View style={styles.statusRow}>
              <Animated.View style={[styles.zoomBadge, { opacity: scale.value !== 1 ? 1 : 0.4 }]}><ZoomIn size={10} color="#666" /><Text style={styles.zoomText}>{zoomText}</Text></Animated.View>
              <View style={[styles.statusDot, { backgroundColor: isSaving ? theme.tint : (isReviseMode ? '#FF2D55' : '#34C759') }]} />
              <Text style={[styles.statusText, { color: isReviseMode ? '#FF2D55' : '#666' }]}>{isReviseMode ? "REVISION MODE" : (isSaving ? "SAVING..." : "SYNCED")}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); fetchBoard(); }} style={styles.headerActionBtn}><RotateCcw size={20} color="#000" strokeWidth={2} /></TouchableOpacity>
            <TouchableOpacity onPress={() => { const next = !isReviseMode; setIsReviseMode(next); if (next) setGlassPaths([]); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }} style={[styles.headerActionBtn, isReviseMode && { backgroundColor: '#FF2D55' }]}>{isReviseMode ? <EyeOff size={20} color="white" /> : <Eye size={20} color="#000" strokeWidth={2} />}</TouchableOpacity>
          </View>
        </BlurView>
      </View>

      <AnimatePresence>{isReviseMode && (
        <MotiView from={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} exit={{ scaleX: 0, opacity: 0 }} style={styles.revisionIndicatorWrapper}>
          <View style={styles.revisionIndicator}><View style={styles.revisionPulse} /><Text style={styles.revisionIndicatorText}>REVISION BOARD ACTIVE</Text></View>
        </MotiView>
      )}</AnimatePresence>

      <GestureDetector gesture={composedGesture}>
        <View style={styles.canvasContainer}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
            <Group transform={animatedTransform}>
              <Rect x={-INFINITE_SIZE/2} y={-INFINITE_SIZE/2} width={INFINITE_SIZE} height={INFINITE_SIZE} color="#fff" />
              {showGrid && <Points points={gridPoints} mode="points" color="#f0f0f0" strokeWidth={2} />}
              <Group layer>
                {paths.map((p) => (
                  <Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity} blendMode={p.isEraser ? "clear" : "srcOver"} />
                ))}
                {glassPaths.map((p) => (
                  <Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity * 0.6} />
                ))}
              </Group>
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      <View style={styles.fabContainer} pointerEvents="box-none">
        <AnimatePresence>{isToolsExpanded && (
          <MotiView from={{ opacity: 0, scale: 0.5, translateY: 50 }} animate={{ opacity: 1, scale: 1, translateY: 0 }} exit={{ opacity: 0, scale: 0.5, translateY: 50 }} style={menuAnimatedStyle}>
            <TouchableOpacity activeOpacity={1} onPress={() => setIsToolsExpanded(false)} style={StyleSheet.absoluteFill} />
            <BlurView intensity={80} tint="light" style={styles.toolsBlur}>
              <View style={styles.toolsRow}>
                <TouchableOpacity onPress={() => setActiveTool('pen')} style={[styles.toolCircle, { backgroundColor: activeTool === 'pen' ? theme.tint : 'rgba(0,0,0,0.08)' }, activeTool === 'pen' && styles.activeToolShadow]}><Pencil size={22} color={activeTool === 'pen' ? '#fff' : '#000'} /></TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTool('high')} style={[styles.toolCircle, { backgroundColor: activeTool === 'high' ? theme.tint : 'rgba(0,0,0,0.08)' }, activeTool === 'high' && styles.activeToolShadow]}><Highlighter size={22} color={activeTool === 'high' ? '#fff' : '#000'} /></TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTool('eraser')} style={[styles.toolCircle, { backgroundColor: activeTool === 'eraser' ? theme.tint : 'rgba(0,0,0,0.08)' }, activeTool === 'eraser' && styles.activeToolShadow]}><Eraser size={22} color={activeTool === 'eraser' ? '#fff' : '#000'} /></TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTool('pan')} style={[styles.toolCircle, { backgroundColor: activeTool === 'pan' ? theme.tint : 'rgba(0,0,0,0.08)' }, activeTool === 'pan' && styles.activeToolShadow]}><Hand size={22} color={activeTool === 'pan' ? '#fff' : '#000'} /></TouchableOpacity>
              </View>
              <View style={styles.toolDivider} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorScroll}>
                {RAINBOW_COLORS.map(c => <TouchableOpacity key={c} onPress={() => { setColor(c); if (activeTool==='eraser'||activeTool==='pan') setActiveTool('pen'); }} style={[styles.colorOption, { backgroundColor: c }, color === c && { borderColor: '#000', borderWidth: 2 }]} />)}
              </ScrollView>
              <View style={styles.toolDivider} />
              <View style={styles.settingsSection}>
                <View style={styles.settingsHeader}>
                  <View style={[styles.previewDot, { width: Math.min(getActiveRange()?.current || 4, 24), height: Math.min(getActiveRange()?.current || 4, 24), borderRadius: 12, backgroundColor: activeTool === 'eraser' ? '#ddd' : color, opacity: activeTool === 'pen' ? penOpacity : (activeTool === 'high' ? highOpacity : 1) }]} />
                  <Text style={styles.settingsTitle}>{getActiveRange()?.title}</Text>
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity onPress={() => { setShowGrid(!showGrid); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[styles.gridFab, { backgroundColor: showGrid ? theme.tint : 'rgba(0,0,0,0.15)' }]}><Text style={[styles.gridFabText, { color: showGrid ? '#fff' : '#000' }]}>GRID {showGrid ? 'ON' : 'OFF'}</Text></TouchableOpacity>
                </View>
                {getActiveRange() && <CustomSlider value={getActiveRange()?.current} onValueChange={getActiveRange()?.setter} min={getActiveRange()?.min} max={getActiveRange()?.max} title="Size" />}
                {activeTool !== 'eraser' && activeTool !== 'pan' && <CustomSlider value={activeTool === 'pen' ? penOpacity * 100 : highOpacity * 100} onValueChange={(v: number) => activeTool === 'pen' ? setPenOpacity(v / 100) : setHighOpacity(v / 100)} min={5} max={100} title="Opacity (%)" />}
              </View>
              <View style={styles.toolDivider} />
              <View style={styles.utilRow}>
                <TouchableOpacity onPress={resetView} style={styles.utilBtn}><View style={styles.utilIconBg}><Target size={18} color="#000" strokeWidth={2.5} /></View><Text style={styles.utilText}>Reset View</Text></TouchableOpacity>
                <TouchableOpacity onPress={clearCanvas} style={styles.utilBtn}><View style={[styles.utilIconBg, { backgroundColor: '#FF3B3015' }]}><Trash2 size={18} color="#FF3B30" strokeWidth={2.5} /></View><Text style={[styles.utilText, { color: '#FF3B30' }]}>Clear Board</Text></TouchableOpacity>
              </View>
            </BlurView>
          </MotiView>
        )}</AnimatePresence>
        <GestureDetector gesture={combinedFabGesture}>
          <Animated.View style={[styles.mainFab, { backgroundColor: theme.tint }, fabAnimatedStyle]}>
            <View style={styles.fabInner}><MotiView animate={{ rotate: isToolsExpanded ? '45deg' : '0deg' }} transition={{ type: 'spring', damping: 15 }}><Palette size={28} color="white" /></MotiView></View>
          </Animated.View>
        </GestureDetector>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  headerWrapper: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, paddingHorizontal: 15 },
  headerBlur: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  headerIconBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 15 },
  headerInfo: { flex: 1, marginLeft: 5 },
  boardTitle: { fontSize: 17, fontWeight: '900', color: '#000', letterSpacing: -0.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  zoomBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  zoomText: { fontSize: 9, fontWeight: '900', color: '#666' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerActionBtn: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  revisionIndicatorWrapper: { position: 'absolute', top: 110, alignSelf: 'center', zIndex: 90 },
  revisionIndicator: { backgroundColor: '#FF2D55', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 5, shadowColor: '#FF2D55', shadowOpacity: 0.3, shadowRadius: 10 },
  revisionIndicatorText: { color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  revisionPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'white', opacity: 0.8 },
  canvasContainer: { flex: 1 },
  fabContainer: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  mainFab: { width: 64, height: 64, borderRadius: 32, position: 'absolute', elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  fabInner: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  toolsBlur: { padding: 20, gap: 15, borderRadius: 32, overflow: 'hidden' },
  toolsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  toolCircle: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  toolDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginHorizontal: 10 },
  colorScroll: { gap: 12, paddingHorizontal: 5 },
  colorOption: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  settingsSection: { gap: 15 },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  previewDot: { borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  settingsTitle: { fontSize: 13, fontWeight: '700', color: '#333' },
  gridFab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  gridFabText: { fontSize: 9, fontWeight: '900' },
  sliderContainer: { gap: 8 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  sliderTitle: { fontSize: 10, fontWeight: '600', color: '#999', textTransform: 'uppercase' },
  sliderValue: { fontSize: 11, fontWeight: '900', color: '#000' },
  sliderTrack: { height: 4, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 2, justifyContent: 'center' },
  sliderProgress: { height: 4, borderRadius: 2, position: 'absolute' },
  sliderKnob: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', borderWidth: 2, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3 },
  utilRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5 },
  utilBtn: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  utilIconBg: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', alignItems: 'center' },
  utilText: { fontSize: 12, fontWeight: '800', color: '#444' },
  activeToolShadow: { elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
});
