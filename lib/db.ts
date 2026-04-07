import * as SQLite from 'expo-sqlite';

export const db = SQLite.openDatabaseSync('tamtam_offline.db');

export const generateUUID = () => {
  // Pure JS UUID v4 implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

export const initDB = () => {
  try {
    db.execSync(`
      PRAGMA journal_mode = WAL;
      
      -- Sync Queue Table
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        record_id TEXT NOT NULL,
        operation TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
        payload TEXT NOT NULL,   -- JSON string
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Study Whiteboards Local Cache
      CREATE TABLE IF NOT EXISTS study_whiteboards (
        id TEXT PRIMARY KEY,
        title TEXT,
        deck_id TEXT,
        canvas_data TEXT,
        thumbnail_url TEXT,
        user_id TEXT,
        created_at DATETIME,
        updated_at DATETIME
      );

      -- Posts (Journal & Draw)
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        type TEXT,
        content TEXT,
        user_id TEXT,
        reactions TEXT,
        seen_by TEXT
      );

      -- Moments (Home)
      CREATE TABLE IF NOT EXISTS moments (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        message TEXT,
        user_id TEXT
      );

      -- Tasks (Home)
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        title TEXT,
        description TEXT,
        is_completed INTEGER DEFAULT 0,
        due_date DATETIME,
        category TEXT
      );

      -- Timetable (Home)
      CREATE TABLE IF NOT EXISTS timetable (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        day TEXT,
        time TEXT,
        end_time TEXT,
        activity TEXT,
        user_id TEXT
      );

      -- Meetings (Home)
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        type TEXT,
        date DATE,
        recurring_type TEXT,
        occasion_name TEXT,
        user_id TEXT,
        weekday TEXT,
        day_of_month INTEGER,
        time TEXT,
        is_recurring INTEGER,
        frequency TEXT
      );

      -- Targets (Home/Finance)
      CREATE TABLE IF NOT EXISTS targets (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        title TEXT,
        target_amount REAL,
        current_amount REAL,
        category TEXT,
        user_id TEXT,
        type TEXT,
        period TEXT,
        start_date DATE,
        end_date DATE
      );

      -- Calendar Events (Home)
      CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        event_date DATE,
        title TEXT,
        user_id TEXT,
        frequency TEXT
      );

      -- Finances
      CREATE TABLE IF NOT EXISTS finances (
        id TEXT PRIMARY KEY,
        created_at DATETIME,
        amount REAL,
        category TEXT,
        description TEXT,
        user_id TEXT,
        type TEXT
      );

      -- Study Decks
      CREATE TABLE IF NOT EXISTS study_decks (
        id TEXT PRIMARY KEY,
        title TEXT,
        description TEXT,
        color TEXT,
        user_id TEXT,
        created_at DATETIME
      );

      -- Study Cards
      CREATE TABLE IF NOT EXISTS study_cards (
        id TEXT PRIMARY KEY,
        deck_id TEXT,
        front_content TEXT,
        back_content TEXT,
        front_image_url TEXT,
        back_image_url TEXT,
        options TEXT,
        custom_color TEXT,
        difficulty TEXT,
        correct_count INTEGER DEFAULT 0,
        incorrect_count INTEGER DEFAULT 0,
        skip_count INTEGER DEFAULT 0,
        last_result TEXT, -- 'correct', 'incorrect', 'skip'
        next_review DATETIME,
        interval_days INTEGER DEFAULT 0,
        ease_factor REAL DEFAULT 2.5,
        review_count INTEGER DEFAULT 0,
        created_at DATETIME
      );

      -- Chill Categories
      CREATE TABLE IF NOT EXISTS chill_categories (
        id TEXT PRIMARY KEY,
        name TEXT,
        icon TEXT,
        color TEXT,
        bg_color TEXT,
        image_url TEXT,
        created_at DATETIME
      );

      -- Chill Items
      CREATE TABLE IF NOT EXISTS chill_items (
        id TEXT PRIMARY KEY,
        category_id TEXT,
        type TEXT,
        title TEXT,
        content TEXT,
        bg_color TEXT,
        created_by TEXT,
        created_at DATETIME
      );
    `);

    // Local Migration: Add missing columns to study_cards if they don't exist
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN front_image_url TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN back_image_url TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN options TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN custom_color TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN difficulty TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN correct_count INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN incorrect_count INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN skip_count INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_cards ADD COLUMN last_result TEXT;'); } catch(e) {}

    console.log('Local SQLite DB initialized.');
  } catch (error) {
    console.error('Failed to initialize local DB', error);
  }
};

// Queue helper functions
export const queueSyncOperation = (tableName: string, recordId: string, operation: 'INSERT' | 'UPDATE' | 'DELETE', payload: any) => {
  try {
    const id = Math.random().toString(36).substring(2, 15);
    db.runSync(
      `INSERT INTO sync_queue (id, table_name, record_id, operation, payload) VALUES (?, ?, ?, ?, ?)`,
      [id, tableName, recordId, operation, JSON.stringify(payload)]
    );
  } catch (error) {
    console.error('Failed to queue sync operation', error);
  }
};

export const getPendingSyncs = () => {
  return db.getAllSync(`SELECT * FROM sync_queue ORDER BY created_at ASC`);
};

export const removeSyncOperation = (id: string) => {
  db.runSync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
};

export const clearAllData = () => {
  try {
    const tables = [
      'moments', 'meetings', 'timetable', 'calendar_events', 
      'posts', 'finances', 'targets', 'study_decks', 
      'study_whiteboards', 'chill_categories', 'chill_items', 'study_cards'
    ];
    db.withTransactionSync(() => {
      tables.forEach(table => {
        db.runSync(`DELETE FROM ${table}`);
      });
      db.runSync(`DELETE FROM sync_queue`);
    });
    console.log('All local data cleared.');
  } catch (error) {
    console.error('Failed to clear local data', error);
  }
};
