# TAMTAM — Complete Setup Guide (Free Apple Dev + Sideload + Shortcuts)

Single source for everything you need to know to install TAMTAM via SideStore and configure every iOS Shortcut needed to compensate for free-dev limitations.

**Skip to:**
- [Part A — Quick install / re-install](#part-a--quick-install--re-install)
- [Part B — Set up Shortcuts (one-time per device)](#part-b--set-up-shortcuts-one-time-per-device)
- [Part C — Known limitations and workarounds](#part-c--known-limitations-and-workarounds)
- [Part D — Developer notes / code-level fixes](#part-d--developer-notes--code-level-fixes)

---

## Part A — Quick install / re-install

### First install
1. Open SideStore on iPhone with VPN active.
2. Drag/import `TAMTAM.ipa` (from GitHub Actions artifact).
3. Trust the developer cert in Settings → General → VPN & Device Management → your Apple ID → Trust.
4. Open TAMTAM → grant Notifications, Location, Photos, Camera, FaceID prompts as they appear.

### Weekly re-sign (free Apple Dev expires after 7 days)
- SideStore can auto-refresh if you keep VPN running occasionally.
- Or: Section B5 below sets up a Shortcut that reminds you every 6 days.

---

## Part B — Set up Shortcuts (one-time per device)

Open the **Shortcuts** app → **Automation** tab → tap **+** (top right) → **Create Personal Automation**. Every recipe below starts from that screen.

### B1. Routines / Schedules (one Shortcut per recurring item)

App location: `(tabs)/our-life` → routines + `(tabs)/settings` → timetable rows.

For each routine row (day + time + activity):

1. Trigger: **Time of Day** → set time → **Weekly** → check matching weekday → Next.
2. Action: **Show Notification**
   - Title: `⏰ Starting: <activity>`
   - Body: `Time for your routine ✨`
3. **Run Without Confirmation = ON.** Save.

Repeat once per (day, time, activity). If a routine repeats on multiple days, create one automation per day.

### B2. Chill-Zone Time Reminders

App location: `(tabs)/chill-zone` → items with `type: 'reminder'` and `remType: 'time'`.

For each reminder:

1. Trigger: **Time of Day** → set time → **Once** or **Daily/Weekly** as appropriate → Next.
2. Action: **Show Notification**
   - Title: `⏰ <reminder name>`
   - Body: `Starting now ❤️`
3. (Optional) Add second action: **Open App** → TAMTAM.
4. **Run Without Confirmation = ON.** Save.

If reminder has end_at, repeat with title `✅ Finished: <name>` at end time.

### B3. Calendar Events (one-off dated items)

Two options:

**Option A — iOS Calendar app (recommended for one-off dates):**
1. Open Calendar → New Event.
2. Title: `📅 <event name>`
3. Date + 9:00 AM (app's default trigger time).
4. Alert: "At time of event". Save.

**Option B — Shortcuts:**
1. Trigger: Time of Day → set date + time → **Once**.
2. Action: Show Notification → title `📅 <event name>` → body `Today's plan ✨`.
3. Run Without Confirmation = ON. Save.

### B4. Proximity Alerts (memories / wishlist pins)

App location: `lib/location.ts` geofences on shared memories + wishlist spots.

For each location pin:

1. Trigger: **Arrive**.
2. Tap **Choose** → search/drop pin → confirm radius (default 100m) → Next.
3. Action: **Show Notification**
   - Title: `📍 You're near <memory name>!`
   - Body: `A shared moment is right here ❤️`
4. (Optional) Add **Open App** → TAMTAM.
5. **Run Without Confirmation = ON.** Save.

For wishlist spots: same pattern, title `🌟 Wishlist spot nearby!`.

**iOS limit:** ~20 geofence automations total. Prioritize most-visited.

### B5. Re-Sign Reminder (every 6 days)

1. Trigger: **Time of Day** → 9:00 AM → **Weekly** → pick one day → Next.
2. Action: **Show Notification**
   - Title: `🔁 Re-sign TAMTAM`
   - Body: `Open SideStore today to refresh the signing cert.`
3. Run Without Confirmation = ON. Save.

(Or set every 6 days manually — Shortcuts only support Weekly granularity, so pick a weekday and stick to it.)

### B6. Hourly App-Open (workaround for real-time partner events)

Real-time touches/diary/study pings from Supabase only deliver while app is foreground. Hourly auto-open keeps the socket fresh.

1. Trigger: **Time of Day** → 8:00 AM → **Daily** → Next.
2. Add Action: **Repeat** (looped over hourly schedule). Actually Shortcuts doesn't loop natively — workaround: create 12 separate Automations at 8AM, 9AM, …, 7PM each with Action: **Open App** → TAMTAM.
3. Run Without Confirmation = ON. Save each.

Heavier hand: skip this if you don't need real-time partner pings (most days you'll open the app yourself anyway).

### B7. (Optional) Spoken Routine Announcer

Make routines audible:
1. Trigger: Time of Day, weekday + time matching a routine.
2. Action: **Speak Text** → `Time for <activity>` → then **Show Notification** for visual.
3. Run Without Confirmation = ON. Save.

Useful for cooking timers, workouts.

### B8. (Optional) Focus-Mode Bypass for Critical Alerts

For proximity alerts you want even during Do Not Disturb:
1. Open the Shortcut you created in B4.
2. Edit the **Show Notification** action.
3. Tap "Interruption Level" → **Time Sensitive**.
4. Save. Now bypasses Focus filters.

---

## Part C — Known limitations and workarounds

### C1. Notifications

| Feature | Status | Workaround |
|---|---|---|
| Local time/date notifications | ✅ Works free | None needed |
| Geofence proximity | ✅ Works free | None needed |
| Calendar-triggered local notifs | ✅ Works free | None needed |
| Remote push (Expo Push / APNs) | ❌ Paid only | Shortcut B6 + iMessage side-channel |
| Live Activities (Dynamic Island) | ❌ Paid only | Not used in app |
| Home-screen widgets | ❌ Paid only | Removed from app |

### C2. Real-Time Partner Events

Supabase Realtime channels (`diary_widget_updates`, `moments_widget_updates`, `posts_widget_updates`) deliver only while app is foreground. Background = no socket = no event.

**Best workarounds:**
1. Shortcut B6 (hourly app-open).
2. Out-of-band: partner sends quick iMessage `💜` when sending a touch — system notifies natively.
3. Use iCloud Shared Reminders for time-critical pings.

### C3. Maps

`react-native-maps` ships with Apple Maps tiles on iOS (free). The library is still used — Markers, Callouts, pin-add code all unchanged. No Google Maps API key needed.

Your separate **Google Maps in WebView** flow (for copying lat/lng coordinates) is untouched and works fine — WKWebView is free.

### C4. App expiry

Free Apple Dev signed apps expire after 7 days → must re-sign via SideStore (Shortcut B5 reminds you).

### C5. 3-App Sideload Cap

Free Apple Dev limits sideloaded apps to 3 per device. TAMTAM uses one slot.

### C6. Camera / Photos / Mic / Location / FaceID / Notifications permissions

All work free. Usage descriptions already in `app.json` Info.plist. First time the relevant screen is opened, iOS prompts — grant Allow.

### C7. Spotify

Works free via OAuth + Web API. User must have Spotify account. No iOS entitlement needed.

If Spotify Play All flow 403s on `POST /playlists/{id}/tracks`:
- Either Spotify Developer App is in Dev Mode and your account isn't allowlisted → add yourself in Spotify Dashboard.
- Or eventual-consistency hiccup → app retries automatically.

### C8. GenAI / Google Generative AI

HTTPS POST works. No entitlement. Just need API key in code.

---

## Part D — Developer notes / code-level fixes

### D1. Modal + Alert.alert crash (RESOLVED IN DIET.TSX, OTHERS PENDING)

**Root cause:** `Alert.alert()` called from inside a presented `<Modal>` throws `NSException` because UIAlertController can't present over another presentation in progress. App SIGABRTs.

**Symptom:** Long-press → modal with Edit/Delete → tap Delete → confirm Alert → tap Delete in Alert → crash.

**Fix:** use `lib/safeAlert.ts`:
```ts
import { safeAlert } from '@/lib/safeAlert';

// inside the Modal:
onPress={() => {
  const id = item.id;
  safeAlert(
    () => setShowOptions(null),
    'Delete?',
    'Sure?',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => doDelete(id) },
    ],
  );
}}
```

**Files with both `<Modal>` and `Alert.alert` (audit + fix as needed):**
- ✅ `app/(tabs)/diet.tsx` (fixed)
- ⚠️ `app/(tabs)/chill-zone.tsx`
- ⚠️ `app/(tabs)/draw.tsx`
- ⚠️ `app/(tabs)/journal.tsx`
- ⚠️ `app/(tabs)/settings.tsx`
- ⚠️ `app/(tabs)/wishlist.tsx`
- ⚠️ `app/diary.tsx`
- ⚠️ `app/diet-history.tsx`
- ⚠️ `app/diet-routine.tsx`
- ⚠️ `app/our-life/plans-list.tsx`
- ⚠️ `app/study-hub/deck/[id].tsx`
- ⚠️ `app/study-hub/index.tsx`
- ⚠️ `app/study-hub/syllabus.tsx`
- ⚠️ `app/study-hub/whiteboard/[id].tsx`
- ⚠️ `components/Map/AddPinModal.tsx`
- ⚠️ `components/PlanMode/Bucket.tsx`
- ⚠️ `components/PlanMode/TripWorkspace.tsx`
- ⚠️ `components/PlanMode/Wardrobe.tsx`

If a screen crashes on delete/destructive action, that's the pattern — apply `safeAlert`.

### D2. Stuff already cleaned up in code

- ✅ `expo-notifications` restored, `getExpoPushTokenAsync` skipped.
- ✅ Widgets stripped (`@bittingz/expo-widgets` removed, `lib/widget.ts` is a no-op stub).
- ✅ Live Activities disabled in `app.json`.
- ✅ Map provider falls back to Apple Maps (no API key required).
- ✅ Reanimated 4.1.1 + worklets 0.5.1 (SDK 54 official versions).
- ✅ `lib/safeAlert.ts` helper created.
- ✅ New Architecture enabled (required by Reanimated 4).

### D3. Debug queue inspection

```ts
import * as Notifications from 'expo-notifications';
const all = await Notifications.getAllScheduledNotificationsAsync();
console.log(all);

// Wipe all queued local notifications:
await Notifications.cancelAllScheduledNotificationsAsync();
```

---

## Setup Checklist (Fresh Device)

- [ ] SideStore IPA installed (Part A1).
- [ ] Trust developer cert (Part A1.3).
- [ ] First-launch permission prompts granted: Notifications, Location, Photos, Camera, FaceID.
- [ ] Routines → one Shortcut each (B1).
- [ ] Chill-zone reminders with remType:time → one Shortcut each (B2).
- [ ] Upcoming calendar events → iOS Calendar entries OR Shortcuts (B3).
- [ ] Shared memory pins → "Arrive" Shortcut each (B4).
- [ ] Wishlist spots → "Arrive" Shortcut each (B4).
- [ ] Re-sign reminder Shortcut (B5).
- [ ] (Optional) Hourly app-open Shortcuts (B6) for real-time partner events.
