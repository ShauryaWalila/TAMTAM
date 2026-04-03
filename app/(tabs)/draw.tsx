import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, Pressable, ScrollView, Dimensions, Alert, ActivityIndicator, Image, TouchableOpacity, View, Text, DeviceEventEmitter, Modal, Platform, FlatList } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, LinearGradient, vec, Points } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS, withSpring, withTiming, useDerivedValue } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Eraser, Pencil, Send, Trash2, History, X, Palette, Undo2, Check, Settings2, ZoomIn, Hand, Move, Layers } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { formatDistanceToNow } from 'date-fns';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import base64js from 'base64-js';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const INFINITE_SIZE = 10000;
const PICKER_WIDTH = SCREEN_WIDTH * 0.75;

const HUE_COLORS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];
const QUICK_PALETTE = ['#000000', '#FFFFFF', '#8E8E93', '#FF2D55', '#34C759', '#007AFF', '#FF9500'];

interface DrawingPath {
  id: string;
  path: any;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
}

export default function DrawScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const canvasRef = useCanvasRef();
  const insets = useSafeAreaInsets();
  
  // Drawing State
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [color, setColor] = useState('#FF2D55');
  const [boardBg, setBoardBg] = useState('#FFFFFF');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [eraserWidth, setEraserWidth] = useState(40);
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser' | 'pan'>('pen');
  const [loading, setLoading] = useState(false);
  const [currentLocalPath, setCurrentLocalPath] = useState<DrawingPath | null>(null);

  // UI State
  const [showHistory, setShowHistory] = useState(false);
  const [showPicker, setShowPicker] = useState<'none' | 'stroke' | 'board'>('none');
  const [showStrokeSettings, setShowStrokeSettings] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [viewingPost, setViewingPost] = useState<any | null>(null);
  const [zoomText, setZoomText] = useState('100%');

  // Infinite Canvas Transforms
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);

  // Spectrum Picker Shared Values
  const pointerX = useSharedValue(PICKER_WIDTH * 0.8);

  useEffect(() => {
    const init = async () => {
      const name = await SecureStore.getItemAsync("user_name");
      setCurrentUserName(name);
      fetchPosts();
    };
    init();
    DeviceEventEmitter.emit('hide-navigator');
    return () => DeviceEventEmitter.emit('show-navigator');
  }, []);

  const fetchPosts = async () => {
    const { data } = await supabase.from("posts").select("*").eq('type', 'draw').order("created_at", { ascending: false }).limit(50);
    if (data) setPosts(data);
  };

  // ✍️ Drawing Handlers
  const onStart = useCallback((x: number, y: number) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newPath = Skia.Path.Make();
    const adjX = (x - translateX.value) / scale.value;
    const adjY = (y - translateY.value) / scale.value;
    newPath.moveTo(adjX, adjY);
    setCurrentLocalPath({ id, path: newPath, color: activeTool === 'eraser' ? boardBg : color, strokeWidth: (activeTool === 'eraser' ? eraserWidth : strokeWidth) / scale.value, isEraser: activeTool === 'eraser' });
  }, [color, activeTool, strokeWidth, eraserWidth, boardBg, translateX, translateY, scale]);

  const onUpdate = useCallback((x: number, y: number) => {
    if (currentLocalPath) {
      const adjX = (x - translateX.value) / scale.value;
      const adjY = (y - translateY.value) / scale.value;
      currentLocalPath.path.lineTo(adjX, adjY);
      setCurrentLocalPath({ ...currentLocalPath });
    }
  }, [currentLocalPath, translateX, translateY, scale]);

  const onEnd = useCallback(() => {
    if (currentLocalPath) {
      setPaths(prev => [...prev, currentLocalPath]);
      setCurrentLocalPath(null);
    }
  }, [currentLocalPath]);

  // 🖐️ Gestures
  const pan = Gesture.Pan().minPointers(1).maxPointers(1).enabled(activeTool !== 'pan').onBegin((e) => runOnJS(onStart)(e.x, e.y)).onUpdate((e) => runOnJS(onUpdate)(e.x, e.y)).onEnd(() => runOnJS(onEnd)());
  const oneFingerPanGesture = Gesture.Pan().minPointers(1).maxPointers(1).enabled(activeTool === 'pan').onUpdate((e) => { translateX.value = savedTranslateX.value + e.translationX; translateY.value = savedTranslateY.value + e.translationY; }).onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; });
  const pinchGesture = Gesture.Pinch().onStart((e) => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; focalX.value = e.focalX; focalY.value = e.focalY; }).onUpdate((e) => { const newScale = Math.max(0.1, Math.min(savedScale.value * e.scale, 15)); const s = newScale / savedScale.value; translateX.value = focalX.value - (focalX.value - savedTranslateX.value) * s; translateY.value = focalY.value - (focalY.value - savedTranslateY.value) * s; scale.value = newScale; runOnJS(setZoomText)(`${Math.round(newScale * 100)}%`); }).onEnd(() => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; });
  
  const composedGesture = Gesture.Simultaneous(Gesture.Exclusive(pan, oneFingerPanGesture), pinchGesture);
  const animatedTransform = useDerivedValue(() => [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }]);

  // 🌈 Spectrum Color Logic
  const onHueSelect = (x: number) => {
    const progress = Math.max(0, Math.min(x / PICKER_WIDTH, 1));
    pointerX.value = x;
    const colorIdx = progress * (HUE_COLORS.length - 1);
    const lowIdx = Math.floor(colorIdx);
    const highIdx = Math.ceil(colorIdx);
    const ratio = colorIdx - lowIdx;
    
    // Simplification for JS state update
    const selected = HUE_COLORS[lowIdx];
    if (showPicker === 'stroke') runOnJS(setColor)(selected);
    else if (showPicker === 'board') runOnJS(setBoardBg)(selected);
  };

  const hueGesture = Gesture.Pan().onUpdate((e) => runOnJS(onHueSelect)(e.x)).onBegin((e) => runOnJS(onHueSelect)(e.x));

  const handleSend = async () => {
    if (paths.length === 0) return;
    setLoading(true);
    try {
      const image = canvasRef.current?.makeImageSnapshot();
      if (image) {
        const base64 = image.encodeToBase64();
        const filePath = `drawings/${Date.now()}.png`;
        const byteArray = base64js.toByteArray(base64);
        const { error: uploadError } = await supabase.storage.from('journal-assets').upload(filePath, byteArray, { contentType: 'image/png' });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
        await supabase.from("posts").insert([{ type: 'draw', content: publicUrl, user_id: currentUserName || "user_1", reactions: { board_bg: boardBg } }]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPaths([]); fetchPosts(); setShowHistory(true);
      }
    } catch (error: any) { Alert.alert('Error', error.message); }
    finally { setLoading(false); }
  };

  return (
    <GestureHandlerRootView style={[styles.container, { backgroundColor: '#000' }]}>
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: '#000' }]}>
        
        {/* Header */}
        <View style={styles.header}>
          <View><Text style={[styles.title, { color: '#FFF' }]}>Sketchbook</Text><View style={styles.statusRow}><ZoomIn size={12} color="#888" /><Text style={styles.zoomLabel}>{zoomText}</Text></View></View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => setShowHistory(true)} style={[styles.circleBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><History size={22} color="#FFF" /></TouchableOpacity>
            <TouchableOpacity onPress={handleSend} disabled={loading || paths.length === 0} style={[styles.sendBtn, { backgroundColor: theme.tint }]}>{loading ? <ActivityIndicator color="#FFF" /> : <Send size={20} color="#FFF" />}</TouchableOpacity>
          </View>
        </View>

        {/* Board */}
        <View style={[styles.canvasContainer, { backgroundColor: '#000' }]}>
          <GestureDetector gesture={composedGesture}>
            <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
              <Group transform={animatedTransform}>
                <Rect x={-5000} y={-5000} width={10000} height={10000} color={boardBg} />
                <Group layer>
                  {paths.map((p) => (<Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" blendMode={p.isEraser ? "clear" : "srcOver"} />))}
                  {currentLocalPath && (<Path path={currentLocalPath.path} color={currentLocalPath.color} style="stroke" strokeWidth={currentLocalPath.strokeWidth} strokeCap="round" strokeJoin="round" blendMode={currentLocalPath.isEraser ? "clear" : "srcOver"} />)}
                </Group>
              </Group>
            </Canvas>
          </GestureDetector>
        </View>

        {/* Toolbar */}
        <View style={[styles.mainDock, { bottom: insets.bottom + 20 }]}>
          <BlurView intensity={90} tint="dark" style={styles.dockBlur}>
            <TouchableOpacity onPress={() => setActiveTool('pen')} style={[styles.tool, activeTool === 'pen' && styles.activeTool]}><Pencil size={22} color={activeTool === 'pen' ? theme.tint : "#AAA"} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setActiveTool('eraser')} style={[styles.tool, activeTool === 'eraser' && styles.activeTool]}><Eraser size={22} color={activeTool === 'eraser' ? theme.tint : "#AAA"} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPicker('stroke')} style={styles.tool}><View style={[styles.colorPreview, { backgroundColor: color }]} /><Palette size={12} color="#FFF" style={{position:'absolute'}} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPicker('board')} style={styles.tool}><View style={[styles.colorPreview, { backgroundColor: boardBg, borderRadius: 4 }]} /><Layers size={14} color={boardBg === '#FFFFFF' ? '#000' : '#FFF'} style={{position:'absolute'}} /></TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity onPress={() => setShowStrokeSettings(true)} style={styles.tool}><Settings2 size={22} color="#FFF" /></TouchableOpacity>
            <TouchableOpacity onPress={() => setPaths(prev => prev.slice(0, -1))} style={styles.tool}><Undo2 size={22} color="#FFF" /></TouchableOpacity>
            <TouchableOpacity onPress={() => setPaths([])} style={styles.tool}><Trash2 size={22} color="#FF3B30" /></TouchableOpacity>
          </BlurView>
        </View>

        {/* 🌈 THE UNIFIED SPECTRUM MODAL */}
        <Modal visible={showPicker !== 'none'} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setShowPicker('none')}>
            <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={styles.spectrumCard}>
              <Text style={styles.pickerTitle}>{showPicker === 'stroke' ? 'Stroke Color' : 'Board Background'}</Text>
              
              <View style={[styles.largePreview, { backgroundColor: showPicker === 'stroke' ? color : boardBg }]} />
              
              <View style={{ width: PICKER_WIDTH, height: 40, marginTop: 30 }}>
                <GestureDetector gesture={hueGesture}>
                  <Canvas style={{ flex: 1, borderRadius: 20 }}>
                    <Rect x={0} y={0} width={PICKER_WIDTH} height={40}>
                      <LinearGradient start={vec(0, 0)} end={vec(PICKER_WIDTH, 0)} colors={HUE_COLORS} />
                    </Rect>
                  </Canvas>
                </GestureDetector>
                <Animated.View style={[styles.huePointer, useAnimatedStyle(() => ({ left: pointerX.value }))] } pointerEvents="none" />
              </View>

              <View style={styles.paletteGrid}>
                {QUICK_PALETTE.map(c => (
                  <TouchableOpacity key={c} onPress={() => { if(showPicker === 'stroke') setColor(c); else setBoardBg(c); setShowPicker('none'); }} style={[styles.paletteDot, { backgroundColor: c, borderWidth: 1, borderColor: '#333' }]} />
                ))}
              </View>

              <TouchableOpacity style={[styles.doneBtn, { backgroundColor: theme.tint }]} onPress={() => setShowPicker('none')}>
                <Text style={styles.doneBtnText}>Confirm</Text>
              </TouchableOpacity>
            </MotiView>
          </Pressable>
        </Modal>

        {/* BRUSH SETTINGS MODAL */}
        <Modal visible={showStrokeSettings} transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setShowStrokeSettings(false)}>
            <View style={[styles.settingsCard, { backgroundColor: '#1A1A1A' }]}><Text style={[styles.modalTitle, { color: '#FFF' }]}>Brush Settings</Text><Text style={styles.label}>PEN SIZE</Text><View style={styles.sizeRow}>{[2, 4, 8, 16, 24].map(s => (<TouchableOpacity key={s} onPress={() => setStrokeWidth(s)} style={[styles.sizeBtn, strokeWidth === s && { backgroundColor: theme.tint }]}><View style={{ width: s, height: s, borderRadius: s/2, backgroundColor: strokeWidth === s ? '#FFF' : '#AAA' }} /></TouchableOpacity>))}</View><Text style={[styles.label, { marginTop: 25 }]}>ERASER SIZE</Text><View style={styles.sizeRow}>{[20, 40, 60, 80, 100].map(s => (<TouchableOpacity key={s} onPress={() => setEraserWidth(s)} style={[styles.sizeBtn, eraserWidth === s && { backgroundColor: theme.tint }]}> <View style={{ width: s/4, height: s/4, borderRadius: s/8, backgroundColor: eraserWidth === s ? '#FFF' : '#AAA' }} /></TouchableOpacity>))}</View><TouchableOpacity style={[styles.doneBtn, { backgroundColor: theme.tint }]} onPress={() => setShowStrokeSettings(false)}><Text style={styles.doneBtnText}>Confirm</Text></TouchableOpacity></View>
          </Pressable>
        </Modal>

        {/* HISTORY MODAL */}
        <Modal visible={showHistory} animationType="slide" transparent={false}>
          <View style={[styles.historyFull, { paddingTop: insets.top, backgroundColor: '#000' }]}>
            {!viewingPost ? (
              <>
                <View style={styles.modalHeader}><Text style={[styles.modalTitle, { color: '#FFF' }]}>Gallery</Text><TouchableOpacity onPress={() => setShowHistory(false)} style={styles.closeBtn}><X size={28} color="#FFF" /></TouchableOpacity></View>
                <FlatList data={posts} keyExtractor={item => item.id} numColumns={2} contentContainerStyle={styles.galleryList} renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => setViewingPost(item)} style={[styles.galleryItem, { backgroundColor: item.reactions?.board_bg || '#F8F9FA' }]}><Image source={{ uri: item.content }} style={styles.galleryThumb} /><View style={styles.thumbLabel}><Text style={styles.thumbUser} numberOfLines={1}>{item.user_id === currentUserName ? 'Me' : item.user_id}</Text></View></TouchableOpacity>
                )}/>
              </>
            ) : (
              <View style={styles.viewerOverlay}><TouchableOpacity style={styles.viewerClose} onPress={() => setViewingPost(null)}><X size={30} color="#FFF" /></TouchableOpacity><MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={styles.viewerContent}><View style={[styles.viewerCard, { backgroundColor: viewingPost.reactions?.board_bg || '#FFF' }]}><Image source={{ uri: viewingPost.content }} style={styles.fullImage} resizeMode="contain" /><View style={[styles.viewerInfo, { backgroundColor: 'rgba(0,0,0,0.05)', borderTopWidth: 0 }]}><View style={styles.creatorRow}><View style={[styles.avatarCircle, { backgroundColor: theme.tint }]}><Text style={styles.avatarInitial}>{viewingPost.user_id.charAt(0).toUpperCase()}</Text></View><View><Text style={[styles.viewerUserName, { color: '#000' }]}>{viewingPost.user_id === currentUserName ? 'Made by Me' : `By ${viewingPost.user_id}`}</Text><Text style={[styles.viewerDate, { color: '#666' }]}>{formatDistanceToNow(new Date(viewingPost.created_at))} ago</Text></View></View></View></View></MotiView></View>
            )}
          </View>
        </Modal>

      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, paddingVertical: 20 },
  title: { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  zoomLabel: { fontSize: 12, fontWeight: 'bold', color: '#888' },
  headerActions: { flexDirection: 'row', gap: 12 },
  circleBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  canvasContainer: { flex: 1 },
  mainDock: { position: 'absolute', alignSelf: 'center', width: '92%', elevation: 15, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20 },
  dockBlur: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 32, overflow: 'hidden', justifyContent: 'space-around', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  tool: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  activeTool: { backgroundColor: 'rgba(255,255,255,0.1)' },
  colorPreview: { width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#FFF', elevation: 3 },
  divider: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.2)' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  spectrumCard: { width: SCREEN_WIDTH * 0.85, backgroundColor: '#1A1A1A', borderRadius: 40, padding: 30, alignItems: 'center' },
  pickerTitle: { fontSize: 20, fontWeight: '900', color: '#FFF', marginBottom: 20 },
  largePreview: { width: 80, height: 80, borderRadius: 40, elevation: 10, borderWidth: 4, borderColor: '#FFF' },
  huePointer: { position: 'absolute', top: -5, width: 6, height: 50, backgroundColor: '#FFF', borderRadius: 3, borderWidth: 1, borderColor: '#000' },
  settingsCard: { width: SCREEN_WIDTH * 0.85, borderRadius: 35, padding: 30 },
  modalTitle: { fontSize: 22, fontWeight: '900', marginBottom: 25 },
  label: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1.5, marginBottom: 15 },
  sizeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sizeBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 30 },
  paletteDot: { width: 34, height: 34, borderRadius: 17, elevation: 2 },
  doneBtn: { width: '100%', height: 60, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginTop: 30 },
  doneBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25 },
  historyFull: { flex: 1 },
  galleryList: { padding: 15 },
  galleryItem: { width: (SCREEN_WIDTH - 40) / 2, height: (SCREEN_WIDTH - 40) / 2, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111', margin: 5 },
  galleryThumb: { width: '100%', height: '100%' },
  thumbLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(0,0,0,0.6)' },
  thumbUser: { fontSize: 10, fontWeight: '900', color: '#FFF', textAlign: 'center' },
  viewerOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: 60, right: 30, zIndex: 10 },
  viewerContent: { alignItems: 'center' },
  viewerCard: { width: SCREEN_WIDTH * 0.9, borderRadius: 32, overflow: 'hidden', elevation: 20 },
  fullImage: { width: '100%', height: SCREEN_WIDTH * 0.9, backgroundColor: 'transparent' },
  viewerInfo: { padding: 20, borderTopWidth: 1, borderTopColor: '#333' },
  creatorRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarInitial: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  viewerUserName: { fontSize: 16, fontWeight: '900' },
  viewerDate: { fontSize: 12, color: '#888', marginTop: 2, fontWeight: '600' }
});
