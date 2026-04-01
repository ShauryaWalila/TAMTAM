import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Pressable, ScrollView, Dimensions, Alert, ActivityIndicator, Image, TouchableOpacity, View, Text, DeviceEventEmitter } from 'react-native';
import { Canvas, Path, Rect, Skia, useCanvasRef, Group } from '@shopify/react-native-skia';
import { GestureDetector, Gesture, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS, useDerivedValue } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { Eraser, Pencil, Send, Trash2, History, MoreHorizontal, CheckCheck, Info, X, Smile, Settings2, PaintBucket, Palette } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import { supabase } from '@/lib/supabase';
import * as SecureStore from 'expo-secure-store';
import { format, formatDistanceToNow } from 'date-fns';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_SIZE = SCREEN_WIDTH - 40;

const COLOR_PALETTE = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55',
  '#000000', '#FFFFFF', '#8E8E93', '#AEAEB2',
];

interface DrawingPath {
  path: any;
  color: string;
  strokeWidth: number;
  isEraser: boolean;
}

interface Post {
  id: string;
  type: "text" | "image" | "draw";
  content: string;
  created_at: string;
  user_id: string;
  reactions?: Record<string, string>;
  seen_by?: string[];
}

interface Profile {
  id: string;
  username: string;
  avatar_url?: string;
}

const EMOJIS = ["❤️", "🔥", "✨", "😂", "🥺", "😮"];

const REACTION_LOTTIES: Record<string, any> = {
  "❤️": require("../../assets/lottie/heart.lottie"),
  "🔥": require("../../assets/lottie/fire.lottie"),
  "✨": require("../../assets/lottie/star.lottie"),
  "😂": require("../../assets/lottie/joy.lottie"),
  "🥺": require("../../assets/lottie/pleading.lottie"),
  "😮": require("../../assets/lottie/shock.lottie"),
};

function AnimatedReaction({ source, size, infinite = false }: { source: any; size: number; infinite?: boolean }) {
  const [loopCount, setLoopCount] = useState(0);

  return (
    <LottieView
      source={source}
      autoPlay
      loop={infinite ? true : loopCount < 2}
      onAnimationLoop={() => !infinite && setLoopCount(prev => prev + 1)}
      style={{ width: size, height: size }}
    />
  );
}

export default function DrawScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const canvasRef = useCanvasRef();
  const insets = useSafeAreaInsets();
  
  const [paths, setPaths] = useState<DrawingPath[]>([]);
  const [color, setColor] = useState(theme.tint);
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [eraserWidth, setEraserWidth] = useState(20);
  const [canvasBgColor, setCanvasBgColor] = useState('#FFFFFF');
  const [isEraser, setIsEraser] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Pagination states
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const PAGE_SIZE = 12;
  
  // Custom Overlays State
  const [showSettings, setShowSettings] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingPost, setViewingPost] = useState<Post | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

  useEffect(() => {
    // Hide navigator when entering draw mode
    DeviceEventEmitter.emit('hide-navigator');
    return () => {
      DeviceEventEmitter.emit('show-navigator');
    };
  }, []);

  const [posts, setPosts] = useState<Post[]>([]);
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  useEffect(() => {
    const init = async () => {
      const name = await SecureStore.getItemAsync("user_name");
      setCurrentUserName(name);
      fetchProfiles();
      fetchPosts(true);
    };
    init();

    const subscription = supabase
      .channel("draw_updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: "type=eq.draw" }, (p) => {
        if (p.eventType === "INSERT") setPosts(prev => [p.new as Post, ...prev]);
        else if (p.eventType === "UPDATE") setPosts(prev => prev.map(post => post.id === p.new.id ? (p.new as Post) : post));
        else if (p.eventType === "DELETE") setPosts(prev => prev.filter(post => post.id !== p.old.id));
      })
      .subscribe();

    return () => { supabase.removeChannel(subscription); };
  }, []);

  const fetchProfiles = async () => {
    const { data } = await supabase.from('profiles').select('id, username, avatar_url');
    if (data) {
      const mapped = data.reduce((acc: any, p) => { acc[p.username.toLowerCase()] = p; return acc; }, {});
      setProfiles(mapped);
    }
  };

  const fetchPosts = async (reset = false) => {
    if (isFetchingMore && !reset) return;
    const start = reset ? 0 : (page + 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    if (reset) setLoading(true);
    else setIsFetchingMore(true);

    const { data, error } = await supabase.from("posts").select("*").eq('type', 'draw').order("created_at", { ascending: false }).range(start, end);
    if (!error && data) {
      if (reset) setPosts(data);
      else setPosts(prev => [...prev, ...data]);
      setPage(reset ? 0 : page + 1);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoading(false);
    setIsFetchingMore(false);
  };

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300 && hasMore && !isFetchingMore) {
      fetchPosts();
    }
  };

  const getAvatar = (uid: string) => {
    const lowerUid = uid.toLowerCase();
    const profile = profiles[lowerUid];
    if (profile?.avatar_url) return { uri: profile.avatar_url };
    return null;
  };

  const pan = Gesture.Pan()
    .onStart((g) => {
      const newPath = Skia.Path.Make();
      newPath.moveTo(g.x, g.y);
      setPaths((prev) => [...prev, { path: newPath, color: isEraser ? canvasBgColor : color, strokeWidth: isEraser ? eraserWidth : strokeWidth, isEraser }]);
    })
    .onUpdate((g) => {
      const lastPathObj = paths[paths.length - 1];
      if (lastPathObj) {
        lastPathObj.path.lineTo(g.x, g.y);
        setPaths([...paths]);
      }
    });

  const clearCanvas = () => {
    Alert.alert("Clear Canvas", "Delete everything and start fresh?", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => setPaths([]) }
    ]);
  };

  const handleSend = async () => {
    if (paths.length === 0) return;
    setLoading(true);
    try {
      const image = canvasRef.current?.makeImageSnapshot();
      if (image) {
        const base64 = image.encodeToBase64();
        const filePath = `drawings/${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage.from('journal-assets').upload(filePath, base64js.toByteArray(base64), { contentType: 'image/png' });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('journal-assets').getPublicUrl(filePath);
        const { error } = await supabase.from("posts").insert([{ type: 'draw', content: publicUrl, user_id: currentUserName || "user_1" }]);
        if (error) throw error;
        setPaths([]);
        setShowHistory(true);
      }
    } catch (error: any) { Alert.alert('Error', error.message); }
    finally { setLoading(false); }
  };

  const handleAddReaction = async (post: Post, emoji: string) => {
    if (!currentUserName) return;
    const newReactions = { ...(post.reactions || {}), [currentUserName]: emoji };
    await supabase.from('posts').update({ reactions: newReactions }).eq('id', post.id);
  };

  const handleDeletePost = async (post: Post) => {
    Alert.alert("Delete Drawing?", "This will be gone forever.", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          await supabase.from('posts').delete().eq('id', post.id);
          setIsMenuVisible(false);
          setViewingPost(null);
        }
      }
    ]);
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: theme.text }]}>Canvas</Text>
            <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Draw something for us</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => setShowHistory(true)} style={[styles.iconBtn, { backgroundColor: theme.card }]}><History size={22} color={theme.text} /></TouchableOpacity>
            <TouchableOpacity onPress={handleSend} disabled={loading || paths.length === 0} style={[styles.sendBtn, { backgroundColor: theme.tint, opacity: (loading || paths.length === 0) ? 0.6 : 1 }]}><Send size={20} color="#FFF" /></TouchableOpacity>
          </View>
        </View>

        <View style={styles.canvasWrapper}>
          <View style={[styles.canvasContainer, { backgroundColor: canvasBgColor }]}>
            <GestureDetector gesture={pan}>
              <Canvas ref={canvasRef} style={styles.canvas}>
                {paths.map((p, i) => (
                  <Path key={i} path={p.path} color={p.color} style="stroke" strokeWidth={p.strokeWidth} strokeCap="round" strokeJoin="round" />
                ))}
              </Canvas>
            </GestureDetector>
          </View>
        </View>

        <View style={[styles.toolbar, { backgroundColor: theme.card, paddingBottom: insets.bottom + 15 }]}>
          <TouchableOpacity onPress={() => setIsEraser(false)} style={[styles.tool, !isEraser && { backgroundColor: theme.tint + '20' }]}><Pencil size={24} color={!isEraser ? theme.tint : theme.tabIconDefault} /></TouchableOpacity>
          <TouchableOpacity onPress={() => setIsEraser(true)} style={[styles.tool, isEraser && { backgroundColor: theme.tint + '20' }]}><Eraser size={24} color={isEraser ? theme.tint : theme.tabIconDefault} /></TouchableOpacity>
          <TouchableOpacity onPress={() => setShowColorPicker(true)} style={styles.tool}><View style={[styles.colorIndicator, { backgroundColor: color }]} /><Palette size={20} color={theme.tabIconDefault} style={{ position: 'absolute', right: 5, bottom: 5 }} /></TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.tool}><Settings2 size={24} color={theme.tabIconDefault} /></TouchableOpacity>
          <TouchableOpacity onPress={clearCanvas} style={styles.tool}><Trash2 size={24} color="#FF3B30" opacity={0.6} /></TouchableOpacity>
        </View>

        {/* Modal components... */}
        <Modal visible={showHistory} animationType="slide" transparent={true}>
          <View style={styles.modalOverlay}>
            <BlurView intensity={100} tint={colorScheme} style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Gallery</Text>
                <TouchableOpacity onPress={() => setShowHistory(false)}><X size={24} color={theme.text} /></TouchableOpacity>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
                <View style={styles.historyGrid}>
                  {posts.map((post) => (
                    <TouchableOpacity key={post.id} style={styles.historyItem} onPress={() => setViewingPost(post)}>
                      <Image source={{ uri: post.content }} style={styles.historyThumb} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </BlurView>
          </View>
        </Modal>

        <Modal visible={showSettings} animationType="fade" transparent={true}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSettings(false)} />
            <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.settingsBox, { backgroundColor: theme.card }]}>
              <Text style={[styles.settingsTitle, { color: theme.text }]}>Stroke Width</Text>
              <View style={styles.widthRow}>
                {[2, 4, 8, 12, 16].map(w => (
                  <TouchableOpacity key={w} onPress={() => { setStrokeWidth(w); setShowSettings(false); }} style={[styles.widthBtn, strokeWidth === w && { backgroundColor: theme.tint }]}>
                    <View style={{ width: w, height: w, borderRadius: w/2, backgroundColor: strokeWidth === w ? '#FFF' : theme.text }} />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.settingsTitle, { color: theme.text, marginTop: 20 }]}>Canvas Color</Text>
              <View style={styles.widthRow}>
                {['#FFFFFF', '#F8F9FA', '#FFF5E6', '#E6F4FE', '#000000'].map(c => (
                  <TouchableOpacity key={c} onPress={() => { setCanvasBgColor(c); setShowSettings(false); }} style={[styles.colorDot, { backgroundColor: c, borderWidth: 1, borderColor: '#eee' }]}>
                    {canvasBgColor === c && <CheckCheck size={14} color={c === '#000000' ? '#FFF' : theme.tint} />}
                  </TouchableOpacity>
                ))}
              </View>
            </MotiView>
          </View>
        </Modal>

        <Modal visible={showColorPicker} animationType="fade" transparent={true}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowColorPicker(false)} />
            <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.settingsBox, { backgroundColor: theme.card }]}>
              <View style={styles.gridPalette}>
                {COLOR_PALETTE.map(c => (
                  <TouchableOpacity key={c} onPress={() => { setColor(c); setIsEraser(false); setShowColorPicker(false); }} style={[styles.paletteDot, { backgroundColor: c }]}>
                    {color === c && <CheckCheck size={20} color={c === '#FFFFFF' ? '#000' : '#FFF'} />}
                  </TouchableOpacity>
                ))}
              </View>
            </MotiView>
          </View>
        </Modal>

        <Modal visible={!!viewingPost} animationType="slide" transparent={true}>
          <View style={styles.viewerOverlay}>
            <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
            <TouchableOpacity style={styles.viewerClose} onPress={() => setViewingPost(null)}><X size={28} color="#FFF" /></TouchableOpacity>
            {viewingPost && (
              <View style={styles.viewerContent}>
                <View style={styles.viewerHeader}>
                  <View style={styles.userInfo}>
                    <View style={[styles.smallAvatar, { backgroundColor: theme.tint }]}>
                      {getAvatar(viewingPost.user_id) ? <Image source={getAvatar(viewingPost.user_id)} style={styles.avatarImage} /> : <Text style={{color:'#FFF', fontWeight:'bold'}}>{viewingPost.user_id.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View>
                      <Text style={styles.viewerUser}>{viewingPost.user_id === currentUserName ? 'Me' : viewingPost.user_id === 'love' ? 'Love' : viewingPost.user_id}</Text>
                      <Text style={styles.viewerDate}>{formatDistanceToNow(new Date(viewingPost.created_at))} ago</Text>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => setIsMenuVisible(true)}><MoreHorizontal size={24} color="#FFF" /></TouchableOpacity>
                </View>
                <Image source={{ uri: viewingPost.content }} style={styles.fullDrawing} resizeMode="contain" />
                <View style={styles.reactionsRow}>
                  {EMOJIS.map(emoji => {
                    const count = Object.values(viewingPost.reactions || {}).filter(e => e === emoji).length;
                    const hasReacted = viewingPost.reactions?.[currentUserName || ''] === emoji;
                    return (
                      <TouchableOpacity key={emoji} onPress={() => handleAddReaction(viewingPost, emoji)} style={[styles.reactionBadge, hasReacted && { backgroundColor: theme.tint + '40', borderColor: theme.tint }]}>
                        <Text style={{ fontSize: 20 }}>{emoji}</Text>
                        {count > 0 && <Text style={styles.reactionCount}>{count}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
            <Modal visible={isMenuVisible} transparent animationType="fade">
              <Pressable style={styles.menuOverlay} onPress={() => setIsMenuVisible(false)}>
                <BlurView intensity={20} style={StyleSheet.absoluteFill} />
                <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.menuContent, { backgroundColor: theme.card }]}>
                  <TouchableOpacity style={styles.menuItem} onPress={() => viewingPost && handleDeletePost(viewingPost)}><Trash2 size={20} color="#FF3B30" /><Text style={[styles.menuText, { color: "#FF3B30" }]}>Delete Drawing</Text></TouchableOpacity>
                </MotiView>
              </Pressable>
            </Modal>
          </View>
        </Modal>
      </ThemedView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 12 },
  iconBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 2 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  canvasWrapper: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  canvasContainer: { width: CANVAS_SIZE, height: CANVAS_SIZE, borderRadius: 24, overflow: 'hidden', elevation: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20 },
  canvas: { flex: 1 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 15, borderTopLeftRadius: 32, borderTopRightRadius: 32 },
  tool: { width: 50, height: 50, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  colorIndicator: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)' },
  modalOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { width: '100%', height: '80%', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 25 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 },
  modalTitle: { fontSize: 22, fontWeight: '800' },
  historyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  historyItem: { width: (SCREEN_WIDTH - 62) / 3, height: (SCREEN_WIDTH - 62) / 3, borderRadius: 12, overflow: 'hidden', backgroundColor: '#eee' },
  historyThumb: { width: '100%', height: '100%' },
  settingsBox: { width: SCREEN_WIDTH * 0.8, padding: 25, borderRadius: 32 },
  widthRow: { flexDirection: 'row', gap: 15, alignItems: 'center', marginTop: 15 },
  widthBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' },
  colorDot: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  gridPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center' },
  paletteDot: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center' },
  viewerOverlay: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', top: 60, right: 25, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  viewerContent: { flex: 1, padding: 20, justifyContent: 'center' },
  viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  userInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  smallAvatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: '100%', height: '100%' },
  viewerUser: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  viewerDate: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  fullDrawing: { width: SCREEN_WIDTH - 40, height: SCREEN_WIDTH - 40, borderRadius: 24, backgroundColor: '#FFF' },
  reactionsRow: { flexDirection: 'row', justifyContent: 'center', gap: 15, marginTop: 30 },
  reactionBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  reactionCount: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  menuOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  menuContent: { width: SCREEN_WIDTH * 0.7, borderRadius: 24, padding: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  menuText: { fontSize: 16, fontWeight: '700' }
});
