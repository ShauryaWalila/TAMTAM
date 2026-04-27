# Spotify Trip-Soundtrack — Handoff

**Last updated:** 2026-04-27
**Status:** Search ✅ • Add to plan ✅ • Play All flow ⚠️ (waiting on next test)

---

## What the user wants

From the Vibe Board (per-trip "Trip Soundtrack" screen):
1. Search Spotify for songs.
2. Add them to the trip plan (persisted in Supabase `trip_songs`).
3. **Play All** button → creates a Spotify playlist titled `TAMTAM: <tripName>`, populates it with the trip's songs, and opens it in the Spotify app to play.

User has Spotify Premium. Logged-in display name is **ROY**.

---

## What was fixed this session

### 1. Search 400 "Invalid limit" — FIXED
- **Symptom:** `GET /v1/search?q=...&type=track&limit=20` returned `{"error":{"status":400,"message":"Invalid limit"}}` even though `limit=20` is in Spotify's valid 1–50 range.
- **First (wrong) hypothesis:** `react-native-url-polyfill` mangling `searchParams`. Switched to manual `encodeURIComponent` URL build — error persisted.
- **Actual cause:** Spotify returned a misleading "Invalid limit" message; real issue was that the request needed a `market` and the `limit` param was a red herring.
- **Fix (lib/spotify.ts:47–56):** Dropped `limit` (default is 20 anyway), added `market=from_token`. Search now works.

### 2. Play All / Sync 403 — IN PROGRESS, two competing theories
After search was fixed, pressing Play All:
- ✅ `POST /me/playlists` (create) succeeds — playlist is created.
- ❌ `POST /playlists/{id}/tracks` (add tracks) returns 403 Forbidden, generic body, no `WWW-Authenticate` header.

**Confirmed via fresh-login log:** the token's granted scopes include `playlist-modify-public` AND `playlist-modify-private`. So this is **not** a scope issue.

That leaves two possibilities, and we now have code that addresses both:

**Theory A — Spotify Developer App in Dev Mode, ROY not allowlisted.**
Spotify lets non-allowlisted users read and create empty playlists, but blocks writes against them. Fix is on the Spotify Dashboard — see "User action" below.

**Theory B — Spotify eventual consistency on freshly-created playlists.**
Newly-created playlists can take 1–4 s to propagate, during which writes 403 with no body detail. **The user added a retry helper for this in lib/spotify.ts:157–204 (`addTracksWithFreshRetry`)**: 600 ms warm-up + retries at 800 ms, 1500 ms, 2500 ms. Total ~5 s worst case. If it's eventual consistency, this will paper over the issue silently.

**Next test will tell us which theory is right** (see "Resume here" below).

### 3. Auxiliary improvements
- **Forced consent on every login** — added `extraParams: { show_dialog: 'true' }` to `useAuthRequest` (TripSoundtrack.tsx:71). Stops Spotify from silently reusing old cached scope-grants.
- **Stopped playlist-spam on retry** — `ensureSyncedPlaylist` no longer re-creates a brand-new playlist when the just-created one 403s. (Previous logic was creating two empty TAMTAM playlists per Play All press.)
- **Diagnostic logging** — `lib/spotify.ts` `handleResponse` logs URL + headers + body on every error. `searchTracks` warns the raw query, encoded query, final URL, and token prefix/length. `handleTokenExchange` warns the granted scopes. Search for `[Spotify][DBG]` in Metro logs.
- **Honest 403 alert with fallbacks** — `playTripSoundtrack` 403 path now offers:
  - **Open Dashboard** → opens https://developer.spotify.com/dashboard
  - **Play Anyway** → uses Spotify's `spotify:trackset:` deep link to play the songs without a named playlist
- **Added `playAsTrackset()` helper** (TripSoundtrack.tsx) — extracts trackset deep-link logic into a reusable function.
- **Added `getPlaylistTrackUris(...)` and dedup logic in `syncPlaylistTracks`** — re-syncs only add tracks not already in the playlist (no duplicates).

---

## Files modified

- `lib/spotify.ts`
  - `handleResponse` — logs URL/headers on error.
  - `searchTracks` — manual URL build; dropped `limit`; added `market=from_token`; DBG logs.
  - `addTracksWithFreshRetry` (NEW) — eventual-consistency retry helper.
  - `syncPlaylistTracks` (NEW) — fresh-vs-existing branch; dedup on existing.
  - `getPlaylistTrackUris` (NEW) — paginated fetch of playlist track URIs.
  - `replaceTracksInPlaylist` still exists but is now unused; safe to remove later.

- `components/PlanMode/TripSoundtrack.tsx`
  - Imports `syncPlaylistTracks` instead of `replaceTracksInPlaylist`.
  - `useAuthRequest` has `show_dialog: 'true'`.
  - `handleTokenExchange` warns granted scopes.
  - `ensureSyncedPlaylist` tracks `freshlyCreated`, calls `syncPlaylistTracks`, retry guard prevents playlist spam.
  - `playAsTrackset()` helper added.
  - `playTripSoundtrack` 403 branch shows Dev-Mode-aware alert with Open Dashboard / Play Anyway buttons.

---

## RESUME HERE — what the user should do next

### Step 1 — Reload the app (HMR may not pick up `lib/` cleanly)

```
# In the Metro terminal:
r           # reload, OR
# Stop Metro (Ctrl+C) and:
npx expo start --clear
```

### Step 2 — Try Play All

Press Play All on a trip that has at least one song.

**Outcome A — It just works** → Theory B was right. The retry helper masked an eventual-consistency 403. Done. Watch Metro for `[Spotify] addTracks succeeded on retry N` — that confirms it was a race.

**Outcome B — Alert "Spotify Dev-Mode Lock" still appears** → Theory A is right. Retry exhausted; Spotify really is rejecting the write. Continue to Step 3.

### Step 3 (only if Outcome B) — Allowlist ROY in the Spotify Developer Dashboard

On a desktop browser:
1. https://developer.spotify.com/dashboard → sign in with the account that **owns** the TAMTAM Spotify app (Client ID is `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` in `.env`).
2. Click TAMTAM app → **Settings** → tab **User Management**.
3. **Add New User**:
   - Full name: `ROY` (Spotify display name)
   - Email: ROY's Spotify-account email
4. Save. (No email-confirmation click needed.)

Then in the app: long-press green sync button (logout) → tap Spotify button (login) → press Play All.

### Step 4 — Cleanup
The earlier failed runs created several empty `TAMTAM: <tripName>` playlists in ROY's Spotify account. Delete them from the Spotify app → Library.

---

## Open questions / future polish

- `replaceTracksInPlaylist` is now unused — remove if you don't need PUT semantics elsewhere.
- The current retry waits up to ~5 s on the FIRST Play All press of a fresh trip. UX could show "Creating playlist…" during that wait (currently shows the same `ActivityIndicator` as before).
- `ensureSyncedPlaylist`'s sync-record approach (storing `spotify:playlist:<id>` rows in `trip_songs` keyed by a magic name `SPOTIFY_SYNC_RECORD`) is fragile; a dedicated column on the trip row would be cleaner.
- If/when the app graduates to Spotify Extended Quota (production mode), the allowlist requirement goes away.

---

## Useful one-liners

```bash
# Search for Spotify-related code:
grep -rn "spotify" lib/ components/PlanMode/ --include="*.ts" --include="*.tsx"

# Watch Metro logs for the key markers:
# [Spotify][DBG] — diagnostic info from search + token exchange
# [Spotify Search Error] — search failures with URL/headers/body
# [Spotify AddTracks Error] — track add failures
# [Spotify] addTracks succeeded on retry N — eventual-consistency proof
```
