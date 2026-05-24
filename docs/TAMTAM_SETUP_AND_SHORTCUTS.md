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

### B1. Time-based reminders — handled inside the app (NO Shortcut needed)

**You do not need to create one Shortcut per reminder anymore.** The app schedules iOS local notifications automatically every time you create / edit / delete any of these from inside TAMTAM:

- Routines + timetable rows (`(tabs)/index` + `(tabs)/settings`)
- Chill-Zone time reminders (`type: 'reminder'`, `remType: 'time'`)
- Calendar events
- Couple meetings
- Study routines + exam dates (T-1-day + day-of)
- Diet plans (today + tomorrow meal-time)
- Anniversaries (yearly recurring)

How: `lib/notifications.ts → syncAllNotifications()` reads every reminder source from the local SQLite DB and pushes them into `UNUserNotificationCenter` via `expo-notifications`. It runs:
- on app launch (`app/_layout.tsx`),
- every time you bring the app to the foreground,
- on every mutation to a reminder table (auto-fired from `lib/db.ts`'s `runSync` patch — debounced 600 ms),
- on every partner-side change delivered through the realtime `DATA_REFRESH` event.

**One-time setup:** the first launch will prompt for Notification permission — tap **Allow**. That's it. No per-item Shortcut, ever.

> **Cap:** iOS limits each app to ~64 pending local notifications. The sync prunes old ones first (`cancelAllScheduledNotificationsAsync`) on each rebuild, then schedules upcoming events. Diet plans are scoped to today + tomorrow to stay under the cap.

> **Free Apple Dev:** local notifications work fully. Only *remote push* (APNs) requires a paid account — TAMTAM doesn't use it.

### B4. Proximity Alerts (memories / wishlist pins) — also handled by the app

App location: `lib/location.ts` registers iOS geofences automatically for shared memories + wishlist spots and fires a local notification on arrival. The Shortcut recipe below is **only** a backup if iOS rejects an in-app geofence (rare — happens past the ~20-region per-app limit).

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

### B7. (Optional) Spoken Routine Announcer — only if you want TTS on top of the in-app notification

The app already shows the routine notification (B1). If you also want iOS to *speak* it aloud, create a Shortcut **per recurring routine** (downside: same per-item duplication you wanted to avoid — only set this up for the 1–2 routines you really want spoken):

1. Trigger: Time of Day, weekday + time matching a routine.
2. Action: **Speak Text** → `Time for <activity>`.
3. Run Without Confirmation = ON. Save.

### B11. Auto-Refresh SideStore + the TAMTAM IPA (no more weekly manual refresh)

Free Apple Dev IPAs expire every 7 days. Goal: device re-signs TAMTAM (and every other sideloaded app) automatically, with zero manual steps, ever again.

The mechanism is **SideStore's Background Refresh**. It uses iOS background fetch to wake SideStore up periodically; when awake, it re-signs all installed apps using your Anisette + pairing-file credentials. The Shortcut layer below acts as a "kick the wheels" backup in case iOS doesn't grant a background slot for a few days.

**One-time setup (do this once, never again):**

1. **Anisette server** — SideStore needs an anisette server to mint Apple auth tokens.
   - SideStore Settings → **Server URL** → use either:
     - `https://ani.sidestore.io` (community-hosted, free, default)
     - OR self-host: https://github.com/SideStore/SideStore-Anisette-Server (best for reliability)
   - Whichever you pick, save and confirm a successful test.
2. **Pairing file** — generated by Jitterbug on a Mac/PC ONE time, uploaded to SideStore. Once installed, SideStore stores it; no further computer needed.
   - Follow https://docs.sidestore.io/getting-started — about 10 minutes total.
3. **iOS background refresh** — enable it for SideStore:
   - iOS Settings → **General → Background App Refresh** = ON (master switch).
   - Find **SideStore** in that same list → toggle ON.
4. **Inside SideStore** → Settings → enable **Background Refresh**. Some builds also offer **"Refresh attempts per day"** — set to 24 if available.
5. **VPN trick (SideStore needs an active VPN to refresh in background):**
   - SideStore installs a local VPN config (loopback) on first run. Make sure **iOS Settings → VPN → SideStore = Connected**. Set the VPN status to "Connect on Demand" if shown.
   - Without this active VPN, background refresh silently no-ops.

**Auto-launch Shortcut (the safety net):**

In case iOS de-prioritises SideStore's background slot, set up a Personal Automation that opens SideStore daily — when it opens, it auto-refreshes everything (this is its default behavior).

1. iOS **Shortcuts → Automation → +** → **Create Personal Automation**.
2. **Time of Day** → set to **3:00 AM** (or any time the device is usually plugged in / on WiFi but you're not using it).
3. **Daily** → Next.
4. Add action: **Open App** → choose **SideStore**.
5. **Run Without Confirmation = ON**. Save.

That's it. SideStore opens silently at 3 AM, refreshes all installed apps, certificates renew before the 7-day clock runs out.

**Tighter version (recommended) — twice daily:**
- Create the same Automation again at **3:00 PM** as a second insurance ping.
- iOS allows multiple Personal Automations triggering on the same action.

**Plus a weekly safety reminder (only fires if something went wrong):**
- Personal Automation → **Time of Day → Weekly → Saturday 10 AM**.
- Action: **Show Notification** → title `"🔁 Check SideStore"`, body `"Quick glance to ensure TAMTAM and SideStore haven't expired."`.
- Run Without Confirmation = ON.

If everything's running on rails you'll never have to act on this reminder — but it surfaces a problem within a day instead of waiting until the app silently dies.

**Conditions that must stay true for fully-hands-off refresh:**
- iPhone/iPad regularly plugged in at night, on the same WiFi as your anisette server (if self-hosted).
- VPN profile for SideStore stays enabled.
- iOS doesn't kill SideStore's background slot for too many days (this happens if you NEVER open the app — the daily auto-launch above prevents that).

**If something does break:**
- iOS will show an "Untrusted Developer" prompt next time you launch TAMTAM. The auto-launch Shortcut + SideStore's refresh will fix it within hours.
- Worst case: open SideStore manually, tap **Refresh All**. One tap, ~10 seconds.

**The bigger picture:** free Apple Dev + SideStore is the trade-off. The above turns it from a weekly chore into a self-healing system. As long as your phone charges at night and your anisette server stays up, you'll never have to think about the 7-day window again.

---

### B10. Make Sure Budget / Finance Alerts Surface

Budget breach alerts are **local notifications fired from inside TAMTAM** — no remote push, no server. To make sure they reach the lock screen / banner / vibrate properly:

1. iOS **Settings → Notifications → TAMTAM**:
   - **Allow Notifications = ON**.
   - **Lock Screen + Notification Center + Banners = all ON**.
   - **Banner Style** = Persistent (so a money alert doesn't vanish in 2 seconds while you scroll the web).
   - **Sounds = ON**, **Badges = ON**.
   - **Show Previews** = "Always" (the alert body has no figures anyway — privacy is preserved by design).
2. **Focus filters**: by default, Focus modes (Do Not Disturb, Sleep, Work) will silence the alerts. If you want them to break through, scroll to **Notifications → TAMTAM → Time Sensitive Notifications → Allow**. Now critical money alerts ring even during DND.
3. Inside TAMTAM, the alert grants permission on first launch. If you accidentally denied it, go to iOS Settings → TAMTAM → Notifications → Allow.

**No Shortcut needed for budget alerts.** They fire when the app:
- Saves a new transaction (yours or partner's, when sync arrives).
- Opens the Finance screen (background scan catches anything that happened on the other device).

**Privacy note:** The notification body never includes amounts, category names, or merchant descriptions. Only `"A budget limit has been reached."` plus a one-line generic hint (e.g. "Too many transactions in a short window"). Safe to leave previews on.

**For partner-side breach pings** (optional): TAMTAM currently only fires the alert on the device of the user whose budget was breached. If you want partner alerts too (gentle "your partner hit a limit" ping), tell me and I'll wire it via a Supabase realtime channel.

---

### B9. Bank-SMS → Auto Finance Entries

iOS doesn't let third-party apps read SMS. Workaround: a Personal Automation that fires on every incoming message from your bank, parses the amount + direction, and POSTs it to your TAMTAM Supabase via REST. Only legit bank messages trigger; spam is filtered out by the sender allow-list.

**One-time setup per bank sender:**

1. Find your bank's SMS sender ID (e.g. `HDFCBK`, `VK-SBIINB`, `BX-AXISBK`). Note it.
2. Open **Shortcuts → Automation → +** → **Create Personal Automation** → **Message**.
3. **Sender** → **Choose** → type/paste the bank ID. **Message contains** → leave empty (we filter in the script). **Run Without Confirmation = ON.** Next.
4. Add Action: **Get Contents of URL** with:
   - URL: `https://<your-project>.supabase.co/rest/v1/finances`
   - Method: `POST`
   - Headers:
     - `apikey`: `<SUPABASE_ANON_KEY>`
     - `Authorization`: `Bearer <SUPABASE_ANON_KEY>`
     - `Content-Type`: `application/json`
     - `Prefer`: `return=minimal`
   - Body (JSON):
     ```json
     {
       "user_id": "<your user_name in TAMTAM, lowercase>",
       "amount": -<PARSED_AMOUNT>,
       "category": "auto-bank",
       "description": "<SHORT_DESC_FROM_MESSAGE>",
       "type": "debit",
       "transaction_date": "<YYYY-MM-DD>",
       "source": "sms_bank",
       "bank_ref": "<TXN_ID_OR_MSG_FIRST_60_CHARS>"
     }
     ```
5. The trick: use the Shortcut's **Get Text from Input** + **Match Text** + **Calculate** actions to:
   - Pull the SMS body (Shortcut input → `Message`).
   - Regex out the amount: pattern `(?:Rs\.?|INR|₹)\s?([\d,]+\.?\d*)`.
   - Regex direction: keyword `debited|sent|paid|withdrawn|w/d` → amount is negative; `credited|received|deposited|cr` → positive.
   - Spam filter: bail out (Stop Shortcut) if the message does NOT contain any of those keywords.
6. **Run Without Confirmation = ON.** Save.

**Recommended sender allow-list (India banks):**
`HDFCBK`, `SBIINB`, `ICICIB`, `AXISBK`, `KOTAKB`, `BOIIND`, `PNBSMS`, `YESBNK`, `IDFCFB`, `INDUSB`, `BARODA`, `CANBNK`. Create one Automation per sender you use.

**For each spouse/partner**, use their own `user_id` and their own bank senders. Same Supabase endpoint, anon key works for both.

**Reverse direction (income):** the same Automation handles it via the keyword regex. Amount goes in positive when the body says "credited".

**Verification:** open TAMTAM → Finance tab → recent transactions list. The auto-captured row shows a small "SMS" badge (after the schema migration below). Wrong row? Long-press → delete (won't re-import the same SMS unless that exact message arrives again).

**Manual entries in addition to auto:**
- Tap **+** in Finance → add transaction → pick **today** or any back-dated date → it's stored under that date and slotted into the right grouping. `source = 'manual'`.

**Trip-scoped finance:**
- When you're inside a Trip → Plan → Finance, all the same actions apply but the entry gets `trip_id` set automatically. The home Finance screen ignores `trip_id` and shows everything (source of truth); the trip screen filters down to that trip's date range only.

**Budgets:**
- Add a budget in Finance → Budgets → choose frequency (daily / weekly / monthly / yearly). When the period rolls over, a fresh tracker for the next period auto-spawns. Old period stays in history.

---

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
- [ ] First-launch permission prompts granted: **Notifications**, Location (Always), Photos, Camera, FaceID. Notifications must be **Allow** — that unlocks the entire in-app reminder system (B1).
- [ ] SideStore auto-refresh stack (B11): Anisette server URL set, pairing file imported, iOS Background App Refresh ON for SideStore + TAMTAM, SideStore Background Refresh ON, daily 3 AM + 3 PM Open-App Shortcuts (B11), weekly Saturday safety reminder.
- [ ] Bank-SMS Shortcut(s) per bank sender (B9) — *only* one Shortcut needed per **bank**, not per transaction.
- [ ] (Optional, redundant) Re-sign weekly reminder (B5) — only if you don't trust B11 yet.
- [ ] (Optional) Hourly app-open Shortcuts (B6) for real-time partner events.

**You do not need any Shortcuts for routines, calendar events, chill-zone reminders, meetings, study schedules, exams, diet plans, anniversaries, or memory / wishlist geofences.** The app handles all of those via local notifications (see B1).
