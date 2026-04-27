import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, FlatList, Image, ActivityIndicator, Alert, Linking, Dimensions } from 'react-native';
import { Search, Plus, X, Play, Trash2, ChevronLeft, Disc, Check, LogIn, LogOut } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { useAuthRequest, ResponseType, exchangeCodeAsync } from 'expo-auth-session';

import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import {
  searchTracks,
  SPOTIFY_CLIENT_ID,
  REDIRECT_URI,
  SCOPES,
  getUserProfile,
  playTracksOnDevice,
  waitForDevice,
} from '@/lib/spotify';

WebBrowser.maybeCompleteAuthSession();

const { width } = Dimensions.get('window');

const discovery = {
  authorizationEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const SPOTIFY_TOKEN_KEY = 'spotify_token';

interface TripSoundtrackProps {
  tripId: string;
  tripName?: string;
  onClose: () => void;
}

export function TripSoundtrack({ tripId, tripName = "My Trip", onClose }: TripSoundtrackProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [playlist, setPlaylist] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  
  // Official Spotify State
  const [token, setToken] = useState<string | null>(null);
  const [spotifyUser, setSpotifyUser] = useState<any>(null);
  const [isPlayingAll, setIsPlayingAll] = useState(false);

  const [request, response, promptAsync] = useAuthRequest(
    {
      responseType: ResponseType.Code,
      clientId: SPOTIFY_CLIENT_ID,
      scopes: SCOPES,
      usePKCE: true,
      redirectUri: REDIRECT_URI,
      // Force Spotify's consent screen every login so old/cached scopes
      // can't be silently reused — the saved token must include the latest SCOPES.
      extraParams: { show_dialog: 'true' },
    },
    discovery
  );

  // Load Persisted Token on Mount
  useEffect(() => {
    loadSavedSession();
  }, []);

  const loadSavedSession = async () => {
    try {
      const savedToken = await SecureStore.getItemAsync(SPOTIFY_TOKEN_KEY);
      if (savedToken) {
        console.log('[Spotify] Found saved session, verifying...');
        setToken(savedToken);
        const profile = await getUserProfile(savedToken);
        setSpotifyUser(profile);
      }
    } catch (e) {
      console.log('[Spotify] No valid session found.');
      await SecureStore.deleteItemAsync(SPOTIFY_TOKEN_KEY);
    }
  };

  useEffect(() => {
    if (response?.type === 'success') {
      const { code } = response.params;
      handleTokenExchange(code);
    }
  }, [response]);

  const handleTokenExchange = async (code: string) => {
    try {
      const tokenResult = await exchangeCodeAsync(
        { code, clientId: SPOTIFY_CLIENT_ID, redirectUri: REDIRECT_URI, extraParams: request?.codeVerifier ? { code_verifier: request.codeVerifier } : undefined },
        discovery
      );
      
      const tk = tokenResult.accessToken;
      setToken(tk);
      await SecureStore.setItemAsync(SPOTIFY_TOKEN_KEY, tk);

      console.warn(`[Spotify][DBG] Token granted scopes: ${(tokenResult as any).scope || '(none reported)'}`);
      console.warn(`[Spotify][DBG] ClientId prefix: ${SPOTIFY_CLIENT_ID.slice(0, 8)}... (len ${SPOTIFY_CLIENT_ID.length})`);

      const profile = await getUserProfile(tk);
      console.warn(`[Spotify][DBG] /me id=${profile.id} email=${profile.email} product=${profile.product} country=${profile.country} display_name=${profile.display_name}`);
      console.log('[Spotify] New session started for:', profile.display_name);
      setSpotifyUser(profile);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error('[Spotify] Auth Failed:', e);
      Alert.alert("Auth Error", "Could not connect to Spotify");
    }
  };

  const logoutSpotify = async () => {
    Alert.alert(
      "Disconnect Spotify?",
      "You'll need to log in again to search and play.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setToken(null);
            setSpotifyUser(null);
            await SecureStore.deleteItemAsync(SPOTIFY_TOKEN_KEY);
          },
        },
      ]
    );
  };

  useEffect(() => {
    fetchPlaylist();
    const sub = supabase.channel(`soundtrack-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_songs', filter: `trip_id=eq.${tripId}` }, fetchPlaylist)
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [tripId]);

  const fetchPlaylist = async () => {
    const { data } = await supabase.from('trip_songs').select('*').eq('trip_id', tripId).order('created_at', { ascending: true });
    if (data) setPlaylist(data);
    setLoading(false);
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (text.length < 2 || !token) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await searchTracks(text, token);
      setSearchResults(results);
    } catch (e: any) {
      if (e.message === 'TOKEN_EXPIRED') {
         setToken(null);
         await SecureStore.deleteItemAsync(SPOTIFY_TOKEN_KEY);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const addTrack = async (track: any) => {
    if (addingId) return;
    setAddingId(track.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const payload = {
        trip_id: tripId,
        spotify_id: track.uri,
        track_name: track.name,
        artist_name: track.artist,
        album_art: track.albumArt,
      };

      const { error } = await supabase.from('trip_songs').upsert(payload, { onConflict: 'trip_id, spotify_id' });
      if (error) throw error;
      fetchPlaylist();
    } catch (e) {
      Alert.alert("Error", "Could not add song");
    } finally {
      setAddingId(null);
    }
  };

  const removeTrack = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await supabase.from('trip_songs').delete().eq('id', id);
    fetchPlaylist();
  };

  const playAsTrackset = async () => {
    const tracks = displayPlaylist
      .filter(s => s.spotify_id && s.spotify_id.startsWith('spotify:track:'));

    if (tracks.length === 0) {
      Alert.alert("No songs", "Add some songs first.");
      return;
    }

    // The legacy `spotify:trackset:` deep-link is deprecated on most current
    // Spotify versions, and `https://open.spotify.com/track-set/...` is not a
    // real route (returns 404). Try the native trackset URI as a best-effort,
    // but if the platform can't open it, fall straight back to the first track
    // — that's the only deep-link Spotify reliably supports without a playlist.
    const trackIds = tracks.map(s => s.spotify_id.replace('spotify:track:', ''));
    const cleanName = tripName.replace(/[^a-zA-Z0-9]/g, '') || 'TripSoundtrack';
    const tracksetUri = `spotify:trackset:${cleanName}:${trackIds.join(',')}`;
    const firstTrackUri = tracks[0].spotify_id;

    try {
      const supported = await Linking.canOpenURL(tracksetUri);
      if (supported) {
        await Linking.openURL(tracksetUri);
        return;
      }
    } catch (e) {
      console.log("[Spotify] trackset URI check failed", e);
    }

    Linking.openURL(firstTrackUri);
  };

  const playTripSoundtrack = async () => {
    if (!token || !spotifyUser) {
      // Not logged in — best-effort: open the first track via deep-link.
      playAsTrackset();
      return;
    }

    setIsPlayingAll(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Player API direct play. Strategy:
    //   1. Try foreground path — if Spotify is already running anywhere, the
    //      device shows up immediately and we play without ever leaving the
    //      app. This is the smooth no-flicker happy path.
    //   2. Otherwise, deep-link to wake Spotify, poll for the device, then
    //      retry the play call (retries cover iOS-background flakiness).
    //   3. If everything fails, fall through to the first-track deep-link.
    const trackUris = displayPlaylist
      .filter(s => s.spotify_id && s.spotify_id.startsWith('spotify:track:'))
      .map(s => s.spotify_id);

    if (trackUris.length > 0) {
      try {
        // Foreground path — Spotify already running somewhere → device shows
        // up immediately, we play without leaving the app.
        let deviceId = await waitForDevice(token, 1500);

        if (deviceId) {
          await playTracksOnDevice(trackUris, token, deviceId);
          Linking.openURL('spotify://');
          console.log('[Spotify] Foreground path succeeded');
          setIsPlayingAll(false);
          return;
        }

        // Deep-link path — Spotify isn't running; we wake it via deep-link,
        // poll for the device, then retry the play call (iOS may flake the
        // network briefly while our app is suspended in the background).
        console.log('[Spotify] No existing device, opening Spotify to wake one...');
        Linking.openURL(trackUris[0]);
        deviceId = await waitForDevice(token, 10000);
        if (!deviceId) throw new Error('NO_DEVICE_REGISTERED');

        let lastErr: any;
        for (let retry = 0; retry < 4; retry++) {
          try {
            await playTracksOnDevice(trackUris, token, deviceId);
            console.log(`[Spotify] Deep-link path succeeded${retry > 0 ? ` on retry ${retry}` : ''}`);
            setIsPlayingAll(false);
            return;
          } catch (e: any) {
            lastErr = e;
            const retryable = typeof e?.message === 'string' && e.message.toLowerCase().includes('network');
            if (retryable && retry < 3) {
              const delay = 1500 * (retry + 1);
              console.warn(`[Spotify] play retry ${retry + 1} after "${e.message}" — waiting ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw e;
          }
        }
        throw lastErr;
      } catch (e: any) {
        console.warn('[Spotify] Player API path failed:', e?.message);
      }
    }

    // Final fallback — the deep-link wake-up above probably already started
    // the first track; this just ensures the user lands somewhere if not.
    playAsTrackset();
    setIsPlayingAll(false);
  };

  const displayPlaylist = playlist.filter(s => !s.spotify_id.includes('SPOTIFY_SYNC_RECORD'));

  return (
    <View style={[styles.container, { backgroundColor: '#000', paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}><ChevronLeft size={28} color="#FFF" /></TouchableOpacity>
          <View>
            <Text style={styles.headerSubtitle}>{spotifyUser ? `CONNECTED AS ${spotifyUser.display_name.toUpperCase()}` : tripName.toUpperCase()}</Text>
            <Text style={styles.headerTitle}>Plan Songs</Text>
          </View>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {!token ? (
            <TouchableOpacity style={styles.spotifyConnectBtn} onPress={() => promptAsync()}><LogIn size={18} color="white" /></TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.syncBtn} onPress={logoutSpotify}>
              <LogOut size={20} color="#1DB954" />
            </TouchableOpacity>
          )}

          {!showSearch && displayPlaylist.length > 0 && (
            <TouchableOpacity 
              style={[styles.playAllBtn, { backgroundColor: '#1DB954' }, isPlayingAll && { opacity: 0.7 }]} 
              onPress={playTripSoundtrack}
              disabled={isPlayingAll}
            >
              {isPlayingAll ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Play size={20} color="white" fill="white" />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      <AnimatePresence mode="wait">
        {showSearch ? (
          <MotiView key="search" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.content}>
            <View style={styles.searchBarWrapper}>
              {!token ? (
                <TouchableOpacity style={styles.loginBanner} onPress={() => promptAsync()}><Text style={styles.loginBannerText}>Login to Spotify to search</Text></TouchableOpacity>
              ) : (
                <View style={styles.searchBar}>
                  <Search size={20} color="rgba(255,255,255,0.5)" />
                  <TextInput style={styles.searchInput} placeholder="Search Spotify..." placeholderTextColor="rgba(255,255,255,0.3)" value={searchQuery} onChangeText={handleSearch} autoFocus />
                </View>
              )}
              <TouchableOpacity onPress={() => setShowSearch(false)}><Text style={styles.cancelText}>Done</Text></TouchableOpacity>
            </View>

            {isSearching ? <ActivityIndicator color="#1DB954" style={{ marginTop: 40 }} /> : (
              <FlatList
                data={searchResults}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const isAdded = displayPlaylist.some(p => p.spotify_id.includes(item.id));
                  return (
                    <TouchableOpacity style={styles.trackCard} onPress={() => addTrack(item)}>
                      <Image source={{ uri: item.albumArt }} style={styles.trackArt} />
                      <View style={styles.trackInfo}><Text style={styles.trackName} numberOfLines={1}>{item.name}</Text><Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text></View>
                      {addingId === item.id ? <ActivityIndicator size="small" color="#1DB954" /> : isAdded ? <Check size={20} color="#1DB954" /> : <Plus size={20} color="rgba(255,255,255,0.5)" />}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </MotiView>
        ) : (
          <MotiView key="list" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.content}>
            {loading ? <ActivityIndicator color="#1DB954" style={{ marginTop: 40 }} /> : (
              <FlatList
                data={displayPlaylist}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                  <View style={styles.playlistItem}>
                    <TouchableOpacity onPress={() => Linking.openURL(item.spotify_id)} style={styles.trackMain}>
                      <Image source={{ uri: item.album_art }} style={styles.trackArt} />
                      <View style={styles.trackInfo}><Text style={styles.trackName} numberOfLines={1}>{item.track_name}</Text><Text style={styles.trackArtist} numberOfLines={1}>{item.artist_name}</Text></View>
                      <Play size={18} color="#1DB954" fill="#1DB954" style={{ marginRight: 15 }} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeTrack(item.id)} style={styles.trashBtn}><Trash2 size={18} color="#FF3B30" /></TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={<View style={styles.emptyState}><Disc size={64} color="rgba(255,255,255,0.1)" /><Text style={styles.emptyText}>Add some music to start the vibe!</Text></View>}
              />
            )}
            <TouchableOpacity style={[styles.floatingAddBtn, { backgroundColor: theme.tint }]} onPress={() => setShowSearch(true)}><Plus size={28} color="white" /></TouchableOpacity>
          </MotiView>
        )}
      </AnimatePresence>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' },
  headerSubtitle: { fontSize: 9, fontWeight: '900', color: 'rgba(255,255,255,0.5)', letterSpacing: 2 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: '#FFF' },
  playAllBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  syncBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(29, 185, 84, 0.1)', justifyContent: 'center', alignItems: 'center' },
  spotifyConnectBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1 },
  searchBarWrapper: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15, gap: 15 },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 15, paddingHorizontal: 15, height: 50, gap: 10 },
  loginBanner: { flex: 1, height: 50, borderRadius: 15, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center' },
  loginBannerText: { color: 'white', fontWeight: '800' },
  searchInput: { flex: 1, color: '#FFF', fontSize: 16, fontWeight: '700' },
  cancelText: { color: '#FFF', fontWeight: '800' },
  listContent: { paddingHorizontal: 20, paddingBottom: 100 },
  trackCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  playlistItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, paddingVertical: 8, paddingLeft: 10, paddingRight: 15, marginBottom: 12 },
  trackMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackArt: { width: 50, height: 50, borderRadius: 10 },
  trackInfo: { flex: 1, marginLeft: 15 },
  trackName: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  trackArtist: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
  trashBtn: { padding: 5 },
  emptyState: { alignItems: 'center', marginTop: 100 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 16, fontWeight: '700' },
  floatingAddBtn: { position: 'absolute', bottom: 30, right: 20, width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 10 },
});
