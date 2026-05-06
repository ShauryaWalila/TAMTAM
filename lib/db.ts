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
      PRAGMA foreign_keys = ON;
      
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
        updated_at DATETIME,
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

      -- Phase 4: Study Exams
      CREATE TABLE IF NOT EXISTS study_exams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        exam_date DATE NOT NULL,
        start_date DATE NOT NULL,
        user_id TEXT NOT NULL,
        created_at DATETIME
      );

      -- Phase 4: Study Habit Log (Heatmap)
      CREATE TABLE IF NOT EXISTS study_habit_log (
        id TEXT PRIMARY KEY,
        date DATE UNIQUE,
        completed_tasks INTEGER DEFAULT 0,
        focus_minutes INTEGER DEFAULT 0,
        cards_reviewed INTEGER DEFAULT 0,
        user_id TEXT NOT NULL
      );

      -- Phase 4: Brain Dump Inbox
      CREATE TABLE IF NOT EXISTS study_brain_dump (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        user_id TEXT NOT NULL,
        is_processed INTEGER DEFAULT 0,
        created_at DATETIME
      );

      -- ==========================================
      -- AI OFFLINE QUEUE
      -- ==========================================
      CREATE TABLE IF NOT EXISTS study_ai_queries (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        answer TEXT,
        status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed'
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Phase 4: Focus Sessions
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        subject TEXT,
        duration_minutes INTEGER NOT NULL,
        completed_at DATETIME
      );

      -- Phase 4: Active Study Sessions (Realtime Sync)
      CREATE TABLE IF NOT EXISTS active_study_sessions (
        user_id TEXT PRIMARY KEY,
        start_time DATETIME,
        duration_minutes INTEGER NOT NULL,
        is_paused INTEGER DEFAULT 0,
        time_left INTEGER -- Seconds remaining when paused
      );

      -- Phase 4: Nap Tracker
      CREATE TABLE IF NOT EXISTS study_naps (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        duration_minutes INTEGER,
        created_at DATETIME
      );

      -- Phase 4: Syllabus Tracker
      CREATE TABLE IF NOT EXISTS study_syllabus (
        id TEXT PRIMARY KEY,
        parent_id TEXT, -- Self-reference for nesting
        title TEXT NOT NULL,
        theory_status TEXT DEFAULT 'none', -- 'none', 'touched', 'done', 'revised'
        practical_status TEXT DEFAULT 'none', -- 'none', 'touched', 'done', 'revised'
        theory_last_reviewed DATETIME,
        practical_last_reviewed DATETIME,
        user_id TEXT NOT NULL,
        order_index INTEGER DEFAULT 0,
        created_at DATETIME
      );

      -- Phase 4: Study Routines
      CREATE TABLE IF NOT EXISTS study_routines (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT, -- HH:mm
        end_time TEXT,   -- HH:mm
        date DATE NOT NULL, -- yyyy-MM-dd
        is_completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Phase 5: Dynamic Configuration
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Pre-populate with default key if table just created (optional)
      INSERT OR IGNORE INTO system_config (key, value) VALUES ('groq_api_key', '');

      -- ==========================================
      -- FTS5: ULTRA-FAST LOCAL SEARCH ENGINE
      -- ==========================================
      CREATE VIRTUAL TABLE IF NOT EXISTS study_cards_fts USING fts5(
        id UNINDEXED,
        front_content,
        back_content,
        deck_id UNINDEXED
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS study_brain_dump_fts USING fts5(
        id UNINDEXED,
        content
      );

      -- Triggers to auto-sync FTS tables (study_cards)
      CREATE TRIGGER IF NOT EXISTS study_cards_ai AFTER INSERT ON study_cards BEGIN
        INSERT INTO study_cards_fts(rowid, id, front_content, back_content, deck_id) 
        VALUES (new.rowid, new.id, new.front_content, new.back_content, new.deck_id);
      END;
      
      CREATE TRIGGER IF NOT EXISTS study_cards_au AFTER UPDATE ON study_cards BEGIN
        UPDATE study_cards_fts SET front_content = new.front_content, back_content = new.back_content 
        WHERE id = new.id;
      END;

      CREATE TRIGGER IF NOT EXISTS study_cards_ad AFTER DELETE ON study_cards BEGIN
        DELETE FROM study_cards_fts WHERE id = old.id;
      END;

      -- Triggers to auto-sync FTS tables (study_brain_dump)
      CREATE TRIGGER IF NOT EXISTS study_brain_dump_ai AFTER INSERT ON study_brain_dump BEGIN
        INSERT INTO study_brain_dump_fts(rowid, id, content) VALUES (new.rowid, new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS study_brain_dump_au AFTER UPDATE ON study_brain_dump BEGIN
        UPDATE study_brain_dump_fts SET content = new.content WHERE id = new.id;
      END;

      CREATE TRIGGER IF NOT EXISTS study_brain_dump_ad AFTER DELETE ON study_brain_dump BEGIN
        DELETE FROM study_brain_dump_fts WHERE id = old.id;
      END;

      -- ==========================================
      -- DIET SYSTEM
      -- ==========================================

      -- Diet Metrics (Calories, Protein, etc.)
      CREATE TABLE IF NOT EXISTS diet_metrics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Diet Units (g, ml, serving, etc.)
      CREATE TABLE IF NOT EXISTS diet_units (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Ingredients
      CREATE TABLE IF NOT EXISTS ingredients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT, -- 'Protein', 'Carb', etc.
        nutrients TEXT, -- JSON string: {"metric_id": value}
        base_quantity REAL DEFAULT 100,
        base_unit TEXT DEFAULT 'g',
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Recipes
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        instructions TEXT,
        nutrients TEXT, -- JSON string for manual override
        base_quantity REAL DEFAULT 1,
        base_unit TEXT DEFAULT 'serving',
        user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Recipe Ingredients
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL,
        ingredient_id TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT,
        FOREIGN KEY(recipe_id) REFERENCES recipes(id),
        FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
      );

      -- Diet Settings
      CREATE TABLE IF NOT EXISTS diet_settings (
        id TEXT PRIMARY KEY,
        cycle_length INTEGER DEFAULT 4, -- 1, 2, or 4 week cycles
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO diet_settings (id, cycle_length) VALUES ('global', 4);

      -- Diet Plans (The Routine)
      CREATE TABLE IF NOT EXISTS diet_plans (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        meal_time TEXT, -- 'Breakfast', 'Lunch', 'Dinner', 'Snack'
        type TEXT, -- 'recipe' or 'ingredient'
        item_id TEXT NOT NULL, -- ID of recipe or ingredient
        quantity REAL NOT NULL,
        unit TEXT,
        user_id TEXT,
        is_eaten INTEGER DEFAULT 0,
        is_shared INTEGER DEFAULT 0,
        is_recurring INTEGER DEFAULT 0,
        days_of_week TEXT, -- '0,1,2,3,4,5,6'
        cycle_week INTEGER DEFAULT 0, -- 0=Every Week, 1=Week 1, 2=Week 2, 3=Week 3, 4=Week 4
        template_id TEXT, -- ID of the source template if instantiated
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Diet Goals
      CREATE TABLE IF NOT EXISTS diet_goals (
        id TEXT PRIMARY KEY, -- metric_id:user_id:cycle_week
        metric_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        target_value REAL DEFAULT 0,
        cycle_week INTEGER DEFAULT 0, -- 0=Global/Daily, 1-4=Specific Week
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Trip Songs (Vibe Board)
      CREATE TABLE IF NOT EXISTS trip_songs (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL,
        spotify_id TEXT NOT NULL,
        track_name TEXT,
        artist_name TEXT,
        album_art TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(trip_id, spotify_id)
      );
      `);

      // Initialize default metrics if they don't exist
      try {
      const metrics = [
        { id: 'm1', name: 'Calories', unit: 'kcal' },
        { id: 'm2', name: 'Protein', unit: 'g' },
        { id: 'm3', name: 'Carbs', unit: 'g' },
        { id: 'm4', name: 'Fat', unit: 'g' },
        { id: 'm5', name: 'Fiber', unit: 'g' }
      ];
      metrics.forEach(m => {
        db.runSync(
          'INSERT OR IGNORE INTO diet_metrics (id, name, unit) VALUES (?, ?, ?)',
          [m.id, m.name, m.unit]
        );
      });
      } catch (e) {}

      // Initialize default units
      try {
        const units = ['g', 'ml', 'serving', 'cup', 'oz', 'piece', 'tbsp', 'tsp'];
        units.forEach(u => {
          db.runSync(
            'INSERT OR IGNORE INTO diet_units (id, name) VALUES (?, ?)',
            [u, u]
          );
        });
      } catch (e) {}

      `-- Local Migration: Add missing columns if they don't exist`

    try { db.execSync('ALTER TABLE trip_songs ADD COLUMN album_art TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_syllabus ADD COLUMN theory_status TEXT DEFAULT "none";'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_syllabus ADD COLUMN practical_status TEXT DEFAULT "none";'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_syllabus ADD COLUMN theory_last_reviewed DATETIME;'); } catch(e) {}
    try { db.execSync('ALTER TABLE study_syllabus ADD COLUMN practical_last_reviewed DATETIME;'); } catch(e) {}

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

    // Migration for Journal Posts
    try { db.execSync('ALTER TABLE posts ADD COLUMN updated_at DATETIME;'); } catch(e) {}

    // Migration for Diet System
    try { db.execSync('ALTER TABLE recipes ADD COLUMN nutrients TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE recipes ADD COLUMN base_quantity REAL DEFAULT 1;'); } catch(e) {}
    try { db.execSync('ALTER TABLE recipes ADD COLUMN base_unit TEXT DEFAULT "serving";'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN is_eaten INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN is_shared INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN is_recurring INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN days_of_week TEXT;'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN cycle_week INTEGER DEFAULT 0;'); } catch(e) {}
    try { db.execSync('ALTER TABLE diet_plans ADD COLUMN template_id TEXT;'); } catch(e) {}

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
