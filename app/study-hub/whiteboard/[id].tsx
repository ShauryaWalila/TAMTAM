import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, Platform, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, Points, vec } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, runOnJS, useDerivedValue, useAnimatedStyle } from 'react-native-reanimated';
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
  const [color, setColor] = useState('#000000');
  const [penSize, setPenSize] = useState(4);
  const [highSize, setHighSize] = useState(20);
  const [eraserSize, setEraserSize] = useState(40);
  
  const [penOpacity, setPenOpacity] = useState(1);
  const [highOpacity, setHighOpacity] = useState(0.35);
  
  const [activeTool, setActiveTool] = useState<'pen' | 'high' | 'eraser' | 'pan'>('pen');
  const [activeMenu, setActiveMenu] = useState<'none' | 'color' | 'size'>('none');
  const [isSaving, setIsSaving] = useState(false);
  const [isReviseMode, setIsReviseMode] = useState(false);
  const [zoomText, setZoomText] = useState('100%');
  const [showGrid, setShowGrid] = useState(true);

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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const updateZoomText = (s: number) => {
    setZoomText(`${Math.round(s * 100)}%`);
  };

  const onStart = useCallback((x: number, y: number) => {
    if (activeTool === 'pan') return;
    
    const pathId = Math.random().toString(36).substr(2, 9);
    const newPath = Skia.Path.Make();
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    newPath.moveTo(adjX, adjY);
    
    let currentSize = penSize;
    let currentOpacity = penOpacity;
    if (activeTool === 'high') {
      currentSize = highSize;
      currentOpacity = highOpacity;
    }
    if (activeTool === 'eraser') currentSize = eraserSize;

    const stroke = { 
      id: pathId,
      path: newPath, 
      color: activeTool === 'eraser' ? '#ffffff' : color, 
      strokeWidth: currentSize / scale.value,
      isEraser: activeTool === 'eraser',
      opacity: activeTool === 'eraser' ? 1 : currentOpacity
    };
    
    setCurrentLocalPath(stroke);
    setActiveMenu('none');
  }, [color, activeTool, penSize, highSize, eraserSize, penOpacity, highOpacity, translateX, translateY, scale]);

  const onUpdate = useCallback((x: number, y: number) => {
    if (!currentLocalPath) return;
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    currentLocalPath.path.lineTo(adjX, adjY);
    setCurrentLocalPath({ ...currentLocalPath });
  }, [currentLocalPath, translateX, translateY, scale]);

  const onEnd = useCallback(() => {
    if (currentLocalPath) {
      if (isReviseMode) {
        setGlassPaths(prev => [...prev, currentLocalPath]);
      } else {
        setPaths(prev => [...prev, currentLocalPath]);
      }
      setCurrentLocalPath(null);
    }
  }, [currentLocalPath, isReviseMode]);

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
    Alert.alert("Clear Board?", "This will remove all drawings.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => {
        if (isReviseMode) {
          setGlassPaths([]);
        } else {
          setPaths([]);
          setCurrentLocalPath(null);
        }
      }}
    ]);
  };

  const toggleTool = (tool: 'pen' | 'high' | 'eraser' | 'pan') => {
    setActiveTool(tool);
    setActiveMenu('none');
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
    const sliderWidth = SCREEN_WIDTH * 0.6;
    const knobX = useSharedValue(((value - min) / (max - min)) * sliderWidth);

    useEffect(() => {
      knobX.value = ((value - min) / (max - min)) * sliderWidth;
    }, [value, min, max]);

    const gesture = Gesture.Pan()
      .onUpdate((e) => {
        const x = Math.max(0, Math.min(sliderWidth, e.x));
        knobX.value = x;
        const newValue = min + (x / sliderWidth) * (max - min);
        runOnJS(onValueChange)(newValue);
      });

    const animatedKnobStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: knobX.value - 12 }],
    }));

    const animatedProgressStyle = useAnimatedStyle(() => ({
      width: knobX.value,
    }));

    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderHeader}>
          <Text style={styles.sliderTitle}>{title}</Text>
          <Text style={styles.sliderValue}>{Math.round(value)}</Text>
        </View>
        <GestureDetector gesture={gesture}>
          <View style={[styles.sliderTrack, { width: sliderWidth }]}>
            <Animated.View style={[styles.sliderProgress, animatedProgressStyle, { backgroundColor: theme.tint }]} />
            <Animated.View style={[styles.sliderKnob, animatedKnobStyle, { borderColor: theme.tint }]} />
          </View>
        </GestureDetector>
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: theme.card }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <ChevronLeft size={24} color={theme.text} />
        </TouchableOpacity>
        
        <View style={styles.headerInfo}>
          <Text style={[styles.boardTitle, { color: theme.text }]} numberOfLines={1}>{board?.title || "Med-Board"}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Animated.View style={[styles.zoomBadge, animatedZoomStyle]}>
              <ZoomIn size={10} color="#888" />
              <Text style={styles.zoomText}>{zoomText}</Text>
            </Animated.View>
            <Text style={styles.statusText}>{isReviseMode ? "👓 REVISE" : (isSaving ? "SAVING..." : "EDIT")}</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity 
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); fetchBoard(); }}
            style={[styles.actionBtn, { backgroundColor: theme.tint + '10' }]}
          ><RotateCcw size={20} color={theme.tint} /></TouchableOpacity>

          <TouchableOpacity 
            onPress={() => {
                const next = !isReviseMode;
                setIsReviseMode(next);
                if (next) setGlassPaths([]);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            }} 
            style={[styles.actionBtn, { backgroundColor: isReviseMode ? '#FF2D55' : theme.tint + '10' }]}
          >{isReviseMode ? <EyeOff size={20} color="white" /> : <Eye size={20} color={theme.tint} />}</TouchableOpacity>
          
          <TouchableOpacity 
            onPress={handleSave} 
            disabled={isSaving || isReviseMode}
            style={[styles.actionBtn, { backgroundColor: theme.tint, opacity: (isSaving || isReviseMode) ? 0.5 : 1 }]}
          >{isSaving ? <ActivityIndicator size="small" color="white" /> : <Save size={20} color="white" />}</TouchableOpacity>
        </View>
      </View>

      <AnimatePresence>
        {isReviseMode && (
          <MotiView
            from={{ height: 0, opacity: 0 }}
            animate={{ height: 26, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ backgroundColor: '#FF2D55', justifyContent: 'center', alignItems: 'center', zIndex: 9 }}
          >
            <Text style={{ color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }}>
              👓 REVISION BOARD ACTIVE • DRAWINGS TEMPORARY
            </Text>
          </MotiView>
        )}
      </AnimatePresence>

      {/* CANVAS */}
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

                {currentLocalPath && (
                  <Path path={currentLocalPath.path} color={currentLocalPath.color} style="stroke" strokeWidth={currentLocalPath.strokeWidth} strokeCap="round" strokeJoin="round" opacity={currentLocalPath.opacity} blendMode={currentLocalPath.isEraser ? "clear" : "srcOver"} />
                )}
              </Group>
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      {/* TOOLBAR */}
      <View style={styles.toolbarContainer}>
        <AnimatePresence>
          {activeMenu !== 'none' && (
            <MotiView from={{ opacity: 0, translateY: 20, scale: 0.9 }} animate={{ opacity: 1, translateY: 0, scale: 1 }} exit={{ opacity: 0, translateY: 20, scale: 0.9 }} style={styles.subToolbar}>
              <BlurView intensity={90} tint="light" style={styles.subToolbarBlur}>
                {activeMenu === 'color' && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                    {RAINBOW_COLORS.map(c => (
                      <TouchableOpacity key={c} onPress={() => { setColor(c); setActiveMenu('none'); if (activeTool==='eraser'||activeTool==='pan') setActiveTool('pen'); }} style={[styles.colorOption, { backgroundColor: c }, color === c && { borderColor: '#000', borderWidth: 2 }]} />
                    ))}
                  </ScrollView>
                )}
                {activeMenu === 'size' && (
                  <View style={styles.settingsMenu}>
                    <View style={styles.settingsHeader}>
                      <View style={[styles.previewDot, { 
                        width: Math.min(getActiveRange()?.current || 4, 30), 
                        height: Math.min(getActiveRange()?.current || 4, 30), 
                        borderRadius: 15, 
                        backgroundColor: activeTool === 'eraser' ? '#ddd' : color,
                        opacity: activeTool === 'pen' ? penOpacity : (activeTool === 'high' ? highOpacity : 1)
                      }]} />
                      <Text style={styles.settingsTitle}>{getActiveRange()?.title}</Text>
                      
                      <View style={{ flex: 1 }} />
                      
                      <TouchableOpacity 
                        onPress={() => setShowGrid(!showGrid)}
                        style={[styles.gridToggle, { backgroundColor: showGrid ? theme.tint : 'rgba(0,0,0,0.05)' }]}
                      >
                        <Text style={[styles.gridToggleText, { color: showGrid ? '#fff' : '#888' }]}>GRID</Text>
                      </TouchableOpacity>
                    </View>

                    {getActiveRange() && (
                      <CustomSlider 
                        value={getActiveRange()?.current} 
                        onValueChange={getActiveRange()?.setter}
                        min={getActiveRange()?.min}
                        max={getActiveRange()?.max}
                        title="Size"
                      />
                    )}

                    {activeTool !== 'eraser' && activeTool !== 'pan' && (
                      <CustomSlider 
                        value={activeTool === 'pen' ? penOpacity * 100 : highOpacity * 100}
                        onValueChange={(v: number) => activeTool === 'pen' ? setPenOpacity(v / 100) : setHighOpacity(v / 100)}
                        min={5}
                        max={100}
                        title="Opacity (%)"
                      />
                    )}
                  </View>
                )}
              </BlurView>
            </MotiView>
          )}
        </AnimatePresence>

        <View style={[styles.mainDock, { backgroundColor: theme.card }]}>
          <TouchableOpacity onPress={() => toggleTool('pen')} style={[styles.tool, activeTool === 'pen' && styles.activeTool]}>
            <Pencil size={22} color={activeTool === 'pen' ? theme.tint : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => toggleTool('high')} style={[styles.tool, activeTool === 'high' && styles.activeTool]}>
            <Highlighter size={22} color={activeTool === 'high' ? theme.tint : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => toggleTool('eraser')} style={[styles.tool, activeTool === 'eraser' && styles.activeTool]}>
            <Eraser size={22} color={activeTool === 'eraser' ? theme.tint : theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => toggleTool('pan')} style={[styles.tool, activeTool === 'pan' && styles.activeTool]}>
            <Hand size={22} color={activeTool === 'pan' ? theme.tint : theme.text} />
          </TouchableOpacity>
          
          <View style={styles.dockDivider} />
          
          <TouchableOpacity onPress={() => setActiveMenu(activeMenu === 'color' ? 'none' : 'color')} style={styles.tool}>
            <Palette size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveMenu(activeMenu === 'size' ? 'none' : 'size')} style={styles.tool}>
            <Type size={22} color={theme.text} />
          </TouchableOpacity>
          
          <View style={styles.dockDivider} />
          
          <TouchableOpacity onPress={resetView} style={styles.tool}>
            <Target size={22} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={clearCanvas} style={styles.tool}>
            <Trash2 size={22} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingBottom: 15, borderBottomWidth: 0.5, borderBottomColor: 'rgba(150,150,150,0.1)', zIndex: 10 },
  iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerInfo: { flex: 1, marginLeft: 10 },
  boardTitle: { fontSize: 18, fontWeight: '800' },
  statusText: { fontSize: 9, fontWeight: '900', color: '#888', letterSpacing: 1 },
  zoomBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  zoomText: { fontSize: 9, fontWeight: '800', color: '#888' },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  canvasContainer: { flex: 1 },
  toolbarContainer: { position: 'absolute', bottom: 50, alignSelf: 'center', width: '90%', alignItems: 'center', gap: 15 },
  mainDock: { height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 8, elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 15 },
  tool: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  activeTool: { backgroundColor: 'rgba(0,0,0,0.05)' },
  dockDivider: { width: 1, height: 24, backgroundColor: 'rgba(0,0,0,0.1)', marginHorizontal: 2 },
  subToolbar: { width: '100%', borderRadius: 24, overflow: 'hidden', elevation: 5 },
  subToolbarBlur: { padding: 20 },
  scrollContent: { gap: 15, paddingRight: 10 },
  colorOption: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  settingsMenu: { gap: 20 },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewDot: { borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', justifyContent: 'center', alignItems: 'center' },
  settingsTitle: { fontSize: 14, fontWeight: '700', color: '#333' },
  sliderContainer: { gap: 10 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderTitle: { fontSize: 11, fontWeight: '600', color: '#888', textTransform: 'uppercase' },
  sliderValue: { fontSize: 12, fontWeight: '800', color: '#333' },
  sliderTrack: { height: 6, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 3, justifyContent: 'center' },
  sliderProgress: { height: 6, borderRadius: 3 },
  sliderKnob: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', borderWidth: 2, elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2 },
  gridToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  gridToggleText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
});
