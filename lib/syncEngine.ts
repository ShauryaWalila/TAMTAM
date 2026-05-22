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

  // Periodic check every 60 seconds just in case
  setInterval(() => {
    processSyncQueue();
  }, 60000);
};

export const initialFullSync = async (shouldClear = false) => {
  const { isConnected } = await NetInfo.fetch();
  if (!isConnected) return;

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
      n => db.runSync(`INSERT OR REPLACE INTO timetable (id, created_at, day, time, end_time, activity, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [n.id, n.created_at, n.day, n.time, n.end_time, n.activity, n.user_id]));

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
      await syncTable('finances', supabase.from('finances').select('*').order('created_at', { ascending: false }).limit(50),
        n => db.runSync(`INSERT OR REPLACE INTO finances (id, created_at, amount, category, description, user_id, type) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.amount, n.category, n.description, n.user_id, n.type]));

      await syncTable('targets', supabase.from('targets').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO targets (id, created_at, title, target_amount, current_amount, category, user_id, type, period, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.title, n.target_amount, n.current_amount, n.category, n.user_id, n.type, n.period, n.start_date, n.end_date]));

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
        n => db.runSync(`INSERT OR REPLACE INTO study_routines (id, user_id, title, description, start_time, end_time, date, is_completed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.id, n.user_id, n.title, n.description, n.start_time, n.end_time, n.date, n.is_completed || 0, n.created_at]));

      console.log('Background lazy sync complete.');    } catch (e) {
      console.warn('Background sync failed:', e);
    }
  };

  backgroundSync();
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
