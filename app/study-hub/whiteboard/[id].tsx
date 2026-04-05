import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, Platform, ActivityIndicator, Alert, ScrollView, Modal, TextInput, Linking } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, Points, vec, Image, Text as SkiaText, useImage, matchFont, Circle } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, runOnJS, useDerivedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Eraser, Pencil, Trash2, ChevronLeft, Target, Hand, ZoomIn, Save, Eye, EyeOff, RotateCcw, Highlighter, Palette, Settings2, Image as ImageIcon, Link as LinkIcon, X, Plus, Check, ExternalLink } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

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

interface BoardImage {
  id: string; uri: string; x: number; y: number; width: number; height: number;
}

interface BoardLink {
  id: string; url: string; title: string; x: number; y: number;
}

// Standalone Image Component
const RemoteImage = ({ img, isSelected }: { img: BoardImage, isSelected: boolean }) => {
  const skiaImg = useImage(img.uri);
  if (!skiaImg) return null;
  return (
    <Group>
      <Image image={skiaImg} x={img.x} y={img.y} width={img.width} height={img.height} fit="contain" />
      {isSelected && (
        <>
          <Rect x={img.x} y={img.y} width={img.width} height={img.height} color="#AF52DE" style="stroke" strokeWidth={3} />
          <Circle cx={img.x} cy={img.y} r={12} color="#AF52DE" />
          <Circle cx={img.x + img.width} cy={img.y} r={12} color="#AF52DE" />
          <Circle cx={img.x} cy={img.y + img.height} r={12} color="#AF52DE" />
          <Circle cx={img.x + img.width} cy={img.y + img.height} r={12} color="#AF52DE" />
        </>
      )}
    </Group>
  );
};

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
  const [activePath, setActivePath] = useState<DrawingPath | null>(null);
  const [images, setImages] = useState<BoardImage[]>([]);
  const [links, setLinks] = useState<BoardLink[]>([]);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'image' | 'link' | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  const [color, setColor] = useState('#000000');
  const [penSize, setPenSize] = useState(4);
  const [highSize, setHighSize] = useState(25);
  const [eraserSize, setEraserSize] = useState(50);
  const [penOpacity, setPenOpacity] = useState(1);
  const [highOpacity, setHighOpacity] = useState(0.35);
  
  const [activeTool, setActiveTool] = useState<'pen' | 'high' | 'eraser' | 'pan'>('pen');
  const [activeMenu, setActiveMenu] = useState<'none' | 'media' | 'settings'>('none');
  const [isSaving, setIsSaving] = useState(false);
  const [isReviseMode, setIsReviseMode] = useState(false);
  const [zoomText, setZoomText] = useState('100%');
  const [showGrid, setShowGrid] = useState(true);
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [isDraggable, setIsDraggable] = useState(false);

  // Animation Shared Values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  const fabX = useSharedValue(20);
  const fabY = useSharedValue(SCREEN_HEIGHT / 2 - 32);
  const savedFabX = useSharedValue(20);
  const savedFabY = useSharedValue(SCREEN_HEIGHT / 2 - 32);

  const isDraggingObjectSV = useSharedValue(false);
  const resizeModeSV = useSharedValue(0); // 0: none, 1: tl, 2: tr, 3: bl, 4: br
  const activePathRef = useRef<DrawingPath | null>(null);

  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');

  const fontFamily = Platform.select({ ios: "Arial", android: "sans-serif" }) || "sans-serif";
  const fontLink = matchFont({ fontFamily, fontSize: 16, fontWeight: "bold" });
  const fontSticker = matchFont({ fontFamily, fontSize: 50 });

  useEffect(() => { fetchBoard(); }, [id]);

  const fetchBoard = async () => {
    const { data } = await supabase.from('study_whiteboards').select('*').eq('id', id).single();
    if (data) {
      setBoard(data);
      if (data.canvas_data && Array.isArray(data.canvas_data)) {
        setPaths(data.canvas_data.map((p: any) => ({ ...p, path: Skia.Path.MakeFromSVGString(p.pathString) || Skia.Path.Make() })));
      }
      setImages(data.images || []);
      setLinks(data.links || []);
    }
  };

  const handleSave = async (fP?: DrawingPath[], fI?: BoardImage[], fL?: BoardLink[]) => {
    if (isReviseMode) return;
    setIsSaving(true);
    const sP = (fP || paths).map(p => ({
      id: p.id, color: p.color, strokeWidth: p.strokeWidth, isEraser: p.isEraser,
      opacity: p.opacity || 1, pathString: p.path.toSVGString()
    }));
    await supabase.from('study_whiteboards').update({ 
      canvas_data: sP, images: fI || images, links: fL || links, updated_at: new Date().toISOString() 
    }).eq('id', id);
    setIsSaving(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => { if (!isReviseMode && board) handleSave(); }, 5000);
    return () => clearTimeout(timer);
  }, [paths, images, links]);

  const updateMenuPos = useCallback((id: string, type: 'image' | 'link', curI: BoardImage[], curL: BoardLink[]) => {
    const obj = type === 'image' ? curI.find(i => i.id === id) : curL.find(l => l.id === id);
    if (obj) {
      const sx = obj.x * scale.value + translateX.value;
      const sy = obj.y * scale.value + translateY.value;
      setMenuPos({ x: sx + 20, y: sy - 60 });
    }
  }, [scale, translateX, translateY]);

  const onStart = useCallback((x: number, y: number) => {
    const s = scale.value;
    const worldX = (x - translateX.value) / s;
    const worldY = (y - translateY.value) / s;

    if (activeTool === 'pan') {
      if (selectedId && selectedType === 'image') {
        const img = images.find(i => i.id === selectedId);
        if (img) {
          const pad = 35 / s;
          if (Math.abs(worldX - img.x) < pad && Math.abs(worldY - img.y) < pad) { resizeModeSV.value = 1; return; }
          if (Math.abs(worldX - (img.x + img.width)) < pad && Math.abs(worldY - img.y) < pad) { resizeModeSV.value = 2; return; }
          if (Math.abs(worldX - img.x) < pad && Math.abs(worldY - (img.y + img.height)) < pad) { resizeModeSV.value = 3; return; }
          if (Math.abs(worldX - (img.x + img.width)) < pad && Math.abs(worldY - (img.y + img.height)) < pad) { resizeModeSV.value = 4; return; }
        }
      }
      const hitL = [...links].reverse().find(l => worldX >= l.x - 20 && worldX <= l.x + 160 && worldY >= l.y - 20 && worldY <= l.y + 60);
      if (hitL) { setSelectedId(hitL.id); setSelectedType('link'); isDraggingObjectSV.value = true; updateMenuPos(hitL.id, 'link', images, links); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); return; }
      const hitI = [...images].reverse().find(img => worldX >= img.x && worldX <= img.x + img.width && worldY >= img.y && worldY <= img.y + img.height);
      if (hitI) { setSelectedId(hitI.id); setSelectedType('image'); isDraggingObjectSV.value = true; updateMenuPos(hitI.id, 'image', images, links); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); return; }
      setSelectedId(null); setSelectedType(null); isDraggingObjectSV.value = false; resizeModeSV.value = 0; return;
    }
    
    const pathId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const newPath = Skia.Path.Make();
    newPath.moveTo(worldX, worldY);
    newPath.lineTo(worldX + 0.1, worldY + 0.1);
    const stroke: DrawingPath = { id: pathId, path: newPath, color: activeTool === 'eraser' ? '#ffffff' : color, strokeWidth: (activeTool === 'high' ? highSize : (activeTool === 'eraser' ? eraserSize : penSize)), isEraser: activeTool === 'eraser', opacity: activeTool === 'high' ? highOpacity : (activeTool === 'eraser' ? 1 : penOpacity) };
    activePathRef.current = stroke;
    setActivePath(stroke);
  }, [color, activeTool, penSize, highSize, eraserSize, penOpacity, highOpacity, scale, links, images, selectedId, selectedType, updateMenuPos]);

  const onUpdate = useCallback((x: number, y: number, dx: number, dy: number) => {
    const s = scale.value;
    if (activeTool === 'pan') {
      const adX = dx / s; const adY = dy / s;
      if (resizeModeSV.value !== 0 && selectedId) {
        setImages(prev => {
          const next = prev.map(img => {
            if (img.id !== selectedId) return img;
            let nI = { ...img };
            if (resizeModeSV.value === 4) { nI.width = Math.max(50, img.width + adX); nI.height = Math.max(50, img.height + adY); }
            else if (resizeModeSV.value === 1) { nI.x += adX; nI.y += adY; nI.width -= adX; nI.height -= adY; }
            else if (resizeModeSV.value === 2) { nI.y += adY; nI.width += adX; nI.height -= adY; }
            else if (resizeModeSV.value === 3) { nI.x += adX; nI.width -= adX; nI.height += adY; }
            return nI;
          });
          updateMenuPos(selectedId, 'image', next, links); return next;
        });
        return;
      }
      if (isDraggingObjectSV.value && selectedId) {
        if (selectedType === 'image') {
          setImages(p => {
            const next = p.map(i => i.id === selectedId ? { ...i, x: i.x + adX, y: i.y + adY } : i);
            updateMenuPos(selectedId, 'image', next, links); return next;
          });
        } else {
          setLinks(p => {
            const next = p.map(i => i.id === selectedId ? { ...i, x: i.x + adX, y: i.y + adY } : i);
            updateMenuPos(selectedId, 'link', images, next); return next;
          });
        }
        return;
      }
    }
    if (activePathRef.current) {
      activePathRef.current.path.lineTo((x - translateX.value) / s, (y - translateY.value) / s);
      setActivePath({ ...activePathRef.current, path: activePathRef.current.path.copy() });
    }
  }, [scale, activeTool, selectedId, selectedType, updateMenuPos, images, links]);

  const onEnd = useCallback(() => {
    if (activePathRef.current) {
      const final = { ...activePathRef.current, path: activePathRef.current.path.copy() };
      if (isReviseMode) setGlassPaths(prev => [...prev, final]);
      else setPaths(prev => [...prev, final]);
    }
    activePathRef.current = null; setActivePath(null);
  }, [isReviseMode]);

  const setSavedTranslate = useCallback((x: number, y: number) => { savedTranslateX.value = x; savedTranslateY.value = y; }, []);

  const dragGesture = Gesture.Pan().minPointers(1).maxPointers(1).minDistance(0)
    .onBegin((e) => runOnJS(onStart)(e.x, e.y))
    .onUpdate((e) => {
      if (activeTool === 'pan' && (isDraggingObjectSV.value || resizeModeSV.value !== 0)) runOnJS(onUpdate)(e.x, e.y, e.changeX, e.changeY);
      else if (activeTool === 'pan') { translateX.value = savedTranslateX.value + e.translationX; translateY.value = savedTranslateY.value + e.translationY; }
      else runOnJS(onUpdate)(e.x, e.y, e.changeX, e.changeY);
    })
    .onFinalize(() => { 
      isDraggingObjectSV.value = false; resizeModeSV.value = 0; 
      runOnJS(onEnd)(); runOnJS(setSavedTranslate)(translateX.value, translateY.value);
    });

  const pinchGesture = Gesture.Pinch()
    .onStart((e) => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; focalX.value = e.focalX; focalY.value = e.focalY; })
    .onUpdate((e) => {
      const nS = Math.max(0.1, Math.min(savedScale.value * e.scale, 15));
      const s = nS / savedScale.value;
      translateX.value = focalX.value - (focalX.value - savedTranslateX.value) * s;
      translateY.value = focalY.value - (focalY.value - savedTranslateY.value) * s;
      scale.value = nS; runOnJS(setZoomText)(`${Math.round(nS * 100)}%`);
    })
    .onEnd(() => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; });

  const threeFingerPanGesture = Gesture.Pan().minPointers(3)
    .onStart(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; })
    .onUpdate((e) => { translateX.value = savedTranslateX.value + e.translationX; translateY.value = savedTranslateY.value + e.translationY; })
    .onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; });

  const composedGesture = Gesture.Exclusive(threeFingerPanGesture, pinchGesture, dragGesture);

  const combinedFabGesture = Gesture.Exclusive(
    Gesture.Tap().numberOfTaps(2).onEnd(() => { runOnJS(setIsDraggable)(!isDraggable); runOnJS(Haptics.notificationAsync)(Haptics.NotificationFeedbackType.Success); }),
    Gesture.Tap().numberOfTaps(1).onEnd(() => { runOnJS(setIsToolsExpanded)(!isToolsExpanded); runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light); }),
    Gesture.Pan().enabled(isDraggable).onStart(() => { savedFabX.value = fabX.value; savedFabY.value = fabY.value; }).onUpdate((e) => { fabX.value = savedFabX.value + e.translationX; fabY.value = savedFabY.value + e.translationY; }).onEnd(() => { savedFabX.value = fabX.value; savedFabY.value = fabY.value; })
  );

  const deleteSelected = () => {
    if (!selectedId) return;
    const nI = images.filter(i => i.id !== selectedId); const nL = links.filter(l => l.id !== selectedId);
    setImages(nI); setLinks(nL); setSelectedId(null); setSelectedType(null);
    handleSave(paths, nI, nL); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const addImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.6 });
    if (!result.canceled) {
      const asset = result.assets[0];
      const worldX = (SCREEN_WIDTH/2 - translateX.value) / scale.value - 150;
      const worldY = (SCREEN_HEIGHT/2 - translateY.value) / scale.value - 150;
      setImages(p => [...p, { id: Math.random().toString(36).substr(2, 9), uri: result.assets[0].uri, x: worldX, y: worldY, width: 300, height: (result.assets[0].height / result.assets[0].width) * 300 }]);
      setActiveMenu('none');
    }
  };

  const clearAll = () => {
    Alert.alert("Clear Board?", "Permanently remove everything?", [{ text: "Cancel" }, { text: "Clear", style: "destructive", onPress: () => { setPaths([]); setGlassPaths([]); setImages([]); setLinks([]); setSelectedId(null); setSelectedType(null); handleSave([], [], []); setRenderTrigger(p => p + 1); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); }}]);
  };

  const CustomSlider = ({ value, onValueChange, min, max, title }: any) => {
    const sliderWidth = SCREEN_WIDTH * 0.65; const knobX = useSharedValue(((value - min) / (max - min)) * sliderWidth);
    useEffect(() => { knobX.value = ((value - min) / (max - min)) * sliderWidth; }, [value, min, max]);
    const gesture = Gesture.Pan().onUpdate((e) => { const x = Math.max(0, Math.min(sliderWidth, e.x)); knobX.value = x; runOnJS(onValueChange)(min + (x / sliderWidth) * (max - min)); }).onEnd(() => { runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light); });
    return (
      <View style={styles.sliderContainer}>
        <View style={styles.sliderHeader}><Text style={styles.sliderTitle}>{title}</Text><Text style={styles.sliderValue}>{Math.round(value)}</Text></View>
        <GestureDetector gesture={gesture}><View style={[styles.sliderTrack, { width: sliderWidth }]}><Animated.View style={[styles.sliderProgress, { width: knobX.value, backgroundColor: theme.tint }]} /><Animated.View style={[styles.sliderKnob, useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value - 12 }] })), { borderColor: theme.tint }]} /></View></GestureDetector>
      </View>
    );
  };

  const animatedTransform = useDerivedValue(() => [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }]);
  const fabAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fabX.value }, { translateY: fabY.value }], borderWidth: isDraggable ? 2 : 0, borderColor: '#fff', shadowOpacity: isDraggable ? 0.8 : 0.4 }));
  const menuAnimatedStyle = useAnimatedStyle(() => { const expandUp = fabY.value > SCREEN_HEIGHT / 2; return { position: 'absolute', left: Math.max(20, Math.min(fabX.value - (SCREEN_WIDTH * 0.45) + 32, SCREEN_WIDTH - (SCREEN_WIDTH * 0.9) - 20)), bottom: expandUp ? (SCREEN_HEIGHT - fabY.value + 10) : undefined, top: expandUp ? undefined : (fabY.value + 74), width: SCREEN_WIDTH * 0.9 }; });

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={[styles.headerWrapper, { paddingTop: insets.top + 5 }]}><BlurView intensity={90} tint="light" style={styles.headerBlur}><TouchableOpacity onPress={() => router.back()} style={styles.headerIconBtn}><ChevronLeft size={22} color="#000" strokeWidth={2.5} /></TouchableOpacity><View style={styles.headerInfo}><Text style={styles.boardTitle} numberOfLines={1}>{board?.title || "Med-Board"}</Text><View style={styles.statusRow}><Animated.View style={[styles.zoomBadge, { opacity: scale.value !== 1 ? 1 : 0.4 }]}><ZoomIn size={10} color="#666" /><Text style={styles.zoomText}>{zoomText}</Text></Animated.View><View style={[styles.statusDot, { backgroundColor: isSaving ? theme.tint : (isReviseMode ? '#FF2D55' : '#34C759') }]} /><Text style={[styles.statusText, { color: isReviseMode ? '#FF2D55' : '#666' }]}>{isReviseMode ? "REVISION" : (isSaving ? "SAVING..." : "SYNCED")}</Text></View></View><View style={styles.headerActions}><TouchableOpacity onPress={() => { scale.value=1; translateX.value=0; translateY.value=0; runOnJS(setZoomText)('100%'); }} style={styles.headerActionBtn}><Target size={20} color="#000" strokeWidth={2} /></TouchableOpacity><TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); fetchBoard(); }} style={styles.headerActionBtn}><RotateCcw size={20} color="#000" strokeWidth={2} /></TouchableOpacity></View></BlurView></View>

      <AnimatePresence>{isReviseMode && (<MotiView from={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} exit={{ scaleX: 0, opacity: 0 }} style={styles.revisionIndicatorWrapper}><View style={styles.revisionIndicator}><View style={styles.revisionPulse} /><Text style={styles.revisionIndicatorText}>REVISION BOARD ACTIVE</Text></View></MotiView>)}</AnimatePresence>

      <GestureDetector gesture={composedGesture}>
        <View style={styles.canvasContainer}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
            <Group transform={animatedTransform}>
              <Rect x={-INFINITE_SIZE/2} y={-INFINITE_SIZE/2} width={INFINITE_SIZE} height={INFINITE_SIZE} color="#fff" />
              {showGrid && <Points points={useMemo(() => { const pts = []; for (let x = -5000; x <= 5000; x += 100) { for (let y = -5000; y <= 5000; y += 100) { pts.push(vec(x, y)); } } return pts; }, [])} mode="points" color="#f0f0f0" strokeWidth={2} />}
              <Group layer={false}>{images.map(img => <RemoteImage key={img.id} img={img} isSelected={selectedId === img.id} />)}{links.map(link => (<Group key={link.id} transform={[{ translateX: link.x }, { translateY: link.y }]}>{link.url ? (<Group><Rect x={-10} y={-10} width={140} height={45} color={selectedId === link.id ? "#AF52DE" : "#000"} rx={8} /><SkiaText x={10} y={20} text={link.title} font={fontLink} color="#fff" /></Group>) : (<SkiaText x={0} y={30} text={link.title} font={fontSticker} opacity={selectedId === link.id ? 0.5 : 1} />)}</Group>))}</Group>
              <Group layer>{paths.map((p) => p && p.path && (<Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity} blendMode={p.isEraser ? "clear" : "srcOver"} />))}{glassPaths.map((p) => p && p.path && (<Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity * 0.6} />))}{activePath && activePath.path && (<Path key={`cur-${renderTrigger}`} path={activePath.path} color={activePath.color} style="stroke" strokeWidth={activePath.strokeWidth} strokeCap="round" strokeJoin="round" opacity={activePath.opacity} blendMode={activePath.isEraser ? "clear" : "srcOver"} />)}</Group>
            </Group>
          </Canvas>
        </View>
      </GestureDetector>

      {selectedId && (<MotiView from={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1, left: menuPos.x, top: menuPos.y }} style={styles.contextMenu}><TouchableOpacity onPress={deleteSelected} style={[styles.contextBtn, { backgroundColor: '#FF3B30' }]}><Trash2 size={18} color="white" /></TouchableOpacity>{selectedType === 'link' && links.find(l => l.id === selectedId)?.url && (<TouchableOpacity onPress={() => { const l = links.find(i => i.id === selectedId); if (l?.url) Linking.openURL(l.url); }} style={[styles.contextBtn, { backgroundColor: theme.tint }]}><ExternalLink size={18} color="white" /></TouchableOpacity>)}<TouchableOpacity onPress={() => { setSelectedId(null); setSelectedType(null); }} style={styles.contextBtn}><Check size={18} color="#000" /></TouchableOpacity></MotiView>)}

      <View style={styles.fabContainer} pointerEvents="box-none">
        <AnimatePresence>{isToolsExpanded && (<MotiView from={{ opacity: 0, scale: 0.5, translateY: 50 }} animate={{ opacity: 1, scale: 1, translateY: 0 }} exit={{ opacity: 0, scale: 0.5, translateY: 50 }} style={menuAnimatedStyle}><TouchableOpacity activeOpacity={1} onPress={() => setIsToolsExpanded(false)} style={StyleSheet.absoluteFill} /><BlurView intensity={80} tint="light" style={styles.toolsBlur}><View style={styles.toolsRow}><TouchableOpacity onPress={() => setActiveTool('pen')} style={[styles.toolCircle, { backgroundColor: activeTool === 'pen' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Pencil size={22} color={activeTool === 'pen' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('high')} style={[styles.toolCircle, { backgroundColor: activeTool === 'high' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Highlighter size={22} color={activeTool === 'high' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('eraser')} style={[styles.toolCircle, { backgroundColor: activeTool === 'eraser' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Eraser size={22} color={activeTool === 'eraser' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('pan')} style={[styles.toolCircle, { backgroundColor: activeTool === 'pan' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Hand size={22} color={activeTool === 'pan' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveMenu(activeMenu==='settings'?'none':'settings')} style={[styles.toolCircle, { backgroundColor: activeMenu === 'settings' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Settings2 size={22} color={activeMenu === 'settings' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveMenu(activeMenu==='media'?'none':'media')} style={[styles.toolCircle, { backgroundColor: activeMenu === 'media' ? theme.tint : 'rgba(0,0,0,0.08)' }]}><Plus size={24} color={activeMenu === 'media' ? '#fff' : '#000'} /></TouchableOpacity></View>
              {activeMenu === 'settings' && (<View style={styles.settingsTray}><View style={styles.settingsHeader}><View style={[styles.previewDot, { width: 24, height: 24, borderRadius: 12, backgroundColor: activeTool === 'eraser' ? '#ddd' : color, opacity: activeTool === 'high' ? highOpacity : penOpacity }]} /><Text style={styles.settingsTitle}>Adjust Tool</Text><View style={{flex:1}} /><TouchableOpacity onPress={() => { setShowGrid(!showGrid); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={[styles.gridFab, { backgroundColor: showGrid ? theme.tint : 'rgba(0,0,0,0.15)' }]}><Text style={[styles.gridFabText, { color: showGrid ? '#fff' : '#000' }]}>GRID {showGrid ? 'ON' : 'OFF'}</Text></TouchableOpacity></View><CustomSlider value={activeTool==='pen'?penSize:(activeTool==='high'?highSize:eraserSize)} onValueChange={(v:number)=>activeTool==='pen'?setPenSize(v):(activeTool==='high'?setHighSize(v):setEraserSize(v))} min={activeTool==='pen'?1:(activeTool==='high'?5:10)} max={activeTool==='pen'?40:(activeTool==='high'?150:200)} title="Size" />{activeTool !== 'eraser' && activeTool !== 'pan' && (<CustomSlider value={(activeTool === 'pen' ? penOpacity : highOpacity) * 100} onValueChange={(v: number) => activeTool === 'pen' ? setPenOpacity(v / 100) : setHighOpacity(v / 100)} min={5} max={100} title="Opacity (%)" />)}</View>)}
              {activeMenu === 'media' && (<View style={styles.mediaTray}><TouchableOpacity onPress={addImage} style={styles.mediaItem}><ImageIcon size={20} color={theme.tint}/><Text style={styles.mediaLabel}>Image</Text></TouchableOpacity><TouchableOpacity onPress={() => { setLinkModalVisible(true); setIsToolsExpanded(false); }} style={styles.mediaItem}><LinkIcon size={20} color={theme.tint}/><Text style={styles.mediaLabel}>Link Pin</Text></TouchableOpacity><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:15}}>{['🧠','🫀','🦴','🧬','💉','🧪'].map(s => <TouchableOpacity key={s} onPress={()=>{ const worldX = (SCREEN_WIDTH/2 - translateX.value) / scale.value - 30; const worldY = (SCREEN_HEIGHT/2 - translateY.value) / scale.value - 30; setLinks(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), url: '', title: s, x: worldX, y: worldY }]); setActiveMenu('none'); }}><Text style={{fontSize:28}}>{s}</Text></TouchableOpacity>)}</ScrollView></View>)}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorScroll}>{RAINBOW_COLORS.map(c => <TouchableOpacity key={c} onPress={() => { setColor(c); if (activeTool==='eraser'||activeTool==='pan') setActiveTool('pen'); }} style={[styles.colorOption, { backgroundColor: c }, color === c && { borderColor: '#000', borderWidth: 2 }]} />)}</ScrollView>
              <View style={styles.toolDivider} /><View style={styles.utilRow}><TouchableOpacity onPress={() => { scale.value=1; translateX.value=0; translateY.value=0; runOnJS(setZoomText)('100%'); }} style={styles.utilBtn}><View style={styles.utilIconBg}><Target size={18} color="#000" strokeWidth={2.5} /></View><Text style={styles.utilText}>Reset View</Text></TouchableOpacity><TouchableOpacity onPress={clearAll} style={styles.utilBtn}><View style={[styles.utilIconBg, { backgroundColor: '#FF3B3015' }]}><Trash2 size={18} color="#FF3B30" strokeWidth={2.5} /></View><Text style={[styles.utilText, { color: '#FF3B30' }]}>Clear All</Text></TouchableOpacity></View><TouchableOpacity onPress={() => { setIsReviseMode(!isReviseMode); setIsToolsExpanded(false); }} style={[styles.reviseBtn, { backgroundColor: isReviseMode ? '#FF2D55' : 'rgba(0,0,0,0.05)' }]}><Text style={{ color: isReviseMode ? '#fff' : '#000', fontWeight: '900' }}>{isReviseMode ? 'EXIT REVISION' : 'ENTER REVISION'}</Text></TouchableOpacity></BlurView></MotiView>)}</AnimatePresence>
        <GestureDetector gesture={combinedFabGesture}><Animated.View style={[styles.mainFab, { backgroundColor: theme.tint }, fabAnimatedStyle]}><View style={styles.fabInner}><MotiView animate={{ rotate: isToolsExpanded ? '45deg' : '0deg' }} transition={{ type: 'spring', damping: 15 }}><Palette size={28} color="white" /></MotiView></View></Animated.View></GestureDetector>
      </View>

      <Modal visible={linkModalVisible} transparent animationType="slide"><View style={styles.modalOverlay}><View style={[styles.modalContent, { backgroundColor: theme.card }]}><Text style={styles.modalTitle}>Drop Reference Pin</Text><TextInput style={styles.input} placeholder="Title" value={newLinkTitle} onChangeText={setNewLinkTitle} /><TextInput style={styles.input} placeholder="URL" value={newLinkUrl} onChangeText={setNewLinkUrl} autoCapitalize="none" /><View style={{flexDirection:'row', gap:10, marginTop:10}}><TouchableOpacity onPress={()=>setLinkModalVisible(false)} style={styles.modalBtn}><Text>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={() => { const worldX = (SCREEN_WIDTH/2 - translateX.value)/scale.value - 20; const worldY = (SCREEN_HEIGHT/2 - translateY.value)/scale.value - 20; setLinks(p => [...p, { id:Math.random().toString(36).substr(2,9), url:newLinkUrl, title:newLinkTitle||'Link', x:worldX, y:worldY }]); setLinkModalVisible(false); }} style={[styles.modalBtn, {backgroundColor:theme.tint}]}><Text style={{color:'#fff', fontWeight:'900'}}>Add</Text></TouchableOpacity></View></View></View></Modal>
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
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, color: '#666' },
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
  mainFab: { width: 64, height: 64, borderRadius: 32, position: 'absolute', elevation: 12, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, justifyContent: 'center', alignItems: 'center' },
  fabInner: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  toolsBlur: { padding: 20, gap: 15, borderRadius: 32, overflow: 'hidden' },
  toolsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toolCircle: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  toolDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginHorizontal: 10 },
  colorScroll: { gap: 12, paddingHorizontal: 5 },
  colorOption: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  settingsTray: { padding: 15, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 24, gap: 15 },
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
  mediaTray: { padding: 15, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 24, gap: 15 },
  mediaItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mediaLabel: { fontSize: 13, fontWeight: '800', color: '#333' },
  utilRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5 },
  utilBtn: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  utilIconBg: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.08)', justifyContent: 'center', alignItems: 'center' },
  utilText: { fontSize: 12, fontWeight: '800', color: '#444' },
  reviseBtn: { padding: 14, borderRadius: 18, alignItems: 'center' },
  contextMenu: { position: 'absolute', backgroundColor: '#fff', padding: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 20, shadowOpacity: 0.2, borderWidth: 1, borderColor: '#eee', zIndex: 2000 },
  contextBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalContent: { padding: 25, borderRadius: 30, gap: 15 },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  input: { padding: 15, borderRadius: 15, backgroundColor: '#f5f5f5', fontWeight: '600' },
  modalBtn: { flex: 1, padding: 15, borderRadius: 15, alignItems: 'center' },
  activeToolShadow: { elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
});
