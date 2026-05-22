import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, TouchableOpacity, Dimensions, ScrollView, Modal, TextInput, Linking, Alert, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import { Canvas, Path, Skia, useCanvasRef, Group, Rect, Points, vec, Image, Text as SkiaText, useImage, matchFont, Circle, RoundedRect } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, runOnJS, useDerivedValue, useAnimatedStyle, cancelAnimation } from 'react-native-reanimated';
import { Eraser, Pencil, Trash2, ChevronLeft, Target, Hand, ZoomIn, RotateCcw, Highlighter, Palette, Settings2, Image as ImageIcon, Link as LinkIcon, Plus, Check, ExternalLink, Undo2, Sparkles, BrainCircuit, X, Database, PlusCircle } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { BlurView } from 'expo-blur';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import { db, queueSyncOperation, generateUUID } from '@/lib/db';
import { analyzeWhiteboardDrawing } from '@/lib/aiEngine';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { Text } from '@/components/Themed';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SESSION_ID = Math.random().toString(36).substring(7);

// --- Helper Components ---
const RemoteImage = ({ img, isSelected }: any) => {
  const skiaImg = useImage(img.uri);
  if (!skiaImg) return null;
  return (
    <Group>
      <Image image={skiaImg} x={img.x} y={img.y} width={img.width} height={img.height} fit="contain" />
      {isSelected && (
        <Group>
          <Rect x={img.x} y={img.y} width={img.width} height={img.height} color="#AF52DE" style="stroke" strokeWidth={3} />
          <Circle cx={img.x} cy={img.y} r={12} color="#AF52DE" />
          <Circle cx={img.x + img.width} cy={img.y} r={12} color="#AF52DE" />
          <Circle cx={img.x} cy={img.y + img.height} r={12} color="#AF52DE" />
          <Circle cx={img.x + img.width} cy={img.y + img.height} r={12} color="#AF52DE" />
        </Group>
      )}
    </Group>
  );
};

const CustomSlider = ({ value, onValueChange, min, max, title, theme }: any) => {
  const sliderWidth = SCREEN_WIDTH * 0.6;
  const knobX = useSharedValue(((value - min) / (max - min)) * sliderWidth);
  useEffect(() => { knobX.value = ((value - min) / (max - min)) * sliderWidth; }, [value]);
  const g = Gesture.Pan().onUpdate((e) => {
    const x = Math.max(0, Math.min(sliderWidth, e.x));
    knobX.value = x;
    runOnJS(onValueChange)(min + (x / sliderWidth) * (max - min));
  });
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value - 8 }] }));
  const fillStyle = useAnimatedStyle(() => ({ width: knobX.value }));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 10, color: "#999" }}>{title}</Text>
        <Text style={{ fontSize: 10, fontWeight: "bold", color: "black" }}>{Math.round(value)}</Text>
      </View>
      <GestureDetector gesture={g}>
        <View style={{ height: 4, backgroundColor: "rgba(0,0,0,0.1)", borderRadius: 2 }}>
          <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: theme.tint }, fillStyle]} />
          <Animated.View style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
};

const RAINBOW = ['#000', '#8E8E93', '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#FFF'];

export default function WhiteboardScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = Colors[useColorScheme() ?? 'light'];
  const canvasRef = useCanvasRef();

  const [paths, setPaths] = useState<any[]>([]);
  const [glassPaths, setGlassPaths] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState<any>(null);
  const [images, setImages] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [board, setBoard] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<any>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [activeTool, setActiveTool] = useState<'pen' | 'high' | 'eraser' | 'pan'>('pen');
  const [activeMenu, setActiveMenu] = useState<'none' | 'media' | 'settings'>('none');
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [isDraggable, setIsDraggable] = useState(false);
  const [isReviseMode, setIsReviseMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [zoomText, setZoomText] = useState('100%');
  const [showGrid, setShowGrid] = useState(true);
  const [color, setColor] = useState('#000');
  const [penSize, setPenSize] = useState(4);
  const [highSize, setHighSize] = useState(25);
  const [eraserSize, setEraserSize] = useState(50);
  const [penOpacity, setPenOpacity] = useState(1);
  const [highOpacity, setHighOpacity] = useState(0.35);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [suggestedDeck, setSuggestedDeck] = useState<any>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const fabX = useSharedValue(20);
  const fabY = useSharedValue(SCREEN_HEIGHT / 2);
  const savedFabX = useSharedValue(20);
  const savedFabY = useSharedValue(SCREEN_HEIGHT / 2);

  const [linkModal, setLinkModal] = useState(false);
  const [textModal, setTextModal] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [lUrl, setLUrl] = useState('');
  const [lTitle, setLTitle] = useState('');
  const [newText, setNewText] = useState('');

  const pathsRef = useRef(paths);
  const imagesRef = useRef(images);
  const linksRef = useRef(links);
  const reviseRef = useRef(isReviseMode);
  const boardRef = useRef(board);
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef<any>(null);

  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { linksRef.current = links; }, [links]);
  useEffect(() => { reviseRef.current = isReviseMode; }, [isReviseMode]);
  useEffect(() => { boardRef.current = board; }, [board]);

  const gridPoints = useMemo(() => { 
    const pts: any[] = []; 
    for (let x = -5000; x <= 5000; x += 100) for (let y = -5000; y <= 5000; y += 100) pts.push(vec(x, y)); 
    return pts; 
  }, []);

  const fontLink = useMemo(() => matchFont({ fontFamily: "Arial", fontSize: 16, fontWeight: "bold" }), []);
  const makeStickerFont = (size: number) => matchFont({ fontFamily: "Arial", fontSize: size });

  const loadDataIntoState = (data: any) => {
    setBoard(data);
    let cd = data.canvas_data || {};
    if (typeof cd === 'string') { try { cd = JSON.parse(cd); } catch (e) { cd = {}; } }
    const rawPaths = Array.isArray(cd) ? cd : (cd.paths || []);
    setPaths(rawPaths.map((p: any) => ({ ...p, path: Skia.Path.MakeFromSVGString(p.pathString) || Skia.Path.Make() })));
    setImages(data.images || cd.images || []);
    setLinks(data.links || cd.links || []);
  };

  const handleSave = async (fP?: any[], fI?: any[], fL?: any[]) => {
    if (reviseRef.current) return;
    try {
      setIsSaving(true);
      const savePaths = fP ?? pathsRef.current;
      const sP = savePaths.map((p: any) => ({ id: p.id, color: p.color, strokeWidth: p.strokeWidth, isEraser: p.isEraser, opacity: p.opacity || 1, pathString: p.path?.toSVGString?.() || '' }));
      const canvasData = { paths: sP, images: fI ?? imagesRef.current, links: fL ?? linksRef.current };
      const updatedAt = new Date().toISOString();
      db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, [id as string, boardRef.current?.title || 'Board', JSON.stringify(canvasData), updatedAt]);
      // NOTE: do NOT include last_editor here — that column may not exist on
      // Supabase. Unknown columns cause the entire UPDATE to fail silently
      // and the partner device never receives the new canvas.
      queueSyncOperation('study_whiteboards', id as string, 'UPDATE', { canvas_data: canvasData, updated_at: updatedAt });
    } catch (e) { console.warn('Save failed:', e); }
    finally { setIsSaving(false); }
  };

  const fetchBoard = async () => {
    let localUpdatedAt = 0;
    try {
      const local = db.getFirstSync(`SELECT * FROM study_whiteboards WHERE id = ?`, [id as string]) as any;
      if (local) { loadDataIntoState(local); localUpdatedAt = new Date(local.updated_at).getTime(); }
    } catch (e) {}
    const { data } = await supabase.from('study_whiteboards').select('*').eq('id', id).single();
    if (data) {
      const remoteUpdatedAt = new Date(data.updated_at).getTime();
      if (remoteUpdatedAt > localUpdatedAt) {
        loadDataIntoState(data);
        try { db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, [data.id, data.title, typeof data.canvas_data === 'string' ? data.canvas_data : JSON.stringify(data.canvas_data), data.updated_at]); } catch(err) {}
      }
    }
  };

  useEffect(() => { 
    fetchBoard(); 
    SecureStore.getItemAsync('user_name').then(name => setCurrentUser(name?.toLowerCase() || ''));
    const channel = supabase.channel(`whiteboard_${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'study_whiteboards', filter: `id=eq.${id}` }, (payload: any) => {
      // Ignore self-echoes and incoming events while the user is mid-stroke.
      if (isDrawingRef.current) return;
      const remoteData = payload.new || payload.record;
      if (!remoteData) return;
      const remoteUpdatedAt = new Date(remoteData.updated_at).getTime();
      const local = db.getFirstSync(`SELECT * FROM study_whiteboards WHERE id = ?`, [id as string]) as any;
      const localUpdatedAt = local ? new Date(local.updated_at).getTime() : 0;
      // Only pull when the remote row is strictly newer. Equal timestamps
      // mean it's our own change echoed back; ignore.
      if (remoteUpdatedAt > localUpdatedAt) {
        try { db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, canvas_data, updated_at) VALUES (?, ?, ?, ?)`, [remoteData.id, remoteData.title, typeof remoteData.canvas_data === 'string' ? remoteData.canvas_data : JSON.stringify(remoteData.canvas_data), remoteData.updated_at]); } catch {}
        loadDataIntoState(remoteData);
      }
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const runAIVision = async () => {
    if (isAnalyzing) return;
    setIsAnalyzing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      const snapshot = canvasRef.current?.makeImageSnapshot();
      if (snapshot) {
        const base64 = snapshot.encodeToBase64();
        
        // 🔥 GATHER EXISTING QUESTIONS TO PREVENT REPETITION
        const existingCards = db.getAllSync(
          `SELECT front_content FROM study_cards 
           JOIN study_decks ON study_cards.deck_id = study_decks.id 
           WHERE study_decks.user_id = ?`, 
          [currentUser]
        ) as any[];
        const existingQs = existingCards.map(c => c.front_content);

        const result = await analyzeWhiteboardDrawing(base64, board?.title || "Board", currentUser, existingQs);
        if (result) {
          const existing = db.getFirstSync(`SELECT id, title FROM study_decks WHERE title LIKE ? LIMIT 1`, [`%${result.subject}%`]) as any;
          setSuggestedDeck(existing || null);
          setAnalysisResult(result);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (error: any) {
      Alert.alert("AI Vision Error", error.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveToDeck = (deckId: string | null) => {
    if (!analysisResult) return;
    let targetDeckId = deckId;
    const now = new Date().toISOString();
    if (!targetDeckId) {
      targetDeckId = generateUUID();
      db.runSync(`INSERT INTO study_decks (id, title, user_id, created_at) VALUES (?, ?, ?, ?)`, [targetDeckId, analysisResult.subject || `Board: ${board?.title}`, currentUser, now]);
      queueSyncOperation('study_decks', targetDeckId, 'INSERT', { id: targetDeckId, title: analysisResult.subject, user_id: currentUser, created_at: now });
    }
    analysisResult.cards.forEach((card: any) => {
      const cardId = generateUUID();
      db.runSync(`INSERT INTO study_cards (id, deck_id, front_content, back_content, created_at) VALUES (?, ?, ?, ?, ?)`, [cardId, targetDeckId, card.front, card.back, now]);
      queueSyncOperation('study_cards', cardId, 'INSERT', { id: cardId, deck_id: targetDeckId, front_content: card.front, back_content: card.back, created_at: now });
    });
    setAnalysisResult(null); setSuggestedDeck(null); DeviceEventEmitter.emit('DATA_REFRESH');
    Alert.alert("Knowledge Saved", `Added ${analysisResult.cards.length} new cards!`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const onDrawStart = useCallback((x: number, y: number) => {
    isDrawingRef.current = true;
    const s = scale.value;
    const wX = (x - translateX.value) / s;
    const wY = (y - translateY.value) / s;
    const sw = (activeTool === 'high' ? highSize : (activeTool === 'eraser' ? eraserSize : penSize)) / s;
    const nP = Skia.Path.Make();
    nP.moveTo(wX, wY);
    nP.lineTo(wX + 0.1, wY + 0.1);
    const newPath = { id: generateUUID(), path: nP, color: activeTool === 'eraser' ? '#fff' : color, strokeWidth: sw, isEraser: activeTool === 'eraser', opacity: activeTool === 'high' ? highOpacity : (activeTool === 'eraser' ? 1 : penOpacity), startX: wX, startY: wY, swOrig: sw };
    currentPathRef.current = newPath;
    lastPointRef.current = { x: wX, y: wY };
    setCurrentPath(newPath);
  }, [activeTool, color, penSize, highSize, eraserSize, penOpacity, highOpacity, scale, translateX, translateY]);

  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const rafPendingRef = useRef(false);

  const onDrawUpdate = useCallback((x: number, y: number) => {
    const cp = currentPathRef.current;
    if (!cp) return;
    const wX = (x - translateX.value) / scale.value;
    const wY = (y - translateY.value) / scale.value;
    const lp = lastPointRef.current;
    // Quadratic smoothing: each new sample becomes a quad control point with
    // the midpoint of (previous, current) as the end-point. Removes the
    // jagged line-segments that show up at high sample rates (Apple Pencil).
    if (lp) {
      const midX = (lp.x + wX) / 2;
      const midY = (lp.y + wY) / 2;
      cp.path.quadTo(lp.x, lp.y, midX, midY);
    } else {
      cp.path.lineTo(wX, wY);
    }
    lastPointRef.current = { x: wX, y: wY };

    // Throttle React re-renders to the display vsync (~60-120 Hz). Pencil
    // emits ~120 samples/sec; without this, every setState collides with the
    // next sample and the stroke skips.
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      const cur = currentPathRef.current;
      if (cur) setCurrentPath({ ...cur });
    });
  }, [scale, translateX, translateY]);

  const onDrawFinalize = useCallback(() => {
    const cp = currentPathRef.current;
    if (cp) {
      let finalPath = cp.path.copy();
      const bounds = finalPath.getBounds();
      if (bounds.width < 0.1 && bounds.height < 0.1) {
        finalPath = Skia.Path.Make();
        finalPath.addCircle(cp.startX, cp.startY, cp.swOrig / 2);
      }
      const finalized = { ...cp, path: finalPath };
      if (reviseRef.current) setGlassPaths(p => [...p, finalized]);
      else setPaths(prev => { const next = [...prev, finalized]; handleSave(next); return next; });
      currentPathRef.current = null;
      setCurrentPath(null);
      lastPointRef.current = null;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    isDrawingRef.current = false;
  }, []);

  const onDrawTap = useCallback((x: number, y: number) => {
    const s = scale.value;
    const wX = (x - translateX.value) / s;
    const wY = (y - translateY.value) / s;
    const sw = (activeTool === 'high' ? highSize : (activeTool === 'eraser' ? eraserSize : penSize)) / s;
    const dotPath = Skia.Path.Make();
    dotPath.addCircle(wX, wY, sw / 2);
    const dot = { id: generateUUID(), path: dotPath, color: activeTool === 'eraser' ? '#fff' : color, strokeWidth: sw, isEraser: activeTool === 'eraser', opacity: activeTool === 'high' ? highOpacity : (activeTool === 'eraser' ? 1 : penOpacity), startX: wX, startY: wY, swOrig: sw };
    if (reviseRef.current) setGlassPaths(p => [...p, dot]);
    else setPaths(prev => { const next = [...prev, dot]; handleSave(next); return next; });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [activeTool, color, penSize, highSize, eraserSize, penOpacity, highOpacity, scale, translateX, translateY]);

  const undo = () => {
    if (paths.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPaths(prev => { const next = prev.slice(0, -1); handleSave(next); return next; });
  };

  const editLink = (linkId: string) => {
    const link = links.find(l => l.id === linkId);
    if (!link) return;
    setEditingLinkId(linkId); setLTitle(link.title || ''); setLUrl(link.url || ''); setLinkModal(true);
  };

  const openLink = (linkId: string) => {
    const link = links.find(l => l.id === linkId);
    if (link?.url) Linking.openURL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const newImages = images.filter(i => i.id !== selectedId);
    const newLinks = links.filter(l => l.id !== selectedId);
    setImages(newImages); setLinks(newLinks); setSelectedId(null); setSelectedType(null);
    handleSave(paths, newImages, newLinks);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const addImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.6 });
    if (!res.canceled) {
      const asset = res.assets[0];
      const wX = (SCREEN_WIDTH / 2 - translateX.value) / scale.value - 150;
      const wY = (SCREEN_HEIGHT / 2 - translateY.value) / scale.value - 150;
      const nI = [...images, { id: generateUUID(), uri: asset.uri, x: wX, y: wY, width: 300, height: (asset.height / asset.width) * 300 }];
      setImages(nI); setActiveMenu('none'); handleSave(paths, nI, links);
    }
  };

  const onPanStart = useCallback((x: number, y: number) => {
    const s = scale.value;
    const wX = (x - translateX.value) / s;
    const wY = (y - translateY.value) / s;
    dragId.current = null; dragType.current = null; resizeCorner.current = 0;
    if (selectedId && selectedType === 'image') {
      const img = images.find(i => i.id === selectedId);
      if (img) {
        const p = 35 / s;
        if (Math.abs(wX - img.x) < p && Math.abs(wY - img.y) < p) { resizeCorner.current = 1; return; }
        if (Math.abs(wX - (img.x + img.width)) < p && Math.abs(wY - img.y) < p) { resizeCorner.current = 2; return; }
        if (Math.abs(wX - img.x) < p && Math.abs(wY - (img.y + img.height)) < p) { resizeCorner.current = 3; return; }
        if (Math.abs(wX - (img.x + img.width)) < p && Math.abs(wY - (img.y + img.height)) < p) { resizeCorner.current = 4; return; }
      }
    }
    if (selectedId && selectedType === 'sticker') {
      const lnk = links.find(l => l.id === selectedId);
      if (lnk) {
        const fs = lnk.fontSize || 40;
        const handleX = lnk.x + fs * 0.6 * (lnk.title?.length || 1);
        const handleY = lnk.y + fs;
        const p = 40 / s;
        if (Math.abs(wX - handleX) < p && Math.abs(wY - handleY) < p) { resizeCorner.current = 4; return; }
      }
    }
    const hitL = [...links].reverse().find(l => {
      if (l.url) return wX >= l.x - 10 && wX <= l.x + 130 && wY >= l.y - 10 && wY <= l.y + 30;
      return wX >= l.x - 10 && wX <= l.x + 60 && wY >= l.y - 10 && wY <= l.y + 60;
    });
    if (hitL) { dragId.current = hitL.id; dragType.current = hitL.url ? 'link' : 'sticker'; setSelectedId(hitL.id); setSelectedType(hitL.url ? 'link' : 'sticker'); return; }
    const hitI = [...images].reverse().find(img => wX >= img.x && wX <= img.x + img.width && wY >= img.y && wY <= img.y + img.height);
    if (hitI) { dragId.current = hitI.id; dragType.current = 'image'; setSelectedId(hitI.id); setSelectedType('image'); return; }
    setSelectedId(null); setSelectedType(null);
  }, [images, links, selectedId, selectedType, scale, translateX, translateY]);

  const onPanUpdate = useCallback((x: number, y: number, dx: number, dy: number, totalX: number, totalY: number) => {
    const s = scale.value;
    const adX = dx / s; const adY = dy / s;
    if (!dragId.current && resizeCorner.current === 0) { translateX.value = savedTranslateX.value + totalX; translateY.value = savedTranslateY.value + totalY; return; }
    if (resizeCorner.current !== 0 && selectedId) {
      if (selectedType === 'image') {
        setImages(prev => prev.map(img => {
          if (img.id !== selectedId) return img;
          let n = { ...img };
          if (resizeCorner.current === 4) { n.width = Math.max(50, img.width + adX); n.height = Math.max(50, img.height + adY); }
          else if (resizeCorner.current === 1) { n.x += adX; n.y += adY; n.width = Math.max(50, n.width - adX); n.height = Math.max(50, n.height - adY); }
          else if (resizeCorner.current === 2) { n.y += adY; n.width = Math.max(50, n.width + adX); n.height = Math.max(50, n.height - adY); }
          else if (resizeCorner.current === 3) { n.x += adX; n.width = Math.max(50, n.width - adX); n.height = Math.max(50, n.height + adY); }
          return n;
        }));
      } else {
        setLinks(prev => prev.map(l => {
          if (l.id !== selectedId) return l;
          return { ...l, fontSize: Math.max(10, Math.min(200, (l.fontSize || 40) + adX * 0.5)) };
        }));
      }
      return;
    }
    if (dragId.current && selectedId) {
      if (dragType.current === 'image') setImages(p => p.map(i => i.id === selectedId ? { ...i, x: i.x + adX, y: i.y + adY } : i));
      else setLinks(p => p.map(i => i.id === selectedId ? { ...i, x: i.x + adX, y: i.y + adY } : i));
    }
  }, [selectedId, scale, savedTranslateX, savedTranslateY]);

  const onPanEnd = useCallback(() => {
    if (dragId.current || resizeCorner.current !== 0) handleSave(paths, images, links);
    savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; dragId.current = null; resizeCorner.current = 0;
  }, [paths, images, links]);

  const dragId = useRef<string | null>(null);
  const dragType = useRef<string | null>(null);
  const resizeCorner = useRef(0);

  const dotTapGesture = Gesture.Tap().enabled(activeTool !== 'pan').onEnd((e) => runOnJS(onDrawTap)(e.x, e.y));
  const drawGesture = Gesture.Pan().minPointers(1).maxPointers(1).enabled(activeTool !== 'pan').onStart((e) => runOnJS(onDrawStart)(e.x, e.y)).onUpdate((e) => runOnJS(onDrawUpdate)(e.x, e.y)).onFinalize(() => runOnJS(onDrawFinalize)());
  const lastTX = useSharedValue(0); const lastTY = useSharedValue(0);
  const handGesture = Gesture.Pan().minPointers(1).maxPointers(1).enabled(activeTool === 'pan').onBegin((e) => runOnJS(onPanStart)(e.x, e.y)).onUpdate((e) => {
    const dx = e.translationX - lastTX.value; const dy = e.translationY - lastTY.value;
    lastTX.value = e.translationX; lastTY.value = e.translationY;
    runOnJS(onPanUpdate)(e.x, e.y, dx, dy, e.translationX, e.translationY);
  }).onEnd(() => runOnJS(onPanEnd)());
  const pinchGesture = Gesture.Pinch().onStart((e) => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; focalX.value = e.focalX; focalY.value = e.focalY; }).onUpdate((e) => {
    const nS = Math.max(0.1, Math.min(savedScale.value * e.scale, 15.0)); const s = nS / savedScale.value;
    translateX.value = focalX.value - (focalX.value - savedTranslateX.value) * s; translateY.value = focalY.value - (focalY.value - savedTranslateY.value) * s;
    scale.value = nS; runOnJS(setZoomText)(`${Math.round(nS * 100)}%`);
  }).onEnd(() => { savedScale.value = scale.value; savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; });
  const composedGesture = Gesture.Simultaneous(Gesture.Exclusive(drawGesture, dotTapGesture, handGesture), pinchGesture, Gesture.Pan().minPointers(3).onUpdate(e => { translateX.value = savedTranslateX.value + e.translationX; translateY.value = savedTranslateY.value + e.translationY; }).onEnd(() => { savedTranslateX.value = translateX.value; savedTranslateY.value = translateY.value; }));

  const animatedTransform = useDerivedValue(() => [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }]);
  const fabG = Gesture.Exclusive(Gesture.Tap().numberOfTaps(2).onEnd(() => runOnJS(setIsDraggable)(!isDraggable)), Gesture.Tap().numberOfTaps(1).onEnd(() => runOnJS(setIsToolsExpanded)(!isToolsExpanded)), Gesture.Pan().enabled(isDraggable).onStart(() => { savedFabX.value = fabX.value; savedFabY.value = fabY.value; }).onUpdate(e => { fabX.value = savedFabX.value + e.translationX; fabY.value = savedFabY.value + e.translationY; }));

  const fabStyle = useAnimatedStyle(() => ({ transform: [{ translateX: fabX.value }, { translateY: fabY.value }], borderWidth: isDraggable ? 2 : 0, borderColor: '#fff' }));
  const toolsStyle = useAnimatedStyle(() => ({ position: 'absolute' as const, left: 20, bottom: fabY.value > SCREEN_HEIGHT / 2 ? (SCREEN_HEIGHT - fabY.value + 10) : undefined, top: fabY.value > SCREEN_HEIGHT / 2 ? undefined : (fabY.value + 74), width: SCREEN_WIDTH - 40 }));

  if (!board) return <View style={styles.centered}><ActivityIndicator color={theme.tint} /></View>;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={[styles.header, { paddingTop: insets.top + 5, zIndex: 1000 }]}>
        <BlurView intensity={90} tint="light" style={styles.blur}>
          <TouchableOpacity onPress={() => router.back()}><ChevronLeft size={22} color="#000" /></TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={{ fontWeight: 'bold', color: 'black' }}>{board?.title || "Board"}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={styles.zoom}><ZoomIn size={10} color="#666" /><Text style={{ fontSize: 9, color: 'black' }}>{zoomText}</Text></View>
              <View style={[styles.dot, { backgroundColor: isSaving ? theme.tint : (isReviseMode ? '#FF2D55' : '#34C759') }]} />
              <Text style={{ fontSize: 9, color: '#666' }}>{isReviseMode ? "REVISION" : (isSaving ? "SAVING" : "SYNCED")}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={runAIVision} disabled={isAnalyzing} style={[styles.btn, { backgroundColor: '#AF52DE15' }]}>
            {isAnalyzing ? <ActivityIndicator size="small" color="#AF52DE" /> : <Sparkles size={20} color="#AF52DE" />}
          </TouchableOpacity>
          <TouchableOpacity onPress={undo} style={styles.btn}><Undo2 size={20} color="#000" /></TouchableOpacity>
          <TouchableOpacity onPress={() => { scale.value = 1; translateX.value = 0; translateY.value = 0; setZoomText('100%'); }} style={styles.btn}><Target size={20} color="#000" /></TouchableOpacity>
        </BlurView>
      </View>

      <View style={{ flex: 1 }}>
        <GestureDetector gesture={composedGesture}>
          <Canvas ref={canvasRef} style={StyleSheet.absoluteFill}>
            <Group transform={animatedTransform}>
              <Rect x={-15000} y={-15000} width={30000} height={30000} color="#fff" />
              {showGrid && <Points points={gridPoints} mode="points" color="#f0f0f0" strokeWidth={2} />}
              {images.map((img: any) => <RemoteImage key={img.id} img={img} isSelected={selectedId === img.id} />)}
              {links.map((l: any) => (
                <Group key={l.id} transform={[{ translateX: l.x }, { translateY: l.y }]}>
                  {l.url ? (
                    <Group>
                      <RoundedRect x={-10} y={-10} width={140} height={40} r={8} color={selectedId === l.id ? "#AF52DE" : "#000"} />
                      <SkiaText x={10} y={18} text={l.title || 'Link'} font={fontLink} color="#fff" />
                    </Group>
                  ) : (
                    <Group>
                      <SkiaText x={0} y={Math.round((l.fontSize || 40) * 0.8)} text={l.title} font={makeStickerFont(Math.round(l.fontSize || 40))} color="#000" opacity={selectedId === l.id ? 0.6 : 1} />
                      {selectedId === l.id && (
                        <Group>
                          <Circle cx={Math.round((l.fontSize || 40) * 0.6 * (l.title?.length || 1))} cy={Math.round((l.fontSize || 40))} r={12} color="#AF52DE" />
                        </Group>
                      )}
                    </Group>
                  )}
                </Group>
              ))}
              <Group layer>
                {paths.map((p) => p && p.path && (<Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity} blendMode={p.isEraser ? "clear" : "srcOver"} />))}
                {glassPaths.map((p) => p && p.path && (<Path key={p.id} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" opacity={p.opacity * 0.6} />))}
                {currentPath && currentPath.path && (<Path path={currentPath.path} color={currentPath.color} style="stroke" strokeWidth={currentPath.strokeWidth} strokeCap="round" strokeJoin="round" opacity={currentPath.opacity} blendMode={currentPath.isEraser ? "clear" : "srcOver"} />)}
              </Group>
            </Group>
          </Canvas>
        </GestureDetector>
      </View>

      <Modal visible={analysisResult !== null} transparent animationType="slide">
        <View style={styles.mOver}>
          <View style={[styles.mCont, { backgroundColor: '#fff', paddingBottom: 25 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <BrainCircuit size={24} color="#AF52DE" />
                <Text style={{ fontSize: 20, fontWeight: '900', color: 'black' }}>Smart Insight</Text>
              </View>
              <TouchableOpacity onPress={() => setAnalysisResult(null)}><X size={24} color="#000" /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }} contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={{ fontSize: 16, color: '#444', lineHeight: 24, marginBottom: 15 }}>{analysisResult?.summary}</Text>
              
              <View style={styles.suggestionBox}>
                <Database size={18} color="#AF52DE" />
                <Text style={styles.suggestionText}>
                  {suggestedDeck ? `Suggested Deck: "${suggestedDeck.title}"` : `New Subject: "${analysisResult?.subject}"`}
                </Text>
              </View>

              <View style={styles.cardsBox}>
                <Text style={styles.sectionLabel}>NEW CUE CARDS ({analysisResult?.cards?.length})</Text>
                {analysisResult?.cards?.map((c: any, i: number) => (
                  <View key={i} style={styles.cardPreview}><Text style={styles.cardQ}>Q: {c.front}</Text></View>
                ))}
              </View>
            </ScrollView>

            <View style={{ gap: 10 }}>
              <TouchableOpacity onPress={() => saveToDeck(suggestedDeck?.id || null)} style={[styles.mBtn, { backgroundColor: '#AF52DE' }]}>
                <Check size={20} color="white" style={{ marginRight: 8 }} />
                <Text style={{ color: 'white', fontWeight: '900' }}>
                  {suggestedDeck ? `ADD TO ${suggestedDeck.title.toUpperCase()}` : 'CREATE NEW DECK'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => saveToDeck(null)} style={[styles.mBtn, { backgroundColor: 'rgba(0,0,0,0.05)' }]}>
                <PlusCircle size={20} color="#666" style={{ marginRight: 8 }} />
                <Text style={{ color: '#666', fontWeight: '900' }}>CREATE AS NEW DECK REGARDLESS</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAnalysisResult(null)} style={[styles.mBtn, { backgroundColor: '#FF3B3010' }]}><Text style={{ color: '#FF3B30', fontWeight: '900' }}>DISCARD</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {selectedId && (
        <MotiView from={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1, left: menuPos.x, top: menuPos.y }} style={styles.ctx}>
          <TouchableOpacity onPress={deleteSelected} style={[styles.cBtn, { backgroundColor: '#FF3B30' }]}><Trash2 size={18} color="#fff" /></TouchableOpacity>
          {selectedType === 'link' && (<TouchableOpacity onPress={() => editLink(selectedId)} style={[styles.cBtn, { backgroundColor: '#007AFF' }]}><Pencil size={18} color="#fff" /></TouchableOpacity>)}
          {selectedType === 'link' && (<TouchableOpacity onPress={() => openLink(selectedId)} style={[styles.cBtn, { backgroundColor: '#34C759' }]}><ExternalLink size={18} color="#fff" /></TouchableOpacity>)}
          <TouchableOpacity onPress={() => { setSelectedId(null); setSelectedType(null); }} style={styles.cBtn}><Check size={18} color="#000" /></TouchableOpacity>
        </MotiView>
      )}

      <View style={styles.fabWrap} pointerEvents="box-none">
        <AnimatePresence>{isToolsExpanded && (<MotiView from={{ opacity: 0, scale: 0.5, translateY: 50 }} animate={{ opacity: 1, scale: 1, translateY: 0 }} exit={{ opacity: 0, scale: 0.5, translateY: 50 }} style={toolsStyle}><BlurView intensity={80} tint="light" style={styles.tBlur}><View style={styles.tRow}><TouchableOpacity onPress={() => setActiveTool('pen')} style={[styles.tCir, activeTool === 'pen' && { backgroundColor: theme.tint }]}><Pencil size={20} color={activeTool === 'pen' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('high')} style={[styles.tCir, activeTool === 'high' && { backgroundColor: theme.tint }]}><Highlighter size={20} color={activeTool === 'high' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('eraser')} style={[styles.tCir, activeTool === 'eraser' && { backgroundColor: theme.tint }]}><Eraser size={20} color={activeTool === 'eraser' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveTool('pan')} style={[styles.tCir, activeTool === 'pan' && { backgroundColor: theme.tint }]}><Hand size={20} color={activeTool === 'pan' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveMenu(activeMenu === 'settings' ? 'none' : 'settings')} style={[styles.tCir, activeMenu === 'settings' && { backgroundColor: theme.tint }]}><Settings2 size={20} color={activeMenu === 'settings' ? '#fff' : '#000'} /></TouchableOpacity><TouchableOpacity onPress={() => setActiveMenu(activeMenu === 'media' ? 'none' : 'media')} style={[styles.tCir, activeMenu === 'media' && { backgroundColor: theme.tint }]}><Plus size={20} color={activeMenu === 'media' ? '#fff' : '#000'} /></TouchableOpacity></View>
              {activeMenu === 'settings' && (<View style={styles.tray}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><View style={[styles.dot, { backgroundColor: color, opacity: activeTool === 'high' ? highOpacity : penOpacity }]} /><Text style={{ fontSize: 12, color: 'black' }}>Adjust Tool</Text></View><CustomSlider value={activeTool==='pen'?penSize:(activeTool==='high'?highSize:eraserSize)} onValueChange={(v:any)=>activeTool==='pen'?setPenSize(v):(activeTool==='high'?setHighSize(v):setEraserSize(v))} min={1} max={100} title="Size" theme={theme} />{activeTool !== 'eraser' && activeTool !== 'pan' && (<CustomSlider value={(activeTool==='pen'?penOpacity:highOpacity)*100} onValueChange={(v:any)=>activeTool==='pen'?setPenOpacity(v/100):setHighOpacity(v/100)} min={5} max={100} title="Opacity" theme={theme} />)}<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>{RAINBOW.map(c => <TouchableOpacity key={c} onPress={() => { setColor(c); setActiveTool('pen'); }} style={[styles.cOpt, { backgroundColor: c }, color === c && { borderColor: '#000', borderWidth: 2 }]} />)}</ScrollView></View>)}
              {activeMenu === 'media' && (<View style={styles.tray}><TouchableOpacity onPress={addImage} style={styles.mItem}><ImageIcon size={18} color={theme.tint}/><Text style={{ color: '#000' }}>Image</Text></TouchableOpacity><TouchableOpacity onPress={() => { setEditingLinkId(null); setLUrl(''); setLTitle(''); setLinkModal(true); setIsToolsExpanded(false); }} style={styles.mItem}><LinkIcon size={18} color={theme.tint}/><Text style={{ color: '#000' }}>Link Pin</Text></TouchableOpacity><TouchableOpacity onPress={() => { setNewText(''); setTextModal(true); setIsToolsExpanded(false); }} style={styles.mItem}><Text style={{ fontSize: 18, color: theme.tint }}>Aa</Text><Text style={{ color: '#000' }}>Text / Sticker</Text></TouchableOpacity></View>)}
              <TouchableOpacity onPress={() => { setIsReviseMode(!isReviseMode); setIsToolsExpanded(false); }} style={[styles.revBtn, { backgroundColor: isReviseMode ? '#FF2D55' : 'rgba(0,0,0,0.05)' }]}><Text style={{ color: isReviseMode ? '#fff' : '#000', fontWeight: 'bold' }}>{isReviseMode ? 'EXIT REVISION' : 'ENTER REVISION'}</Text></TouchableOpacity></BlurView></MotiView>)}</AnimatePresence>
        <GestureDetector gesture={fabG}><Animated.View style={[styles.fab, { backgroundColor: theme.tint }, fabStyle]}><Palette size={28} color="#fff" /></Animated.View></GestureDetector>
      </View>

      <Modal visible={linkModal} transparent animationType="slide">
        <View style={styles.mOver}>
          <View style={[styles.mCont, { backgroundColor: theme.card }]}>
            <Text style={{ fontWeight: "bold", fontSize: 18, color: "black" }}>{editingLinkId ? "Edit Link Pin" : "Add Link Pin"}</Text>
            <TextInput style={[styles.inp, { color: "#000" }]} placeholder="Title" placeholderTextColor="#999" value={lTitle} onChangeText={setLTitle} />
            <TextInput style={[styles.inp, { color: "#000" }]} placeholder="URL (https://...)" placeholderTextColor="#999" value={lUrl} onChangeText={setLUrl} autoCapitalize="none" keyboardType="url" />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => { setLinkModal(false); setEditingLinkId(null); setLUrl(""); setLTitle(""); }} style={styles.mBtn}><Text style={{ color: "#000" }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => {
                if (editingLinkId) {
                  const updated = linksRef.current.map(l => l.id === editingLinkId ? { ...l, url: lUrl, title: lTitle || "Link" } : l);
                  setLinks(updated); handleSave(undefined, undefined, updated); setSelectedId(null); setSelectedType(null);
                } else {
                  const wX = (SCREEN_WIDTH / 2 - translateX.value) / scale.value - 20;
                  const wY = (SCREEN_HEIGHT / 2 - translateY.value) / scale.value - 20;
                  const newLinks = [...linksRef.current, { id: generateUUID(), url: lUrl, title: lTitle || "Link", x: wX, y: wY }];
                  setLinks(newLinks); handleSave(undefined, undefined, newLinks);
                }
                setLinkModal(false); setEditingLinkId(null); setLUrl(""); setLTitle("");
              }} style={[styles.mBtn, { backgroundColor: theme.tint }]}><Text style={{ color: "#fff", fontWeight: "bold" }}>{editingLinkId ? "Save" : "Add"}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={textModal} transparent animationType="slide">
        <View style={styles.mOver}>
          <View style={[styles.mCont, { backgroundColor: theme.card }]}>
            <Text style={{ fontWeight: "bold", fontSize: 18, color: "black" }}>Add Text / Sticker</Text>
            <TextInput style={[styles.inp, { color: "#000", fontSize: 18 }]} placeholder="Type text..." placeholderTextColor="#999" value={newText} onChangeText={setNewText} autoFocus />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => setTextModal(false)} style={styles.mBtn}><Text style={{ color: "#000" }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => {
                if (!newText.trim()) return;
                const wX = (SCREEN_WIDTH / 2 - translateX.value) / scale.value - 30;
                const wY = (SCREEN_HEIGHT / 2 - translateY.value) / scale.value - 30;
                const newLinks = [...linksRef.current, { id: generateUUID(), url: "", title: newText.trim(), x: wX, y: wY, fontSize: 40 }];
                setLinks(newLinks); setTextModal(false); setNewText(""); handleSave(undefined, undefined, newLinks);
              }} style={[styles.mBtn, { backgroundColor: theme.tint }]}><Text style={{ color: "#fff", fontWeight: "bold" }}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, paddingHorizontal: 15 },
  blur: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  zoom: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.05)', padding: 4, borderRadius: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  btn: { width: 40, height: 40, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)', marginLeft: 8 },
  fabWrap: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  fab: { width: 60, height: 60, borderRadius: 30, position: 'absolute', justifyContent: 'center', alignItems: 'center', elevation: 10, shadowOpacity: 0.3 },
  tBlur: { padding: 15, borderRadius: 25, overflow: 'hidden', gap: 15 },
  tRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tCir: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  tray: { padding: 10, backgroundColor: 'rgba(0,0,0,0.03)', borderRadius: 15, gap: 10 },
  cOpt: { width: 25, height: 25, borderRadius: 13 },
  mItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  revBtn: { padding: 12, borderRadius: 15, alignItems: 'center' },
  ctx: { position: 'absolute', backgroundColor: '#fff', padding: 5, borderRadius: 15, flexDirection: 'row', gap: 8, elevation: 10, shadowOpacity: 0.2, borderWidth: 1, borderColor: '#eee' },
  cBtn: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  mOver: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  mCont: { padding: 20, borderRadius: 25, gap: 15 },
  inp: { padding: 12, borderRadius: 12, backgroundColor: '#f5f5f5' },
  mBtn: { flexDirection: 'row', padding: 12, borderRadius: 12, alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  knob: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', borderWidth: 2, borderColor: '#AF52DE', top: -6 },
  suggestionBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#AF52DE10', padding: 15, borderRadius: 15, marginBottom: 15 },
  suggestionText: { fontSize: 14, fontWeight: '800', color: '#AF52DE', flex: 1 },
  cardsBox: { marginBottom: 20 },
  sectionLabel: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1.5, marginBottom: 10 },
  cardPreview: { backgroundColor: 'rgba(0,0,0,0.02)', padding: 12, borderRadius: 12, marginBottom: 8 },
  cardQ: { fontSize: 13, fontWeight: '700', color: '#444' }
});
