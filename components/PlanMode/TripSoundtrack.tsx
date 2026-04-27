import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, FlatList, Image, ActivityIndicator, Alert, Linking, Dimensions, DeviceEventEmitter } from 'react-native';
import { Search, Plus, X, Play, Trash2, ChevronLeft, Library, Check, LogIn, LogOut, RefreshCw, Music } from 'lucide-react-native';
import { MotiView, AnimatePresence } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { useAuthRequest, ResponseType, exchangeCodeAsync } from 'expo-auth-session';

import { supabase } from '@/lib/supabase';
import { db, generateUUID, queueSyncOperation } from '@/lib/db';
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
const SPOTIFY_LOGIN_EVENT = 'spotify_login_sync';

interface TripSoundtrackProps {
  tripId: string;
  tripName?: string;
  onClose: () => void;
  isMaster?: boolean;
}

export function TripSoundtrack({ tripId, tripName = "My Trip", onClose, isMaster = false }: TripSoundtrackProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();

  const [playlist, setPlaylist] = useState<any[]>([]);
  const [masterSongs, setMasterSongs] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showMasterPicker, setShowMasterPicker] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);

  // Multi-select state
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  
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
      extraParams: { show_dialog: 'true' },
    },
    discovery
  );

  useEffect(() => {
    loadSavedSession();
    
    // Listen for login/logout events from other instances of this component
    const sub = DeviceEventEmitter.addListener(SPOTIFY_LOGIN_EVENT, (data) => {
      if (data.token) {
        setToken(data.token);
        setSpotifyUser(data.user);
      } else {
        setToken(null);
        setSpotifyUser(null);
      }
    });

    return () => sub.remove();
  }, []);

  const loadSavedSession = async () => {
    try {
      const savedToken = await SecureStore.getItemAsync(SPOTIFY_TOKEN_KEY);
      if (savedToken) {
        setToken(savedToken);
        const profile = await getUserProfile(savedToken);
        setSpotifyUser(profile);
      }
    } catch (e) {
      // If token is invalid/expired, we don't delete immediately to allow silent refresh in future
      // but for now we just clear the local state
      setToken(null);
      setSpotifyUser(null);
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
      await SecureStore.setItemAsync(SPOTIFY_TOKEN_KEY, tk);
      const profile = await getUserProfile(tk);
      
      // Update local state AND broadcast to other components
      setToken(tk);
      setSpotifyUser(profile);
      DeviceEventEmitter.emit(SPOTIFY_LOGIN_EVENT, { token: tk, user: profile });
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
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
            await SecureStore.deleteItemAsync(SPOTIFY_TOKEN_KEY);
            setToken(null);
            setSpotifyUser(null);
            DeviceEventEmitter.emit(SPOTIFY_LOGIN_EVENT, { token: null, user: null });
          },
        },
      ]
    );
  };

  useEffect(() => {
    fetchPlaylist();
    const sub = supabase.channel(`soundtrack-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_songs', filter: `trip_id=eq.${tripId}` }, (payload) => {
        const rec = payload.new as any;
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          db.runSync(
            `INSERT OR REPLACE INTO trip_songs (id, trip_id, spotify_id, track_name, artist_name, album_art, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.trip_id, rec.spotify_id, rec.track_name, rec.artist_name, rec.album_art, rec.created_at]
          );
        } else if (payload.eventType === 'DELETE') {
          db.runSync(`DELETE FROM trip_songs WHERE id = ?`, [payload.old.id]);
        }
        fetchPlaylist();
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [tripId]);

  useEffect(() => {
    fetchMasterSongs();
    const masterSub = supabase.channel(`soundtrack-MASTER`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_songs', filter: `trip_id=eq.MASTER` }, (payload) => {
        const rec = payload.new as any;
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          db.runSync(
            `INSERT OR REPLACE INTO trip_songs (id, trip_id, spotify_id, track_name, artist_name, album_art, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [rec.id, rec.trip_id, rec.spotify_id, rec.track_name, rec.artist_name, rec.album_art, rec.created_at]
          );
        } else if (payload.eventType === 'DELETE') {
          db.runSync(`DELETE FROM trip_songs WHERE id = ?`, [payload.old.id]);
        }
        fetchMasterSongs();
      })
      .subscribe();
    return () => { supabase.removeChannel(masterSub); };
  }, []);

  const fetchPlaylist = () => {
    try {
      const data = db.getAllSync(`SELECT * FROM trip_songs WHERE trip_id = ? ORDER BY created_at ASC`, [tripId]);
      setPlaylist(data);
    } catch (e) {
      console.error("Local fetch failed", e);
    }
    setLoading(false);
  };

  const fetchMasterSongs = () => {
    try {
      const data = db.getAllSync(`SELECT * FROM trip_songs WHERE trip_id = 'MASTER' ORDER BY created_at ASC`);
      setMasterSongs(data);
    } catch (e) {
      console.error("Local master fetch failed", e);
    }
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
         setSpotifyUser(null);
         DeviceEventEmitter.emit(SPOTIFY_LOGIN_EVENT, { token: null, user: null });
      }
    } finally {
      setIsSearching(false);
    }
  };

  const addSingleTrack = async (track: any, targetTripId = tripId) => {
    const spotify_id = track.uri || track.spotify_id;
    
    const existing = db.getFirstSync(`SELECT id FROM trip_songs WHERE trip_id = ? AND spotify_id = ?`, [targetTripId, spotify_id]);
    if (existing) return; 

    const localId = generateUUID();
    const payload = {
      id: localId,
      trip_id: targetTripId,
      spotify_id: spotify_id,
      track_name: track.name || track.track_name,
      artist_name: track.artist || track.artist_name,
      album_art: track.albumArt || track.album_art,
      created_at: new Date().toISOString()
    };

    db.runSync(
      `INSERT OR REPLACE INTO trip_songs (id, trip_id, spotify_id, track_name, artist_name, album_art, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [payload.id, payload.trip_id, payload.spotify_id, payload.track_name, payload.artist_name, payload.album_art, payload.created_at]
    );
    queueSyncOperation('trip_songs', localId, 'INSERT', payload);

    if (targetTripId !== 'MASTER') {
      const masterExisting = db.getFirstSync(`SELECT id FROM trip_songs WHERE trip_id = 'MASTER' AND spotify_id = ?`, [spotify_id]);
      if (!masterExisting) {
        const masterLocalId = generateUUID();
        const masterPayload = { ...payload, id: masterLocalId, trip_id: 'MASTER' };
        db.runSync(
          `INSERT OR REPLACE INTO trip_songs (id, trip_id, spotify_id, track_name, artist_name, album_art, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [masterPayload.id, masterPayload.trip_id, masterPayload.spotify_id, masterPayload.track_name, masterPayload.artist_name, masterPayload.album_art, masterPayload.created_at]
        );
        queueSyncOperation('trip_songs', masterLocalId, 'INSERT', masterPayload);
      }
    }
  };

  const addSelectedTracks = async () => {
    if (selectedTrackIds.size === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    
    const tracksToProcess = showSearch 
      ? searchResults.filter(s => selectedTrackIds.has(s.uri))
      : masterSongs.filter(s => selectedTrackIds.has(s.spotify_id));
    
    try {
      for (const track of tracksToProcess) {
        const sid = track.uri || track.spotify_id;
        if (playlist.some(p => p.spotify_id === sid)) continue;
        await addSingleTrack(track);
      }
      
      fetchPlaylist();
      fetchMasterSongs();
      setShowMasterPicker(false);
      setShowSearch(false);
      setSelectedTrackIds(new Set());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Error", "Could not add all songs");
    }
  };

  const removeTrack = async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      db.runSync(`DELETE FROM trip_songs WHERE id = ?`, [id]);
      fetchPlaylist();
      fetchMasterSongs();
      queueSyncOperation('trip_songs', id, 'DELETE', { id });
    } catch (e) {
      console.error("Remove failed", e);
    }
  };

  const toggleSelection = (spotify_id: string) => {
    Haptics.selectionAsync();
    const next = new Set(selectedTrackIds);
    if (next.has(spotify_id)) next.delete(spotify_id);
    else next.add(spotify_id);
    setSelectedTrackIds(next);
  };

  const playAsTrackset = async () => {
    const tracks = playlist
      .filter(s => s.spotify_id && s.spotify_id.startsWith('spotify:track:'));

    if (tracks.length === 0) {
      Alert.alert("No songs", "Add some songs first.");
      return;
    }

    const trackIds = tracks.map(s => s.spotify_id.replace('spotify:track:', ''));
    const cleanName = (isMaster ? "MasterVibe" : tripName).replace(/[^a-zA-Z0-9]/g, '') || 'TripSoundtrack';
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
      playAsTrackset();
      return;
    }

    setIsPlayingAll(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const trackUris = playlist
      .filter(s => s.spotify_id && s.spotify_id.startsWith('spotify:track:'))
      .map(s => s.spotify_id);

    if (trackUris.length > 0) {
      try {
        let deviceId = await waitForDevice(token, 1500);

        if (deviceId) {
          await playTracksOnDevice(trackUris, token, deviceId);
          Linking.openURL('spotify://');
          setIsPlayingAll(false);
          return;
        }

        Linking.openURL(trackUris[0]);
        deviceId = await waitForDevice(token, 10000);
        if (!deviceId) throw new Error('NO_DEVICE_REGISTERED');

        for (let retry = 0; retry < 4; retry++) {
          try {
            await playTracksOnDevice(trackUris, token, deviceId);
            setIsPlayingAll(false);
            return;
          } catch (e: any) {
            const retryable = typeof e?.message === 'string' && e.message.toLowerCase().includes('network');
            if (retryable && retry < 3) {
              await new Promise(r => setTimeout(r, 1500 * (retry + 1)));
              continue;
            }
            throw e;
          }
        }
      } catch (e: any) {
        console.warn('[Spotify] Player API path failed:', e?.message);
      }
    }

    playAsTrackset();
    setIsPlayingAll(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: '#000', paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <TouchableOpacity onPress={onClose} style={styles.backBtn}><ChevronLeft size={28} color="#FFF" /></TouchableOpacity>
          <View>
            <Text style={styles.headerSubtitle}>{isMaster ? "GLOBAL COLLECTION" : (spotifyUser ? `CONNECTED AS ${spotifyUser.display_name.toUpperCase()}` : (tripName || "Trip").toUpperCase())}</Text>
            <Text style={styles.headerTitle}>Our Songs</Text>
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

          {!showSearch && !showMasterPicker && playlist.length > 0 && (
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
              <TouchableOpacity onPress={() => { setShowSearch(false); setSelectedTrackIds(new Set()); }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
            </View>

            {isSearching ? <ActivityIndicator color="#1DB954" style={{ marginTop: 40 }} /> : (
              <FlatList
                data={searchResults}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => {
                  const isSelected = selectedTrackIds.has(item.uri);
                  const isAdded = playlist.some(p => p.spotify_id === item.uri);
                  return (
                    <TouchableOpacity style={styles.trackCard} onPress={() => !isAdded && toggleSelection(item.uri)}>
                      <Image source={{ uri: item.albumArt }} style={styles.trackArt} />
                      <View style={styles.trackInfo}><Text style={styles.trackName} numberOfLines={1}>{item.name}</Text><Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text></View>
                      {isAdded ? (
                        <Check size={20} color="#1DB954" />
                      ) : (
                        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                          {isSelected && <Check size={14} color="white" />}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
            
            {selectedTrackIds.size > 0 && (
              <MotiView from={{ translateY: 100 }} animate={{ translateY: 0 }} style={styles.confirmToolbar}>
                <TouchableOpacity style={styles.confirmBtn} onPress={addSelectedTracks}>
                  <Text style={styles.confirmBtnText}>Add {selectedTrackIds.size} to Plan</Text>
                </TouchableOpacity>
              </MotiView>
            )}
          </MotiView>
        ) : showMasterPicker ? (
          <MotiView key="masterPicker" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.content}>
            <View style={styles.searchBarWrapper}>
              <View style={[styles.searchBar, { backgroundColor: 'rgba(29, 185, 84, 0.1)' }]}>
                <Library size={20} color="#1DB954" />
                <Text style={{ color: '#1DB954', fontWeight: '800', fontSize: 16 }}>Pick from Our Songs</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowMasterPicker(false); setSelectedTrackIds(new Set()); }}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
            </View>

            <FlatList
              data={masterSongs}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const isSelected = selectedTrackIds.has(item.spotify_id);
                const isAlreadyAdded = playlist.some(p => p.spotify_id === item.spotify_id);
                
                return (
                  <TouchableOpacity 
                    style={[styles.trackCard, isAlreadyAdded && { opacity: 0.5 }]} 
                    onPress={() => !isAlreadyAdded && toggleSelection(item.spotify_id)}
                    disabled={isAlreadyAdded}
                  >
                    <Image source={{ uri: item.album_art }} style={styles.trackArt} />
                    <View style={styles.trackInfo}>
                      <Text style={styles.trackName} numberOfLines={1}>{item.track_name}</Text>
                      <Text style={styles.trackArtist} numberOfLines={1}>{item.artist_name}</Text>
                    </View>
                    {isAlreadyAdded ? (
                      <Check size={20} color="rgba(255,255,255,0.2)" />
                    ) : (
                      <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                        {isSelected && <Check size={14} color="white" />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<View style={styles.emptyState}><Library size={64} color="rgba(255,255,255,0.1)" /><Text style={styles.emptyText}>Master list is empty. Add songs in Settings first!</Text></View>}
            />

            {selectedTrackIds.size > 0 && (
              <MotiView from={{ translateY: 100 }} animate={{ translateY: 0 }} style={styles.confirmToolbar}>
                <TouchableOpacity style={styles.confirmBtn} onPress={addSelectedTracks}>
                  <Text style={styles.confirmBtnText}>Add {selectedTrackIds.size} to Plan</Text>
                </TouchableOpacity>
              </MotiView>
            )}
          </MotiView>
        ) : (
          <MotiView key="list" from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.content}>
            {loading ? <ActivityIndicator color="#1DB954" style={{ marginTop: 40 }} /> : (
              <FlatList
                data={playlist}
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
                ListEmptyComponent={<View style={styles.emptyState}><Music size={64} color="rgba(255,255,255,0.1)" /><Text style={styles.emptyText}>{isMaster ? "Search and add songs you both love!" : "Add new ones or pick from Our Songs!"}</Text></View>}
              />
            )}
            
            <View style={styles.bottomButtons}>
              {isMaster ? (
                <TouchableOpacity style={[styles.floatingAddBtn, { backgroundColor: '#1DB954' }]} onPress={() => setShowSearch(true)}>
                  <Plus size={28} color="white" />
                </TouchableOpacity>
              ) : (
                <View style={{ flexDirection: 'row', gap: 15, position: 'absolute', bottom: 30, right: 20 }}>
                  <TouchableOpacity style={[styles.floatingAddBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]} onPress={() => { setShowSearch(true); setSelectedTrackIds(new Set()); }}>
                    <Search size={24} color="white" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.floatingAddBtn, { backgroundColor: theme.tint }]} onPress={() => { setShowMasterPicker(true); fetchMasterSongs(); setSelectedTrackIds(new Set()); }}>
                    <Plus size={28} color="white" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
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
  listContent: { paddingHorizontal: 20, paddingBottom: 120 },
  trackCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  playlistItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, paddingVertical: 8, paddingLeft: 10, paddingRight: 15, marginBottom: 12 },
  trackMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackArt: { width: 50, height: 50, borderRadius: 10 },
  trackInfo: { flex: 1, marginLeft: 15 },
  trackName: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  trackArtist: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
  trashBtn: { padding: 5 },
  emptyState: { alignItems: 'center', marginTop: 100 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 16, fontWeight: '700', textAlign: 'center', paddingHorizontal: 40, marginTop: 20 },
  floatingAddBtn: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', elevation: 10 },
  bottomButtons: { position: 'absolute', bottom: 30, right: 20 },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: '#1DB954', borderColor: '#1DB954' },
  confirmToolbar: { position: 'absolute', bottom: 30, left: 20, right: 20, backgroundColor: '#1DB954', borderRadius: 20, height: 60, justifyContent: 'center', alignItems: 'center', elevation: 10, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10 },
  confirmBtn: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  confirmBtnText: { color: 'white', fontSize: 18, fontWeight: '900' },
});