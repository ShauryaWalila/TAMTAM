import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { db, getPendingSyncs, removeSyncOperation, clearAllData } from './db';

let isSyncing = false;

export const startSyncEngine = () => {
  console.log('Starting Sync Engine...');
  
  // Listen for network changes
  NetInfo.addEventListener(state => {
    console.log('Network State Changed:', state.isConnected ? 'Online' : 'Offline');
    if (state.isConnected && state.isInternetReachable) {
      processSyncQueue();
    }
  });

  // Attempt initial sync on startup if online
  NetInfo.fetch().then(state => {
    if (state.isConnected) {
      processSyncQueue();
    }
  });
};

export const initialFullSync = async (shouldClear = false) => {
  const { isConnected } = await NetInfo.fetch();
  if (!isConnected) return;

  if (shouldClear) {
    clearAllData();
  }

  console.log('Starting lazy initial sync...');

  // Helper to fetch and store a table
  const syncTable = async (tableName: string, query: any, storeFn: (item: any) => void) => {
    try {
      const { data } = await query;
      if (data) data.forEach(storeFn);
      console.log(`Lazy sync: ${tableName} synced.`);
    } catch (e) {
      console.warn(`Lazy sync failed for ${tableName}:`, e);
    }
  };

  // 1. URGENT DATA (Home screen essentials)
  try {
    await syncTable('moments', supabase.from('moments').select('*'), 
      m => db.runSync(`INSERT OR REPLACE INTO moments (id, created_at, message, user_id) VALUES (?, ?, ?, ?)`, [m.id, m.created_at, m.message, m.user_id]));

    await syncTable('meetings', supabase.from('meetings').select('*'), 
      n => db.runSync(`INSERT OR REPLACE INTO meetings (id, created_at, type, date, occasion_name, user_id, weekday, day_of_month, time, is_recurring, frequency, recurring_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [n.id, n.created_at, n.type, n.date, n.occasion_name, n.user_id, n.weekday, n.day_of_month, n.time, n.is_recurring ? 1 : 0, n.frequency, n.recurring_type]));
  } catch (e) {
    console.warn('Urgent sync failed:', e);
  }

  // 2. BACKGROUND DATA (The rest, non-blocking)
  const backgroundSync = async () => {
    try {
      await syncTable('timetable', supabase.from('timetable').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO timetable (id, created_at, day, time, end_time, activity, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.day, n.time, n.end_time, n.activity, n.user_id]));

      await syncTable('calendar_events', supabase.from('calendar_events').select('*'), 
        n => db.runSync(`INSERT OR REPLACE INTO calendar_events (id, created_at, event_date, title, user_id, frequency) VALUES (?, ?, ?, ?, ?, ?)`, 
          [n.id, n.created_at, n.event_date, n.title, n.user_id, n.frequency]));

      await syncTable('posts', supabase.from('posts').select('*').order('created_at', { ascending: false }).limit(50), 
        p => db.runSync(`INSERT OR REPLACE INTO posts (id, created_at, type, content, user_id, reactions, seen_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
          [p.id, p.created_at, p.type, p.content, p.user_id, JSON.stringify(p.reactions), p.seen_by ? p.seen_by.join(',') : '']));

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

      console.log('Background lazy sync complete.');
    } catch (e) {
      console.warn('Background sync failed:', e);
    }
  };

  backgroundSync();
};

export const processSyncQueue = async () => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const pendingOps: any[] = getPendingSyncs();
    if (pendingOps.length === 0) {
      isSyncing = false;
      return;
    }

    console.log(`Processing ${pendingOps.length} pending sync operations...`);

    for (const op of pendingOps) {
      const payload = JSON.parse(op.payload);
      
      try {
        let error;

        if (op.operation === 'UPDATE') {
          const { error: err } = await supabase.from(op.table_name).update(payload).eq('id', op.record_id);
          error = err;
        } else if (op.operation === 'INSERT') {
          // Use upsert to handle existing records and unique constraints
          // For moments, we prefer to conflict on user_id to ensure only one record exists per user
          const options = op.table_name === 'moments' ? { onConflict: 'user_id' } : { onConflict: 'id' };
          const { error: err } = await supabase.from(op.table_name).upsert(payload, options);
          error = err;
        } else if (op.operation === 'DELETE') {
          const { error: err } = await supabase.from(op.table_name).delete().eq('id', op.record_id);
          error = err;
        }

        if (!error) {
          removeSyncOperation(op.id);
          console.log(`Synced ${op.operation} on ${op.table_name} (${op.record_id})`);
        } else {
          console.error(`Failed to sync ${op.id} [${op.table_name}]:`, error.message);
          
          const isUnfixable = 
            error.code === '23505' || // Duplicate key
            error.code === 'PGRST116' || // Not found
            error.code === '22P02' || // Invalid UUID syntax
            error.message?.toLowerCase().includes('invalid input syntax for type uuid') ||
            error.message?.toLowerCase().includes('not found');

          if (isUnfixable) {
            console.log(`Removing unfixable record ${op.id} from queue.`);
            removeSyncOperation(op.id);
          }
        }
      } catch (err) {
        console.error('Network error during sync operation:', err);
        break; 
      }
    }
  } catch (error) {
    console.error('Error processing sync queue:', error);
  } finally {
    isSyncing = false;
  }
};
