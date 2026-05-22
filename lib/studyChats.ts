// Med Buddy chat persistence helpers.
//
// Chats live in two SQLite tables:
//   study_chats           — one row per conversation (id, title, timestamps)
//   study_chat_messages   — one row per message (chat_id FK, sender, text, data)
//
// All operations are local-first (synchronous SQLite). Cross-device sync is
// out-of-scope for now; chats stay on the device that created them.

import { db, generateUUID, queueSyncOperation } from './db';

export interface StoredMessage {
  id: string;
  chat_id: string;
  sender: 'user' | 'ai' | 'system' | 'battle' | 'context';
  text: string;
  data?: any;
  created_at: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_preview: string;
}

export const createChat = (title: string, userId: string): string => {
  const id = generateUUID();
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO study_chats (id, title, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, title || 'New Chat', userId, now, now]
  );
  queueSyncOperation('study_chats', id, 'INSERT', { id, title: title || 'New Chat', user_id: userId, created_at: now, updated_at: now });
  return id;
};

export const renameChat = (chatId: string, newTitle: string): void => {
  const now = new Date().toISOString();
  db.runSync(
    `UPDATE study_chats SET title = ?, updated_at = ? WHERE id = ?`,
    [newTitle, now, chatId]
  );
  queueSyncOperation('study_chats', chatId, 'UPDATE', { title: newTitle, updated_at: now });
};

export const deleteChat = (chatId: string): void => {
  db.runSync(`DELETE FROM study_chats WHERE id = ?`, [chatId]);
  queueSyncOperation('study_chats', chatId, 'DELETE', {});
};

export const listChats = (userId?: string): ChatSummary[] => {
  const rows = db.getAllSync(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM study_chat_messages m WHERE m.chat_id = c.id) AS message_count,
            (SELECT text FROM study_chat_messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_preview
     FROM study_chats c
     ${userId ? 'WHERE c.user_id = ? OR c.user_id IS NULL' : ''}
     ORDER BY c.updated_at DESC`,
    userId ? [userId] : []
  ) as any[];
  return (rows || []).map(r => ({
    id: r.id,
    title: r.title || 'Untitled',
    created_at: r.created_at,
    updated_at: r.updated_at,
    message_count: Number(r.message_count) || 0,
    last_preview: (r.last_preview || '').slice(0, 80),
  }));
};

export const loadMessages = (chatId: string): StoredMessage[] => {
  const rows = db.getAllSync(
    `SELECT * FROM study_chat_messages WHERE chat_id = ? ORDER BY created_at ASC`,
    [chatId]
  ) as any[];
  return (rows || []).map(r => ({
    id: r.id,
    chat_id: r.chat_id,
    sender: r.sender,
    text: r.text,
    data: r.data ? safeParse(r.data) : undefined,
    created_at: r.created_at,
  }));
};

export const appendMessage = (chatId: string, sender: StoredMessage['sender'], text: string, data?: any): string => {
  const id = generateUUID();
  const now = new Date().toISOString();
  const dataJson = data != null ? JSON.stringify(data) : null;
  db.runSync(
    `INSERT INTO study_chat_messages (chat_id, id, sender, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [chatId, id, sender, text, dataJson, now]
  );
  db.runSync(`UPDATE study_chats SET updated_at = ? WHERE id = ?`, [now, chatId]);
  queueSyncOperation('study_chat_messages', id, 'INSERT', { id, chat_id: chatId, sender, text, data: dataJson, created_at: now });
  queueSyncOperation('study_chats', chatId, 'UPDATE', { updated_at: now });
  return id;
};

// Title generated from first user message — first 40 chars, trimmed at word.
export const autoTitleFromFirstUserMessage = (chatId: string): void => {
  const first = db.getFirstSync(
    `SELECT text FROM study_chat_messages WHERE chat_id = ? AND sender = 'user' ORDER BY created_at ASC LIMIT 1`,
    [chatId]
  ) as any;
  if (!first || !first.text) return;
  const current = db.getFirstSync(`SELECT title FROM study_chats WHERE id = ?`, [chatId]) as any;
  if (!current || current.title !== 'New Chat') return;
  let title = String(first.text).trim().slice(0, 60);
  const lastSpace = title.lastIndexOf(' ');
  if (title.length === 60 && lastSpace > 20) title = title.slice(0, lastSpace);
  renameChat(chatId, title || 'New Chat');
};

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return s; }
}
