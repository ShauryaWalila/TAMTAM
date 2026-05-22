// Cross-session memory for Med Buddy.
//
// `user_memories` is the long-term store the buddy reads from on every
// question. Each row is a distilled fact, preference, or pinned answer.
// `chat_summaries` is one-per-chat topic + bullet takeaways auto-generated
// by Groq when a chat closes or after every N messages.

import { db, generateUUID, queueSyncOperation } from './db';

export type MemoryKind =
  | 'pinned_answer'   // user starred an AI reply
  | 'fact'            // distilled long-term fact
  | 'preference'      // "user prefers visual explanations"
  | 'weak_topic'      // "struggles with renal pharm"
  | 'strong_topic'    // "comfortable with anatomy"
  | 'exam_date'       // "PORTAL on 2026-08-12"
  | 'manual';         // user-typed note

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  source_chat_id?: string | null;
  source_message_id?: string | null;
  user_id?: string | null;
  created_at: string;
}

export const addMemory = (kind: MemoryKind, content: string, userId: string, source?: { chatId?: string; messageId?: string }): string => {
  const id = generateUUID();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO user_memories (id, kind, content, source_chat_id, source_message_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, kind, content, source?.chatId || null, source?.messageId || null, userId, now]
  );
  queueSyncOperation('user_memories', id, 'INSERT', {
    id, kind, content,
    source_chat_id: source?.chatId || null,
    source_message_id: source?.messageId || null,
    user_id: userId, created_at: now,
  });
  return id;
};

export const deleteMemory = (id: string): void => {
  db.runSync(`DELETE FROM user_memories WHERE id = ?`, [id]);
  queueSyncOperation('user_memories', id, 'DELETE', {});
};

export const listMemories = (userId: string, kind?: MemoryKind): Memory[] => {
  const rows = db.getAllSync(
    kind
      ? `SELECT * FROM user_memories WHERE user_id = ? AND kind = ? ORDER BY created_at DESC`
      : `SELECT * FROM user_memories WHERE user_id = ? ORDER BY created_at DESC`,
    kind ? [userId, kind] : [userId]
  ) as Memory[];
  return rows || [];
};

export const upsertChatSummary = (chatId: string, topic: string, takeaways: string[]): void => {
  const now = new Date().toISOString();
  const takeawaysJson = JSON.stringify(takeaways);
  db.runSync(
    `INSERT OR REPLACE INTO chat_summaries (chat_id, topic, takeaways, updated_at) VALUES (?, ?, ?, ?)`,
    [chatId, topic, takeawaysJson, now]
  );
  queueSyncOperation('chat_summaries', chatId, 'INSERT', { chat_id: chatId, topic, takeaways: takeawaysJson, updated_at: now });
};

export const getChatSummary = (chatId: string): { topic: string; takeaways: string[] } | null => {
  const row = db.getFirstSync(`SELECT * FROM chat_summaries WHERE chat_id = ?`, [chatId]) as any;
  if (!row) return null;
  let takeaways: string[] = [];
  try { takeaways = JSON.parse(row.takeaways || '[]'); } catch {}
  return { topic: row.topic || '', takeaways };
};

// Pull buddy settings stored in system_config under known keys.
export const getBuddySettings = () => {
  const read = (key: string, fallback: string) => {
    try {
      const r = db.getFirstSync(`SELECT value FROM system_config WHERE key = ?`, [key]) as any;
      return r?.value ?? fallback;
    } catch { return fallback; }
  };
  return {
    autoSummary: read('study_auto_summary', '1') === '1',
    autoFlashcards: read('study_auto_flashcards', '1') === '1',
    proactiveSuggestions: read('study_proactive', '1') === '1',
    flashcardDeckId: read('study_flashcard_deck_id', ''),
  };
};

export const setBuddySetting = (key: string, value: string): void => {
  const now = new Date().toISOString();
  db.runSync(
    `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`,
    [key, value, now]
  );
  queueSyncOperation('system_config', key, 'UPDATE', { key, value, updated_at: now });
};
