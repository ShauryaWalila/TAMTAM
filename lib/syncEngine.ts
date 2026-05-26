import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { db, getPendingSyncs, removeSyncOperation, clearAllData, isTombstoned } from './db';
import { processPendingAIQueries } from './aiEngine';
import * as SecureStore from 'expo-secure-store';

let isSyncing = false;

/**
 * HYBRID SYNC ENGINE
 * Automatically detects internet connection and flushes the SQLite queue to Supabase.
 */
export const startSyncEngine = () => {
  console.log('🔄 Sync Engine Started...');

  // Watch for connection changes
  NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable) {
      console.log('🌐 Internet Restored! Flushing Queue...');
      processSyncQueue();
    }
  });

  // Outbound queue flush every 60s.
  setInterval(() => {
    processSyncQueue();
  }, 60000);

  // ── Inbound 60s fallback pull ──
  // Global realtime is the primary path for partner-side updates. This tick
  // is a belt-and-suspenders backup for:
  //   * brief realtime drops (channel re-subscribing)
  //   * the day you hit Supabase free-tier realtime caps
  //   * iOS aggressively backgrounding the WebSocket
  // initialFullSync is idempotent (INSERT OR REPLACE everywhere) so calling
  // it repeatedly is safe.
  setInterval(() => {
    initialFullSync(false).catch(() => {});
  }, 60000);
};

// Track whether we've done at least one successful pull. If not, the NetInfo
// listener keeps retrying when the network state flips.
let initialFullSyncDone = false;
let initialFullSyncRetryTimer: any = null;

NetInfo.addEventListener((state) => {
  if (state.isConnected && !initialFullSyncDone) {
    // Network just came online and we never finished a sync. Trigger one.
    initialFullSync(false).catch(() => {});
  }
});

export const initialFullSync = async (shouldClear = false) => {
  const { isConnected } = await NetInfo.fetch();
  if (!isConnected) {
    // Schedule a single retry in 6s in case NetInfo lied on first launch.
    if (!initialFullSyncRetryTimer) {
      initialFullSyncRetryTimer = setTimeout(() => {
        initialFullSyncRetryTimer = null;
        initialFullSync(shouldClear).catch(() => {});
      }, 6000);
    }
    return;
  }

  if (shouldClear) {
    clearAllData();
  }

  console.log('Starting lazy initial sync...');

  // Helper to fetch and store a table. Skips records whose id has a pending
  // local DELETE in the sync queue (tombstoned) so deleted rows don't get
  // resurrected by a remote refetch before our DELETE reaches the server.
  const syncTable = async (
    tableName: string,
    query: any,
    storeFn: (item: any) => void,
    keyField: string = 'id'
  ) => {
    try {
      const { data } = await query;
      if (data) {
        for (const item of data) {
          const id = item?.[keyField];
          if (id && isTombstoned(tableName, String(id))) continue;
          storeFn(item);
        }
      }
      console.log(`Lazy sync: ${tableName} synced.`);
    } catch (e) {
      console.warn(`Lazy sync failed for ${tableName}:`, e);
    }
  };

  // 1. URGENT DATA (Home / index dashboard reads from these tables, so we
  //    block until they're populated. Anything the index doesn't render goes
  //    into the background bucket below.)
  try {
    await syncTable('moments', supabase.from('moments').select('*'),
      m => db.runSync(`INSERT OR REPLACE INTO moments (id, created_at, message, user_id) VALUES (?, ?, ?, ?)`, [m.id, m.created_at, m.message, m.user_id]));

    await syncTable('meetings', supabase.from('meetings').select('*'),
      n => db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency, recurring_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.id, n.created_at, n.type, n.date, n.occasion_name, n.user_id, n.weekday, n.day_of_month, n.time, n.is_recurring ? 1 : 0, n.frequency, n.recurring_type]));

    await syncTable('timetable', supabase.from('timetable').select('*'),
      n => db.runSync(`INSERT OR REPLACE INTO timetable (id, created_at, day, time, end_time, activity, user_id, for_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.id, n.created_at, n.day, n.time, n.end_time, n.activity, n.user_id, n.for_user || null]));

    await syncTable('calendar_events', supabase.from('calendar_events').select('*'),
      n => db.runSync(`INSERT OR REPLACE INTO calendar_events (id, created_at, event_date, title, user_id, frequency) VALUES (?, ?, ?, ?, ?, ?)`,
        [n.id, n.created_at, n.event_date, n.title, n.user_id, n.frequency]));

    await syncTable('posts', supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(50),
      p => db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, updated_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.created_at, p.updated_at || p.created_at, p.type, p.content, p.user_id, JSON.stringify(p.reactions), p.seen_by ? p.seen_by.join(',') : '']));
  } catch (e) {
    console.warn('Urgent sync failed:', e);
  }

  // 2. BACKGROUND DATA (The rest, non-blocking)
  const backgroundSync = async () => {
    try {
      await syncTable('finances', supabase.from('finances').select('*').order('created_at', { ascending: false }).limit(200),
        n => db.runSync(`INSERT OR REPLACE INTO finances (id, created_at, amount, category, description, user_id, type, transaction_date, source, bank_ref, trip_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.created_at, n.amount, n.category, n.description, n.user_id, n.type, n.transaction_date, n.source, n.bank_ref, n.trip_id]));

      // SMS inbox — raw rows pushed by the universal Shortcut. Parser runs
      // against unprocessed rows after sync completes.
      await syncTable('sms_inbox', supabase.from('sms_inbox').select('*').order('received_at', { ascending: false }).limit(500),
        n => db.runSync(`INSERT OR REPLACE INTO sms_inbox (id, user_id, sender, body, body_hash, received_at, processed_at, decision, confidence, parsed_amount, parsed_direction, parsed_merchant, parsed_category, matched_txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.sender, n.body, n.body_hash, n.received_at, n.processed_at, n.decision, n.confidence, n.parsed_amount, n.parsed_direction, n.parsed_merchant, n.parsed_category, n.matched_txn_id, n.created_at]));

      // Per-user sender blocklist (#8).
      await syncTable('sms_sender_blocklist', supabase.from('sms_sender_blocklist').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO sms_sender_blocklist (id, user_id, sender_prefix, original_sender, created_at) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.sender_prefix, n.original_sender, n.created_at]));

      await syncTable('targets', supabase.from('targets').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO targets (id, created_at, title, target_amount, current_amount, category, user_id, type, period, start_date, end_date, kind, threshold_pct, notified_at, notify_on_warn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.created_at, n.title, n.target_amount, n.current_amount, n.category, n.user_id, n.type, n.period, n.start_date, n.end_date, n.kind, n.threshold_pct, n.notified_at, n.notify_on_warn ? 1 : 0]));

      await syncTable('study_decks', supabase.from('study_decks').select('*'), 
        d => db.runSync(`INSERT OR REPLACE INTO study_decks (id, title, description, color, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
          [d.id, d.title, d.description, d.color, d.user_id, d.created_at]));

      await syncTable('study_cards', supabase.from('study_cards').select('*'), 
        c => db.runSync(`INSERT OR REPLACE INTO study_cards (id, deck_id, front_content, back_content, front_image_url, back_image_url, options, custom_color, difficulty, correct_count, incorrect_count, skip_count, next_review, interval_days, ease_factor, review_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [c.id, c.deck_id, c.front_content, c.back_content, c.front_image_url, c.back_image_url, JSON.stringify(c.options || []), c.custom_color, c.difficulty, c.correct_count, c.incorrect_count, c.skip_count, c.next_review, c.interval_days, c.ease_factor, c.review_count, c.created_at]));

      await syncTable('study_whiteboards', supabase.from('study_whiteboards').select('*'), 
        b => db.runSync(`INSERT OR REPLACE INTO study_whiteboards (id, title, deck_id, canvas_data, thumbnail_url, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
          [b.id, b.title, b.deck_id, typeof b.canvas_data === 'string' ? b.canvas_data : JSON.stringify(b.canvas_data), b.thumbnail_url, b.user_id, b.created_at, b.updated_at]));

      await syncTable('chill_categories', supabase.from('chill_categories').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO chill_categories (id, name, icon, color, bg_color, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.name, n.icon, n.color, n.bg_color, n.image_url, n.created_at]));

      await syncTable('chill_items', supabase.from('chill_items').select('*').order('created_at', { ascending: false }).limit(50), 
        n => db.runSync(`INSERT OR REPLACE INTO chill_items (id, category_id, type, title, content, bg_color, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.category_id, n.type, n.title, JSON.stringify(n.content), n.bg_color, n.created_by, n.created_at]));

      await syncTable('study_exams', supabase.from('study_exams').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO study_exams (id, title, exam_date, start_date, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
          [n.id, n.title, n.exam_date, n.start_date, n.user_id, n.created_at]));

      await syncTable('study_habit_log', supabase.from('study_habit_log').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO study_habit_log (id, date, completed_tasks, focus_minutes, cards_reviewed, user_id) VALUES (?, ?, ?, ?, ?, ?)`, 
          [n.id, n.date, n.completed_tasks, n.focus_minutes, n.cards_reviewed, n.user_id]));

      await syncTable('study_brain_dump', supabase.from('study_brain_dump').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO study_brain_dump (id, content, user_id, is_processed, created_at) VALUES (?, ?, ?, ?, ?)`, 
          [n.id, n.content, n.user_id, n.is_processed, n.created_at]));

      await syncTable('focus_sessions', supabase.from('focus_sessions').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO focus_sessions (id, user_id, subject, duration_minutes, completed_at) VALUES (?, ?, ?, ?, ?)`, 
          [n.id, n.user_id, n.subject, n.duration_minutes, n.completed_at]));

      await syncTable('active_study_sessions', supabase.from('active_study_sessions').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO active_study_sessions (user_id, start_time, duration_minutes) VALUES (?, ?, ?)`, 
          [n.user_id, n.start_time, n.duration_minutes]));

      await syncTable('study_syllabus', supabase.from('study_syllabus').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO study_syllabus (id, parent_id, title, theory_status, practical_status, theory_last_reviewed, practical_last_reviewed, user_id, order_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.parent_id, n.title, n.theory_status, n.practical_status, n.theory_last_reviewed, n.practical_last_reviewed, n.user_id, n.order_index, n.created_at]));

      await syncTable('trip_songs', supabase.from('trip_songs').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO trip_songs (id, trip_id, spotify_id, track_name, artist_name, album_art, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.trip_id, n.spotify_id, n.track_name, n.artist_name, n.album_art, n.created_at]));

      // system_config: API keys / client IDs (groq, spotify, etc.) live here.
      // Pull on boot so device picks up changes the other partner made.
      await syncTable('system_config', supabase.from('system_config').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
          [n.key, n.value, n.updated_at || new Date().toISOString()]), 'key');

      // Med Buddy chats — pulled so user resumes on every device.
      await syncTable('study_chats', supabase.from('study_chats').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO study_chats (id, title, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.title, n.user_id, n.created_at, n.updated_at]));

      await syncTable('study_chat_messages', supabase.from('study_chat_messages').select('*').order('created_at', { ascending: true }),
        n => db.runSync(`INSERT OR REPLACE INTO study_chat_messages (id, chat_id, sender, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [n.id, n.chat_id, n.sender, n.text, typeof n.data === 'string' ? n.data : (n.data ? JSON.stringify(n.data) : null), n.created_at]));

      await syncTable('user_memories', supabase.from('user_memories').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO user_memories (id, kind, content, source_chat_id, source_message_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.kind, n.content, n.source_chat_id, n.source_message_id, n.user_id, n.created_at]));

      await syncTable('chat_summaries', supabase.from('chat_summaries').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO chat_summaries (chat_id, topic, takeaways, updated_at) VALUES (?, ?, ?, ?)`,
          [n.chat_id, n.topic, typeof n.takeaways === 'string' ? n.takeaways : JSON.stringify(n.takeaways || []), n.updated_at]), 'chat_id');

      await syncTable('anatomy_library', supabase.from('anatomy_library').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO anatomy_library (id, title, system, url, kind, license, local_path, is_offline, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.title, n.system, n.url, n.kind, n.license, n.local_path, n.is_offline ? 1 : 0, n.created_at]));

      await syncTable('partner_locations', supabase.from('partner_locations').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO partner_locations (user_id, latitude, longitude, accuracy, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [n.user_id, n.latitude, n.longitude, n.accuracy, n.updated_at]), 'user_id');

      await syncTable('user_finance_rules', supabase.from('user_finance_rules').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO user_finance_rules (id, user_id, pattern, category, is_regex, hit_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.pattern, n.category, n.is_regex ? 1 : 0, n.hit_count, n.created_at]));

      await syncTable('monthly_snapshots', supabase.from('monthly_snapshots').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO monthly_snapshots (user_id, ym, total_expense, total_income, close_balance, txn_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [n.user_id, n.ym, n.total_expense, n.total_income, n.close_balance, n.txn_count, n.created_at]), 'ym');

      await syncTable('gift_jar', supabase.from('gift_jar').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO gift_jar (id, captured_by, for_partner, text, source, source_ref, is_given, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.captured_by, n.for_partner, n.text, n.source, n.source_ref, n.is_given ? 1 : 0, n.captured_at]));

      // DIET SYSTEM SYNC
      await syncTable('diet_settings', supabase.from('diet_settings').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO diet_settings (id, cycle_length, updated_at) VALUES (?, ?, ?)`,
          [n.id, n.cycle_length, n.updated_at]));

      await syncTable('diet_metrics', supabase.from('diet_metrics').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO diet_metrics (id, name, unit, is_active, created_at) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.name, n.unit, n.is_active ? 1 : 0, n.created_at]));

      await syncTable('diet_units', supabase.from('diet_units').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO diet_units (id, name, created_at) VALUES (?, ?, ?)`,
          [n.id, n.name, n.created_at]));

      await syncTable('ingredients', supabase.from('ingredients').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO ingredients (id, name, category, nutrients, base_quantity, base_unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.name, n.category, typeof n.nutrients === 'string' ? n.nutrients : JSON.stringify(n.nutrients), n.base_quantity, n.base_unit, n.user_id, n.created_at]));

      await syncTable('recipes', supabase.from('recipes').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO recipes (id, name, description, instructions, nutrients, base_quantity, base_unit, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.name, n.description, n.instructions, n.nutrients, n.base_quantity || 1, n.base_unit || 'serving', n.user_id, n.created_at]));

      await syncTable('recipe_ingredients', supabase.from('recipe_ingredients').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO recipe_ingredients (id, recipe_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.recipe_id, n.ingredient_id, n.quantity, n.unit]));

      await syncTable('diet_plans', supabase.from('diet_plans').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO diet_plans (id, date, meal_time, type, item_id, quantity, unit, user_id, is_eaten, is_shared, is_recurring, days_of_week, cycle_week, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.date, n.meal_time, n.type, n.item_id, n.quantity, n.unit, n.user_id, n.is_eaten || 0, n.is_shared || 0, n.is_recurring || 0, n.days_of_week || '0,1,2,3,4,5,6', n.cycle_week || 0, n.created_at]));

      await syncTable('study_routines', supabase.from('study_routines').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO study_routines (id, user_id, title, description, start_time, end_time, date, is_completed, for_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.title, n.description, n.start_time, n.end_time, n.date, n.is_completed || 0, n.for_user || null, n.created_at]));

      // ── Tables previously relying on per-screen realtime only — now in fallback pull too.
      await syncTable('tasks', supabase.from('tasks').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO tasks (id, created_at, title, description, is_completed, due_date, category) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.created_at, n.title, n.description, n.is_completed ? 1 : 0, n.due_date, n.category]));

      await syncTable('anniversaries', supabase.from('anniversaries').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO anniversaries (id, created_at, name, date, created_by) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.created_at, n.name, n.date, n.created_by]));

      await syncTable('study_naps', supabase.from('study_naps').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO study_naps (id, user_id, start_time, end_time, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.start_time, n.end_time, n.duration_minutes, n.created_at]));

      await syncTable('diet_goals', supabase.from('diet_goals').select('*'),
        n => db.runSync(`INSERT OR REPLACE INTO diet_goals (id, user_id, metric_name, daily_target, created_at) VALUES (?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.metric_name, n.daily_target, n.created_at]));

      // user_balances: no local cache table — finance.tsx reads directly from
      // Supabase via fetchBalances(). Global realtime upsert will no-op
      // silently for it. Adding it to the explicit pull would just throw.

      console.log('Background lazy sync complete.');
      initialFullSyncDone = true;
      // Let anyone listening know data is fresh — Study Hub, Journal, etc.
      try {
        const RN = require('react-native');
        RN?.DeviceEventEmitter?.emit?.('DATA_REFRESH');
        RN?.DeviceEventEmitter?.emit?.('refresh-dashboard');
      } catch {}
    } catch (e) {
      console.warn('Background sync failed:', e);
    }
  };

  backgroundSync();
};

// ── GLOBAL REALTIME ─────────────────────────────────────────────────────────
// One Supabase channel that listens to ALL INSERT / UPDATE / DELETE on every
// table in the public schema. Each event upserts (or deletes) the row in the
// local SQLite mirror, then emits DATA_REFRESH so any screen on top re-fetches.
//
// Setup requirements:
//   1. The Postgres table must be in `supabase_realtime` publication.
//      See setup-and-build.md / one-shot-rls-and-realtime.sql.
//   2. RLS policy must allow `anon` SELECT on the table (already enabled
//      across TAMTAM by the open-RLS pattern).
//
// Edge handling:
//   * If a row references a column that doesn't exist locally yet, the
//     dynamic upsert silently drops keys whose binding fails. Worst case the
//     row appears on next `initialFullSync`.
//   * If the row's id is tombstoned (pending local DELETE), the event is
//     ignored so we don't resurrect a row mid-sync.

let realtimeChannelRef: any = null;

function dynamicUpsertRow(table: string, row: any) {
  if (!row || typeof row !== 'object') return;
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === true) cleaned[k] = 1;
    else if (v === false) cleaned[k] = 0;
    else if (v === undefined) continue;
    else cleaned[k] = v;
  }
  const cols = Object.keys(cleaned);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  try {
    db.runSync(sql, cols.map(c => cleaned[c]));
  } catch (e) {
    // Likely: local table is missing a column the server has. Don't crash —
    // just log; next initialFullSync handles via the explicit storeFn.
    console.warn(`realtime upsert skipped (${table}):`, (e as Error).message);
  }
}

export const setupGlobalRealtime = () => {
  // Idempotent — kill any previous channel before re-subscribing (hot reload safe).
  try { if (realtimeChannelRef) supabase.removeChannel(realtimeChannelRef); } catch {}

  realtimeChannelRef = supabase
    .channel('tamtam-global-realtime')
    .on(
      'postgres_changes' as any,
      { event: '*', schema: 'public' } as any,
      (payload: any) => {
        try {
          const table: string = payload.table;
          const evt: string = payload.eventType;
          if (!table) return;

          if (evt === 'DELETE') {
            const oldId = payload.old?.id;
            if (!oldId) return;
            try { db.runSync(`DELETE FROM ${table} WHERE id = ?`, [oldId]); } catch {}
          } else {
            const row = payload.new;
            if (!row) return;
            const rid = row.id ? String(row.id) : null;
            // Skip if this row is locally tombstoned (we deleted it but the
            // delete hasn't reached the server yet).
            if (rid && isTombstoned(table, rid)) return;
            dynamicUpsertRow(table, row);
          }

          // Notify screens to re-fetch — debounced naturally by the rapid-fire
          // nature of realtime events. Listeners use this to call their
          // own fetchFromSQLite() routines.
          try {
            const RN = require('react-native');
            RN?.DeviceEventEmitter?.emit?.('DATA_REFRESH', { table, eventType: evt });
            RN?.DeviceEventEmitter?.emit?.('refresh-dashboard');
          } catch {}
        } catch (err) {
          console.warn('Global realtime handler failed:', err);
        }
      }
    )
    .subscribe((status: string) => {
      console.log('Global realtime status:', status);
    });
};

// Public manual-pull entry point — call from any screen's <RefreshControl
// onRefresh={...}>. Returns a Promise so the spinner can wait.
export const refreshAllNow = async () => {
  try { await processSyncQueue(); } catch {}
  try { await initialFullSync(false); } catch {}
  try {
    const RN = require('react-native');
    RN?.DeviceEventEmitter?.emit?.('DATA_REFRESH', { table: '*', eventType: 'MANUAL' });
  } catch {}
};

export const teardownGlobalRealtime = () => {
  try { if (realtimeChannelRef) supabase.removeChannel(realtimeChannelRef); } catch {}
  realtimeChannelRef = null;
};

export const processSyncQueue = async () => {
  if (isSyncing) return;
  
  const state = await NetInfo.fetch();
  if (!state.isConnected) return;

  // 🤖 Process Pending AI Questions first
  const user = await SecureStore.getItemAsync('user_name');
  if (user) await processPendingAIQueries(user.toLowerCase());

  const pending = getPendingSyncs();
  if (pending.length === 0) return;

  isSyncing = true;
  console.log(`📤 Syncing ${pending.length} operations...`);

  // Group operations to handle them better? For now, just robust single processing
  for (const op of pending) {
    try {
      const payload = JSON.parse(op.payload);
      let error;

      if (op.operation === 'INSERT') {
        const options = op.table_name === 'moments' ? { onConflict: 'user_id' } : { onConflict: 'id' };
        ({ error } = await supabase.from(op.table_name).upsert(payload, options));
      } else if (op.operation === 'UPDATE') {
        ({ error } = await supabase.from(op.table_name).update(payload).eq('id', op.record_id));
      } else if (op.operation === 'DELETE') {
        ({ error } = await supabase.from(op.table_name).delete().eq('id', op.record_id));
      }

      if (!error) {
        removeSyncOperation(op.id);
      } else {
        // If it's a foreign key error (23503), the parent hasn't synced yet.
        // We'll leave it in the queue to try again in the next loop.
        if (error.code === '23503') {
          console.warn(`⏳ Waiting for parent record to sync for ${op.table_name}...`);
          continue; 
        }

        console.error(`❌ Sync failed for ${op.table_name}:`, error.message);
        // If it's a permanent conflict error, remove it to unblock
        if (error.code === '23505' || error.code === 'PGRST116') removeSyncOperation(op.id);
      }
    } catch (err: any) {
      // Handle "Network request failed" or other fetch errors
      if (err.message === 'Network request failed') {
        console.log('📶 Sync paused: Network connection unstable.');
        break; 
      }
      console.error('Unexpected error during sync:', err);
    }
  }
  isSyncing = false;
};
