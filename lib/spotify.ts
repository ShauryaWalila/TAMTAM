/**
 * Official Spotify Web API Integration
 */
import 'react-native-url-polyfill/auto';
import { makeRedirectUri } from 'expo-auth-session';
import { db } from './db';

// Read Spotify client ID from system_config (set via Settings → Tools).
// Synchronous so it can be called during a component's render.
export const getSpotifyClientId = (): string => {
  try {
    const row = db.getFirstSync(`SELECT value FROM system_config WHERE key = 'spotify_client_id'`) as any;
    if (row?.value && row.value.trim().length > 0) return row.value.trim();
  } catch {}
  return '';
};

export const REDIRECT_URI = makeRedirectUri({
  scheme: 'tamtam',
  path: 'spotify-auth',
});

export const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-modify-playback-state',
  'user-read-playback-state',
];

async function handleResponse(response: Response, label: string) {
  const text = await response.text();
  if (!response.ok) {
    console.error(`[Spotify ${label} Error] Status: ${response.status}`);
    console.error(`[Spotify ${label} Error] URL: ${response.url}`);
    const hdrs: Record<string, string> = {};
    response.headers.forEach((v, k) => { hdrs[k] = v; });
    console.error(`[Spotify ${label} Error] Headers: ${JSON.stringify(hdrs)}`);
    console.error(`[Spotify ${label} Error] Body: ${text}`);
    if (response.status === 401) throw new Error('TOKEN_EXPIRED');
    throw new Error(`API_ERROR_${response.status}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

export const searchTracks = async (query: string, token: string) => {
  if (!query || !token) return [];

  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  try {
    const encoded = encodeURIComponent(cleanQuery);
    // `limit` was previously rejected with a misleading "Invalid limit"; the
    // real fix was adding `market=from_token`. Default page size is 20 anyway.
    const url =
      'https://api.spotify.com/v1/search' +
      `?q=${encoded}` +
      `&type=track` +
      `&market=from_token`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    const data = await handleResponse(response, 'Search');

    return (data.tracks?.items || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      artist: item.artists.map((a: any) => a.name).join(', '),
      albumArt: item.album.images[0]?.url,
      uri: item.uri,
      source: 'spotify'
    }));
  } catch (e) {
    console.error('[Spotify] Search error:', e);
    throw e;
  }
};

export const getUserProfile = async (token: string) => {
  const response = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return handleResponse(response, 'Profile');
};

// Player API direct-play. Pass `deviceId` to target a specific device
// (recommended after a deep-link wake-up, since `is_active` lags by a few
// seconds). Without `deviceId`, Spotify requires an already-active device or
// returns 404 NO_ACTIVE_DEVICE.
export const playTracksOnDevice = async (
  uris: string[],
  token: string,
  deviceId?: string,
): Promise<void> => {
  const url = deviceId
    ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : 'https://api.spotify.com/v1/me/player/play';
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uris }),
  });
  await handleResponse(response, 'PlayTracks');
};

// Poll /me/player/devices until any device is available. Spotify takes a few
// seconds after a deep-link wake-up before the device shows up to the Web API,
// even though it's already playing locally.
export const waitForDevice = async (token: string, maxWaitMs = 8000): Promise<string | null> => {
  const startedAt = Date.now();
  let attempt = 0;
  while (Date.now() - startedAt < maxWaitMs) {
    attempt++;
    try {
      const response = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const devices = data.devices || [];
        const active = devices.find((d: any) => d.is_active) || devices[0];
        if (active?.id) {
          console.log(`[Spotify][DBG] device ready after ${attempt} polls (${Date.now() - startedAt}ms): ${active.name} (active=${active.is_active})`);
          return active.id;
        }
      }
    } catch (e) {
      // swallow transient errors and keep polling
    }
    await new Promise(r => setTimeout(r, 750));
  }
  console.warn(`[Spotify][DBG] waitForDevice timed out after ${maxWaitMs}ms (${attempt} polls)`);
  return null;
};
