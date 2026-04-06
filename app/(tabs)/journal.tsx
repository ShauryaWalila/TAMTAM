import { Text, View as ThemedView } from "@/components/Themed";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import { db, queueSyncOperation, generateUUID } from "@/lib/db";
import * as base64js from "base64-js";
import { format, formatDistanceToNow } from "date-fns";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Camera,
  Image as ImageIcon,
  MoreHorizontal,
  Send,
  X,
  Trash2,
  Info,
  Smile,
  CheckCheck,
} from "lucide-react-native";
import { AnimatePresence, MotiView } from "moti";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Modal,
  TouchableOpacity,
  Dimensions,
  DeviceEventEmitter,
} from "react-native";

import LottieView from "lottie-react-native";

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

const { width: SCREEN_WIDTH } = Dimensions.get("window");

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

export default function JournalScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  // Pagination states
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const PAGE_SIZE = 10;
  
  // New states
  const [currentUserName, setCurrentUserName] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  // Scroll visibility logic
  const lastScrollY = useRef(0);
  const handleScroll = (event: any) => {
    const currentY = event.nativeEvent.contentOffset.y;
    if (currentY <= 0) {
      DeviceEventEmitter.emit('show-navigator');
    } else if (currentY > lastScrollY.current + 10) {
      DeviceEventEmitter.emit('hide-navigator');
    } else if (currentY < lastScrollY.current - 10) {
      DeviceEventEmitter.emit('show-navigator');
    }
    lastScrollY.current = currentY;
  };

  useEffect(() => {
    const init = async () => {
      const name = await SecureStore.getItemAsync("user_name");
      setCurrentUserName(name);
      fetchProfiles();
      fetchPosts(true, name);
    };
    init();

    const subscription = supabase
      .channel("journal_posts")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const n = payload.new as Post;
            db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
              [n.id, n.created_at, n.type, n.content, n.user_id, JSON.stringify(n.reactions), n.seen_by ? n.seen_by.join(',') : '']);
          } else if (payload.eventType === "UPDATE") {
            const n = payload.new as Post;
            db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
              [n.id, n.created_at, n.type, n.content, n.user_id, JSON.stringify(n.reactions), n.seen_by ? n.seen_by.join(',') : '']);
          } else if (payload.eventType === "DELETE") {
            db.runSync(`DELETE FROM posts WHERE id = ?`, [payload.old.id]);
          }
          refreshFromSQLite();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const refreshFromSQLite = () => {
    try {
      const data = db.getAllSync(`SELECT * FROM posts ORDER BY created_at DESC LIMIT 50`) as any[];
      if (data) {
        setPosts(data.map(p => ({
          ...p,
          reactions: p.reactions ? JSON.parse(p.reactions) : {},
          seen_by: p.seen_by ? p.seen_by.split(',') : []
        })));
      }
    } catch (e) {}
  };

  const fetchPosts = async (reset = false, userName?: string | null) => {
    if (isFetchingMore && !reset) return;
    
    if (reset) {
      setLoading(true);
      refreshFromSQLite();
    } else {
      setIsFetchingMore(true);
    }

    const start = reset ? 0 : (page + 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .range(start, end);

    if (!error && data) {
      data.forEach(n => {
        db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.type, n.content, n.user_id, JSON.stringify(n.reactions), n.seen_by ? n.seen_by.join(',') : '']);
      });

      if (reset) {
        setPage(0);
        if (userName) markSeenBatch(data, userName);
      } else {
        setPage((p) => p + 1);
      }
      setHasMore(data.length === PAGE_SIZE);
      refreshFromSQLite();
    }
    setLoading(false);
    setIsFetchingMore(false);
  };

  const fetchProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url");
    if (data) {
      const mapped = data.reduce((acc: any, p) => {
        acc[p.username.toLowerCase()] = p;
        return acc;
      }, {});
      setProfiles(mapped);
    }
  };

  const getAvatar = (uid: string) => {
    const lowerUid = uid.toLowerCase();
    const profile = profiles[lowerUid];
    if (profile?.avatar_url) return { uri: profile.avatar_url };
    return null;
  };

  const markSeenBatch = async (allPosts: Post[], userName: string) => {
    const unreadFromOthers = allPosts.filter(
      (p) => p.user_id !== userName && !p.seen_by?.includes(userName)
    );

    for (const post of unreadFromOthers) {
      const newSeenBy = [...(post.seen_by || []), userName];
      await supabase
        .from("posts")
        .update({ seen_by: newSeenBy })
        .eq("id", post.id);
    }
  };

  const uploadImage = async (uri: string) => {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const filePath = `journal/${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from("journal-assets")
        .upload(filePath, base64js.toByteArray(base64), {
          contentType: "image/jpeg",
        });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("journal-assets").getPublicUrl(filePath);
      return publicUrl;
    } catch (error) {
      console.error("Upload error:", error);
      throw error;
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.6,
    });
    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Denied", "We need camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.6,
    });
    if (!result.canceled) {
      setSelectedImage(result.assets[0].uri);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() && !selectedImage) return;
    setLoading(true);
    const id = generateUUID();
    const payload: any = {
      id,
      type: selectedImage ? "image" : "text",
      content: selectedImage || inputText,
      user_id: currentUserName || "user_1",
      created_at: new Date().toISOString(),
      reactions: {},
      seen_by: []
    };

    try {
      // 1. Save to SQLite for immediate UI
      db.runSync(`INSERT INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [payload.id, payload.created_at, payload.type, payload.content, payload.user_id, JSON.stringify(payload.reactions), '']);
      
      // 2. Queue for Sync Engine
      queueSyncOperation('posts', payload.id, 'INSERT', payload);

      setInputText("");
      setSelectedImage(null);
      refreshFromSQLite();
    } catch (e) {
      console.warn('Journal add error', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLongPress = (post: Post) => {
    setSelectedPost(post);
    setIsMenuVisible(true);
  };

  const handleDeletePost = async () => {
    if (!selectedPost) return;
    Alert.alert("Delete Memory?", "This will be gone forever for both of us.", [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          setIsMenuVisible(false);
          db.runSync(`DELETE FROM posts WHERE id = ?`, [selectedPost.id]);
          queueSyncOperation('posts', selectedPost.id, 'DELETE', {});
          refreshFromSQLite();
        }
      }
    ]);
  };

  const handleAddReaction = async (emoji: string) => {
    if (!selectedPost || !currentUserName) return;
    const newReactions = { ...(selectedPost.reactions || {}), [currentUserName]: emoji };
    setIsMenuVisible(false);

    // Update locally
    db.runSync(`UPDATE posts SET reactions = ? WHERE id = ?`, [JSON.stringify(newReactions), selectedPost.id]);
    
    // Queue sync
    queueSyncOperation('posts', selectedPost.id, 'UPDATE', { reactions: newReactions });
    
    refreshFromSQLite();
  };

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView 
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        onScroll={(e) => {
          handleScroll(e);
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300 && hasMore && !isFetchingMore) {
            fetchPosts();
          }
        }}
        scrollEventThrottle={16}
      >
        {loading && posts.length === 0 ? (
          <ActivityIndicator size="large" color={theme.tint} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.header}>
              <View>
                <Text style={[styles.title, { color: theme.text }]}>Memories</Text>
                <Text style={[styles.subtitle, { color: theme.tabIconDefault }]}>Capturing our moments</Text>
              </View>
              <TouchableOpacity onPress={() => setIsDetailsVisible(true)} style={[styles.infoBtn, { backgroundColor: theme.card }]}><Info size={20} color={theme.text} /></TouchableOpacity>
            </View>

            {posts.map((post, idx) => (
              <MotiView key={post.id} from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} transition={{ delay: idx < 5 ? idx * 100 : 0 }}>
                <Pressable onLongPress={() => handleLongPress(post)} style={[styles.postCard, { backgroundColor: theme.card }]}>
                  <View style={styles.postHeader}>
                    <View style={styles.userInfo}>
                      <View style={[styles.smallAvatar, { backgroundColor: theme.tint }]}>
                        {getAvatar(post.user_id) ? <Image source={getAvatar(post.user_id)} style={styles.avatarImage} /> : <Text style={{ color: "#FFF", fontWeight: "bold" }}>{post.user_id.charAt(0).toUpperCase()}</Text>}
                      </View>
                      <View>
                        <Text style={[styles.userName, { color: theme.text }]}>{post.user_id === currentUserName ? "Me" : post.user_id === "love" ? "Love" : post.user_id}</Text>
                        <Text style={[styles.timeAgo, { color: theme.tabIconDefault }]}>{formatDistanceToNow(new Date(post.created_at))} ago</Text>
                      </View>
                    </View>
                    {post.user_id !== currentUserName && !post.seen_by?.includes(currentUserName || "") && <View style={[styles.unreadDot, { backgroundColor: theme.tint }]} />}
                  </View>

                  {post.type === "text" ? <Text style={[styles.postText, { color: theme.text }]}>{post.content}</Text> : <Image source={{ uri: post.content }} style={styles.postImage} resizeMode="cover" />}

                  <View style={styles.reactionsContainer}>
                    {post.reactions && Object.entries(post.reactions).map(([uid, emoji]) => (
                      <View key={uid} style={[styles.reactionBadge, { backgroundColor: theme.background, borderColor: theme.tint + "20" }]}>
                        <AnimatedReaction source={REACTION_LOTTIES[emoji]} size={24} />
                      </View>
                    ))}
                  </View>
                </Pressable>
              </MotiView>
            ))}
            {isFetchingMore && <ActivityIndicator size="small" color={theme.tint} style={{ marginVertical: 20 }} />}
          </>
        )}
      </ScrollView>

      {/* Input Section */}
      <MotiView style={[styles.inputContainer, { backgroundColor: theme.card, paddingBottom: insets.bottom + 16 }]} from={{ translateY: 150 }} animate={{ translateY: 0 }}>
        {selectedImage && <View style={styles.previewContainer}><Image source={{ uri: selectedImage }} style={styles.imagePreview} /><Pressable onPress={() => setSelectedImage(null)} style={styles.closePreview}><X color="#FFF" size={16} /></Pressable></View>}
        <View style={styles.inputRow}>
          <Pressable onPress={takePhoto} style={styles.iconButton}><Camera color={theme.tint} size={24} /></Pressable>
          <Pressable onPress={pickImage} style={styles.iconButton}><ImageIcon color={theme.tint} size={24} /></Pressable>
          <TextInput style={[styles.input, { color: theme.text }]} placeholder="Share a thought..." placeholderTextColor={theme.tabIconDefault} value={inputText} onChangeText={setInputText} multiline />
          <Pressable onPress={handleSend} disabled={loading} style={[styles.sendButton, { backgroundColor: theme.tint, opacity: loading ? 0.6 : 1 }]}>{loading ? <ActivityIndicator size="small" color="#FFF" /> : <Send color="#FFF" size={20} />}</Pressable>
        </View>
      </MotiView>

      {/* Menus... */}
      <Modal visible={isMenuVisible} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setIsMenuVisible(false)}>
          <BlurView intensity={20} style={StyleSheet.absoluteFill} />
          <MotiView from={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={[styles.menuContent, { backgroundColor: theme.card }]}>
            <View style={styles.emojiRow}>{EMOJIS.map(e => <TouchableOpacity key={e} onPress={() => handleAddReaction(e)} style={styles.emojiButton}><Text style={{ fontSize: 28 }}>{e}</Text></TouchableOpacity>)}</View>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={handleDeletePost}><Trash2 size={20} color="#FF3B30" /><Text style={[styles.menuText, { color: "#FF3B30" }]}>Delete Memory</Text></TouchableOpacity>
          </MotiView>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 32, fontWeight: "900", letterSpacing: -1 },
  subtitle: { fontSize: 16, fontWeight: "600" },
  infoBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  postCard: { padding: 16, borderRadius: 24, marginBottom: 20, elevation: 2 },
  postHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  userInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  smallAvatar: { width: 36, height: 36, borderRadius: 18, justifyContent: "center", alignItems: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  userName: { fontSize: 14, fontWeight: "700" },
  timeAgo: { fontSize: 12, fontWeight: "600" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  postText: { fontSize: 18, lineHeight: 24, fontWeight: "500" },
  postImage: { width: "100%", height: 300, borderRadius: 16, marginTop: 8 },
  reactionsContainer: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  reactionBadge: { padding: 2, borderRadius: 12, borderWidth: 1 },
  inputContainer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, borderTopLeftRadius: 32, borderTopRightRadius: 32, elevation: 10 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  input: { flex: 1, maxHeight: 100, fontSize: 16, fontWeight: "500" },
  iconButton: { padding: 8 },
  sendButton: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  previewContainer: { marginBottom: 12, position: "relative", width: 80, height: 80 },
  imagePreview: { width: 80, height: 80, borderRadius: 12 },
  closePreview: { position: "absolute", top: -8, right: -8, backgroundColor: "#FF3B30", borderRadius: 12, width: 24, height: 24, justifyContent: "center", alignItems: "center", borderWidth: 2, borderColor: "#FFF" },
  modalOverlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  menuContent: { width: SCREEN_WIDTH * 0.8, borderRadius: 24, padding: 16 },
  emojiRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  emojiButton: { padding: 8 },
  menuDivider: { height: 1, backgroundColor: "rgba(150,150,150,0.1)", marginVertical: 8 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuText: { fontSize: 17, fontWeight: "600" },
});
