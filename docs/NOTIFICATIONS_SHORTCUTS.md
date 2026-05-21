# Notifications on Free Apple Developer Sideload

## What works natively (NO setup needed)

`expo-notifications` is **restored**. Local notifications scheduled by the app go through iOS's `UNUserNotificationCenter`, which is free — it does **not** need a paid Apple Developer account or the `aps-environment` entitlement. The OS wakes the phone at trigger time and shows the banner exactly like a normal app.

These all work without any Shortcuts setup:

| Source | Where in code | Mechanism |
|---|---|---|
| Chill-Zone reminders (time-based) | `app/(tabs)/chill-zone.tsx`, `lib/notifications.ts` `syncAllNotifications` | `scheduleNotificationAsync` with `timeInterval` / `calendar` trigger |
| Routines (weekly schedule) | `lib/notifications.ts` `syncAllNotifications` reads `timetable` rows | same, per-weekday calendar trigger |
| Calendar events | `lib/notifications.ts` reads `calendar_events` | same, dated trigger |
| Smart Handover (one routine ends, next begins) | `lib/notifications.ts` combines start/end events | same |
| Proximity alerts (memories / wishlist pins) | `lib/location.ts` geofence + `expo-task-manager` | iOS Core Location wakes the background task on enter/exit → task fires `scheduleNotificationAsync` |

**Permission prompt** — user must grant notifications once on first launch (`app/_layout.tsx` does `requestPermissionsAsync`). After that, all of the above fire natively in the background even when the app is killed.

## What DOESN'T work on free dev

| Source | Why blocked |
|---|---|
| Spontaneous partner-event alerts (touches, study pings via Supabase Realtime) | These need **remote push** (a Supabase channel pushing the device) → requires the `aps-environment` entitlement → paid Apple Developer Program ($99/yr) |
| Expo Push Service tokens | `getExpoPushTokenAsync` registers with APNs → same entitlement requirement |

`lib/notifications.ts` `registerForPushNotificationsAsync` has the `getExpoPushTokenAsync` call **commented out** (see line ~23). Push-token side does nothing on free dev. Permission prompt + local scheduling still run.

## Workaround for the blocked ones (real-time partner events)

The realtime listeners in `app/_layout.tsx` (`diary_widget_updates`, `moments_widget_updates`, `posts_widget_updates`) only deliver when the app is foreground. Two options to surface them when the phone is locked:

### A. iOS Shortcuts "Hourly App-Open" (lightest touch)

1. Shortcuts app → Automation → "+" → Create Personal Automation.
2. **Trigger:** Time of Day → Hourly → "8:00 AM through 11:00 PM" (or your waking hours).
3. **Action:** Open App → TAMTAM.
4. **Run Without Confirmation = ON.** Save.

Result: every hour the app foregrounds briefly, the Supabase realtime subscription reconnects, queued events fire as in-app alarm overlays for the next foreground.

### B. Out-of-band channel for time-critical pings

For partner touches that absolutely need real-time notification:
- Use iMessage (system-level, free) as a side channel — partner sends a quick "💜" iMessage when sending a touch in the app.
- Or use iCloud Shared Reminders: partner adds a reminder to a shared list; iOS notifies natively.

These are paired with the in-app touch — not a replacement for it, but a system-level ping that wakes the device.

## Optional Shortcuts (for richer alerts)

The local notifications produced by the app are plain banners. If you want spoken alerts, custom sounds, or Focus-mode bypassing, you can layer Shortcuts:

### Spoken routine announcer
- Trigger: Time of Day, weekday + time matching a routine row.
- Action: "Speak Text" → `Time for <activity>` → Show Notification.
- Useful for cooking timers, workouts.

### Custom-tone reminder
- Same trigger as a reminder.
- Action: "Play Sound" with chosen file → Show Notification.

### Focus-mode bypass
- For critical proximity alerts (e.g., near a partner's location), set the Shortcut's notification "Time Sensitive" → it bypasses Focus / Do-Not-Disturb.
- iOS Shortcuts → automation → notification action → "Interruption Level" → "Time Sensitive".

These are bonuses on top of what the app already fires.

## Verification checklist (after install)

- [ ] First launch → "Allow notifications" prompt → tap **Allow**.
- [ ] Add a chill-zone reminder for 2 minutes from now → lock phone → wait → banner should appear.
- [ ] Add a routine for Monday 9 AM → check Settings → Notifications → TAMTAM → schedule listed.
- [ ] Drop a memory pin near your current location → walk ~200m away → walk back → "📍 Near <memory>" banner should fire.
- [ ] (Optional) Set up Hourly App-Open Shortcut if you care about real-time partner events.

## Debug

```ts
import * as Notifications from 'expo-notifications';
const all = await Notifications.getAllScheduledNotificationsAsync();
console.log(all);
```

To wipe all queued local notifications:
```ts
await Notifications.cancelAllScheduledNotificationsAsync();
```

## Summary

- **Free dev gives you ~95% of expected behavior** — every routine, reminder, calendar event, and proximity alert fires natively in the background.
- **Only loss:** server-pushed real-time alerts (partner touches the moment they happen). Workaround: hourly app-open Shortcut or iMessage side channel.
- **No Shortcuts setup needed for the basics.** Optional Shortcuts only if you want richer behavior (TTS, custom sounds, Focus-bypass).
