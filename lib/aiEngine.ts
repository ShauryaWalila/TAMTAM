import { db, generateUUID, queueSyncOperation } from "./db";
import { format, subDays } from "date-fns";
import { supabase } from "./supabase";
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

// 🛡️ CONFIGURATION
const getGroqKey = () => {
  try {
    const row = db.getFirstSync(`SELECT value FROM system_config WHERE key = 'groq_api_key'`) as any;
    if (row && row.value && row.value.trim().length > 0) return row.value.trim();
  } catch (e) {}
  return '';
};

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * HYBRID RAG ENGINE: Combines Offline FTS5 (Keyword) and Online Supabase pgvector (Semantic)
 */
export const getHybridContext = async (userPrompt: string, userId: string) => {
  const keywords = userPrompt.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(" ").filter(w => w.length > 3);
  if (keywords.length === 0) return "";
  let contextParts: string[] = [];

  // 1. Flashcards via FTS5 (fast offline keyword)
  try {
    const ftsQuery = keywords.join(' OR ');
    const localMatches = db.getAllSync(
      `SELECT f.front_content, f.back_content FROM study_cards_fts f
       JOIN study_decks d ON f.deck_id = d.id
       WHERE d.user_id = ? AND study_cards_fts MATCH ?
       ORDER BY rank LIMIT 2`,
      [userId, ftsQuery]
    ) as any[];
    if (localMatches.length > 0) {
      contextParts.push("[FLASHCARD MATCHES]: " + localMatches.map(c => `Q: ${c.front_content} A: ${c.back_content}`).join(" | "));
    }
  } catch {}

  // 2. Whiteboard canvas notes — LIKE search over title + canvas_data text.
  try {
    const likeClauses = keywords.map(() => `(LOWER(title) LIKE ? OR LOWER(canvas_data) LIKE ?)`).join(' OR ');
    const params: any[] = [];
    keywords.forEach(k => { params.push(`%${k}%`, `%${k}%`); });
    const boards = db.getAllSync(
      `SELECT title, canvas_data FROM study_whiteboards
       WHERE user_id = ? AND (${likeClauses}) LIMIT 2`,
      [userId, ...params]
    ) as any[];
    if (boards.length > 0) {
      contextParts.push("[WHITEBOARD NOTES]: " + boards.map((b: any) => {
        const text = String(b.canvas_data || '').replace(/\s+/g, ' ').slice(0, 280);
        return `${b.title}: ${text}`;
      }).join(" | "));
    }
  } catch {}

  // 3. Brain dump notes
  try {
    const likeClauses = keywords.map(() => `LOWER(content) LIKE ?`).join(' OR ');
    const params: any[] = keywords.map(k => `%${k}%`);
    const dumps = db.getAllSync(
      `SELECT content FROM study_brain_dump
       WHERE user_id = ? AND (${likeClauses})
       ORDER BY created_at DESC LIMIT 3`,
      [userId, ...params]
    ) as any[];
    if (dumps.length > 0) {
      contextParts.push("[BRAIN DUMP]: " + dumps.map((d: any) => String(d.content || '').slice(0, 200)).join(" | "));
    }
  } catch {}

  // 4. Past chats — FTS5 first (ranked), fall back to LIKE if FTS empty.
  try {
    const ftsQuery = keywords.join(' OR ');
    let past = db.getAllSync(
      `SELECT m.sender, m.text, c.title FROM study_chat_messages_fts f
       JOIN study_chat_messages m ON m.rowid = f.rowid
       JOIN study_chats c ON c.id = m.chat_id
       WHERE study_chat_messages_fts MATCH ? AND m.sender IN ('user','ai')
       ORDER BY rank LIMIT 5`,
      [ftsQuery]
    ) as any[];
    if (!past || past.length === 0) {
      const likeClauses = keywords.map(() => `LOWER(m.text) LIKE ?`).join(' OR ');
      const params: any[] = keywords.map(k => `%${k}%`);
      past = db.getAllSync(
        `SELECT m.sender, m.text, c.title FROM study_chat_messages m
         JOIN study_chats c ON c.id = m.chat_id
         WHERE m.sender IN ('user','ai') AND (${likeClauses})
         ORDER BY m.created_at DESC LIMIT 4`,
        params
      ) as any[];
    }
    if (past.length > 0) {
      contextParts.push("[PAST CHATS]: " + past.map((p: any) => `(${p.title} • ${p.sender}) ${String(p.text || '').slice(0, 180)}`).join(" | "));
    }
  } catch {}

  // 4b. User memories — pinned answers, weak/strong topics, manual notes,
  // exam dates. These are HIGH-PRIORITY — the buddy should weight them.
  try {
    const memRows = db.getAllSync(
      `SELECT kind, content FROM user_memories WHERE user_id = ? ORDER BY
         CASE kind
           WHEN 'pinned_answer' THEN 1
           WHEN 'exam_date' THEN 2
           WHEN 'weak_topic' THEN 3
           WHEN 'preference' THEN 4
           ELSE 5
         END,
         created_at DESC
       LIMIT 8`,
      [userId]
    ) as any[];
    if (memRows.length > 0) {
      contextParts.push("[USER MEMORY]: " + memRows.map((m: any) => `<${m.kind}> ${String(m.content || '').slice(0, 220)}`).join(" | "));
    }
  } catch {}

  // 4c. Syllabus awareness — which topics matching the prompt are pending vs done.
  try {
    const likeClauses = keywords.map(() => `LOWER(title) LIKE ?`).join(' OR ');
    const params: any[] = keywords.map(k => `%${k}%`);
    const syl = db.getAllSync(
      `SELECT title, theory_status, practical_status FROM study_syllabus
       WHERE user_id = ? AND (${likeClauses}) LIMIT 5`,
      [userId, ...params]
    ) as any[];
    if (syl.length > 0) {
      contextParts.push("[SYLLABUS STATUS]: " + syl.map((s: any) => `${s.title} (theory=${s.theory_status || 'pending'}, prac=${s.practical_status || 'pending'})`).join(" | "));
    }
  } catch {}

  // 4d. Exam urgency — how many days to nearest exam, so the buddy can prioritise.
  try {
    const exam = db.getFirstSync(
      `SELECT title, exam_date FROM study_exams WHERE user_id = ? AND exam_date >= date('now') ORDER BY exam_date ASC LIMIT 1`,
      [userId]
    ) as any;
    if (exam) {
      const days = Math.max(0, Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / 86400000));
      contextParts.push(`[EXAM URGENCY]: "${exam.title}" in ${days} days (${exam.exam_date})`);
    }
  } catch {}

  // 4e. Anatomy reference — relevant images/models the buddy can point to.
  try {
    const likeClauses = keywords.map(() => `(LOWER(title) LIKE ? OR LOWER(system) LIKE ?)`).join(' OR ');
    const params: any[] = [];
    keywords.forEach(k => { params.push(`%${k}%`, `%${k}%`); });
    const refs = db.getAllSync(
      `SELECT title, system, url, kind FROM anatomy_library WHERE ${likeClauses} LIMIT 4`,
      params
    ) as any[];
    if (refs.length > 0) {
      contextParts.push("[ANATOMY LIBRARY]: " + refs.map((r: any) => `${r.title} (${r.system}, ${r.kind}) — ${r.url}`).join(" | "));
    }
  } catch {}

  // 5. Online semantic — only adds if connected. Cheap to skip on failure.
  try {
    const { data: { embedding }, error } = await supabase.functions.invoke('embed', { body: { text: userPrompt } });
    if (!error && embedding) {
      const { data: matches } = await supabase.rpc('match_study_cards', { query_embedding: embedding, match_threshold: 0.5, match_count: 2 });
      if (matches?.length > 0) {
        contextParts.push("[SEMANTIC FLASHCARD MATCHES]: " + matches.map((m: any) => `Q: ${m.front_content} A: ${m.back_content}`).join(" | "));
      }
    }
  } catch {}

  return contextParts.length > 0 ? "\n" + contextParts.join("\n") : "";
};

const callGroq = async (model: string, messages: any[], temperature = 0.6) => {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error("Groq API Key not found. Set it in Settings.");

  const response = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Groq API Error");
  return data.choices[0].message.content;
};

// 1. VOICE TRANSCRIPTION (STT)
export const transcribeAudio = async (uri: string) => {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error("API Key Missing");
  try {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', { uri, name: 'audio.m4a', type: 'audio/m4a' });
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'json');
    formData.append('language', 'en');

    const response = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey.trim()}` },
      body: formData
    });
    const data = await response.json();
    return data.text;
  } catch (e: any) { throw new Error(`Transcription failed: ${e.message}`); }
};

// 2. TEXT TO SPEECH (TTS)
export const speak = (text: string, onDone?: () => void) => {
  Speech.speak(text, { language: 'en-US', pitch: 1.1, rate: 0.95, onDone });
};

export const stopSpeaking = () => Speech.stop();

// 3. CHAT WITH DEEP CONTEXT & OFFLINE QUEUE
export const askAIStudyBuddy = async (userPrompt: string, userId: string, history: {role: 'user'|'assistant', content: string}[] = []) => {
  const { isConnected } = await NetInfo.fetch();
  
  if (!isConnected) {
    try {
      db.runSync(`INSERT INTO study_ai_queries (id, question, user_id, status) VALUES (?, ?, ?, ?)`, [generateUUID(), userPrompt, userId, 'pending']);
      return "[OFFLINE]: Internet connection lost. I've queued your question and will answer it as soon as you're back online! 📡";
    } catch (e) { return "I couldn't even queue that one, doc. Check your local storage."; }
  }

  if (!getGroqKey()) return "🔑 API Key Missing";
  
  try {
    const hybridKnowledge = await getHybridContext(userPrompt, userId);
    const systemPrompt = `You are the "MBBS Study Buddy" — a long-term revision partner who remembers everything the user has studied.

STRICT INSTRUCTIONS:
1. Provide in-depth, detailed medical explanations.
2. Maintain strict conversation context across turns (e.g. if user says "Anatomy" right after "Heart", explain Heart Anatomy).
3. The user has a personal knowledge base across FLASHCARDS, WHITEBOARD NOTES, BRAIN DUMP scribbles, PAST CHAT exchanges, USER MEMORY (pinned answers and notes about themselves), SYLLABUS STATUS (what's done vs pending), EXAM URGENCY (countdown), and ANATOMY LIBRARY (curated diagrams/3D models). When the CONTEXT block contains any of these, treat them as authoritative source material — cite the relevant fact, build on the user's prior work.
4. If CONTEXT shows the user chatted about this topic before, acknowledge ("We covered X earlier; today let's go deeper into Y").
5. When an ANATOMY LIBRARY entry is relevant, mention it by title and suggest the user check the Anatomy tab in their Study Hub for that specific diagram or 3D model. Never invent URLs.
6. If EXAM URGENCY is short (<14 days), prioritise high-yield revision over depth.
7. Skip ward tips unless explicitly requested.
8. Focus on clinical integration + high-yield exam content.

CONTEXT FROM USER'S OWN MATERIAL (may be empty):${hybridKnowledge}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userPrompt }
    ];

    return await callGroq("llama-3.3-70b-versatile", messages);
  } catch (error: any) { return "Syncope! Check internet. 🩺"; }
};

// 3b. CHAT SUMMARY — distil a conversation into a topic + 3-5 takeaways.
export const summariseChat = async (chatId: string): Promise<{ topic: string; takeaways: string[] } | null> => {
  if (!getGroqKey()) return null;
  try {
    const rows = db.getAllSync(
      `SELECT sender, text FROM study_chat_messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 60`,
      [chatId]
    ) as any[];
    if (!rows || rows.length < 2) return null;
    const transcript = rows.map((r: any) => `${r.sender === 'user' ? 'USER' : 'BUDDY'}: ${r.text}`).join('\n');
    const prompt = `Below is a study chat between an MBBS student and their AI study buddy. Output a strict JSON object with two keys: "topic" (short noun phrase ≤8 words capturing the chat's central subject) and "takeaways" (array of 3-5 short bullet strings, each ≤22 words, that the student should remember from this conversation). Output JSON ONLY, no markdown.\n\nCHAT:\n${transcript.slice(0, 6000)}`;
    const result = await callGroq('llama-3.3-70b-versatile',
      [{ role: 'system', content: 'You compress study conversations into JSON summaries.' }, { role: 'user', content: prompt }],
      0.3
    );
    const parsed = JSON.parse(String(result).replace(/```json|```/g, '').trim());
    if (!parsed || typeof parsed.topic !== 'string') return null;
    return { topic: parsed.topic, takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.slice(0, 5).map(String) : [] };
  } catch { return null; }
};

// 3c. FLASHCARD EXTRACTION — turn an AI answer (or a brain-dump line) into a Q/A pair.
export const extractFlashcard = async (sourceText: string, hintTopic?: string): Promise<{ front: string; back: string } | null> => {
  if (!getGroqKey()) return null;
  try {
    const prompt = `From the medical content below, produce a STUDY FLASHCARD as strict JSON with exactly two keys: "front" (a clinically-pointed question, max 25 words) and "back" (the high-yield answer, max 60 words). Output JSON ONLY.\n\nTOPIC HINT: ${hintTopic || 'general'}\n\nCONTENT:\n${String(sourceText).slice(0, 2000)}`;
    const result = await callGroq('llama-3.3-70b-versatile',
      [{ role: 'system', content: 'You craft tight MBBS flashcards. JSON only.' }, { role: 'user', content: prompt }],
      0.4
    );
    const parsed = JSON.parse(String(result).replace(/```json|```/g, '').trim());
    if (!parsed?.front || !parsed?.back) return null;
    return { front: String(parsed.front), back: String(parsed.back) };
  } catch { return null; }
};

// 3d. PROACTIVE SUGGESTIONS — what should the buddy nudge the user about?
export const getDailySuggestions = (userId: string): string[] => {
  const tips: string[] = [];
  try {
    const dueCount = db.getFirstSync(
      `SELECT COUNT(*) AS c FROM study_cards c JOIN study_decks d ON d.id = c.deck_id
       WHERE d.user_id = ? AND (c.next_review IS NULL OR c.next_review <= date('now'))`,
      [userId]
    ) as any;
    if (dueCount?.c > 0) tips.push(`${dueCount.c} flashcards due for review today.`);

    const exam = db.getFirstSync(
      `SELECT title, exam_date FROM study_exams WHERE user_id = ? AND exam_date >= date('now') ORDER BY exam_date ASC LIMIT 1`,
      [userId]
    ) as any;
    if (exam) {
      const days = Math.max(0, Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / 86400000));
      tips.push(`${exam.title} in ${days} days — prioritise weak topics.`);
    }

    const pending = db.getAllSync(
      `SELECT title FROM study_syllabus WHERE user_id = ? AND (theory_status IS NULL OR theory_status != 'done') ORDER BY created_at ASC LIMIT 3`,
      [userId]
    ) as any[];
    if (pending?.length > 0) tips.push(`Pending revision: ${pending.map((p: any) => p.title).join(', ')}.`);

    const weak = db.getAllSync(
      `SELECT content FROM user_memories WHERE user_id = ? AND kind = 'weak_topic' ORDER BY created_at DESC LIMIT 2`,
      [userId]
    ) as any[];
    if (weak?.length > 0) tips.push(`You marked weak: ${weak.map((w: any) => w.content).join(' • ')}.`);
  } catch {}
  return tips;
};

// 3e. BRAIN DUMP PROCESSOR — turn unprocessed brain-dump rows into flashcards.
export const processBrainDumpToFlashcards = async (userId: string, deckId: string): Promise<number> => {
  if (!deckId || !getGroqKey()) return 0;
  let count = 0;
  try {
    const dumps = db.getAllSync(
      `SELECT id, content FROM study_brain_dump WHERE user_id = ? AND (is_processed IS NULL OR is_processed = 0) ORDER BY created_at DESC LIMIT 5`,
      [userId]
    ) as any[];
    for (const d of (dumps || [])) {
      const card = await extractFlashcard(d.content);
      if (!card) continue;
      const cardId = generateUUID();
      db.runSync(
        `INSERT INTO study_cards (id, deck_id, front_content, back_content, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
        [cardId, deckId, card.front, card.back]
      );
      db.runSync(`UPDATE study_brain_dump SET is_processed = 1 WHERE id = ?`, [d.id]);
      count++;
    }
  } catch {}
  return count;
};

// 4. OFFLINE QUEUE PROCESSING (CALLED BY SYNC ENGINE)
export const processPendingAIQueries = async (userId: string) => {
  const pending = db.getAllSync(`SELECT * FROM study_ai_queries WHERE status = 'pending' AND user_id = ?`, [userId]) as any[];
  if (pending.length === 0) return;

  for (const query of pending) {
    try {
      db.runSync(`UPDATE study_ai_queries SET status = 'processing' WHERE id = ?`, [query.id]);
      const answer = await askAIStudyBuddy(query.question, userId);
      db.runSync(`UPDATE study_ai_queries SET answer = ?, status = 'completed' WHERE id = ?`, [answer, query.id]);
    } catch (e) {
      db.runSync(`UPDATE study_ai_queries SET status = 'pending' WHERE id = ?`, [query.id]);
    }
  }
};

export const getAIQueryResults = (userId: string) => {
  return db.getAllSync(`SELECT * FROM study_ai_queries WHERE status = 'completed' AND user_id = ? ORDER BY created_at DESC`, [userId]) as any[];
};

// 5. REVISION BATTLE ENGINE
export const startRevisionBattle = async (userId: string, type: 'vignette' | 'rapidfire') => {
  if (!getGroqKey()) return null;
  try {
    const syllabus = db.getAllSync(`SELECT title FROM study_syllabus WHERE user_id = ? LIMIT 5`, [userId]) as any[];
    const topics = syllabus.length > 0 ? syllabus.map(s => s.title).join(", ") : "Anatomy";
    const prompt = `Generate high-yield medical clinical vignette. Topic: ${topics}. Return JSON ONLY: {"case":"...", "question":"...", "correct_answer":"...", "hints":["...", "..."]}`;
    const result = await callGroq("llama-3.3-70b-versatile", [{ role: "system", content: "Medical examiner. JSON only." }, { role: "user", content: prompt }], 0.7);
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch (e) { return null; }
};

// 6. REASONING EVALUATOR
export const evaluateBattleReasoning = async (userAnswer: string, correctAnswer: string, caseContext: string) => {
  if (!getGroqKey()) return null;
  try {
    const prompt = `Evaluate medical reasoning. Case: "${caseContext}". Correct: "${correctAnswer}". User: "${userAnswer}". Return JSON ONLY: {"score": 0, "feedback": "...", "practical_tip": "..."}`;
    const result = await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "Medical mentor." }, { role: "user", content: prompt }]);
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch (e) { return null; }
};

// 7. AUTONOMOUS INBOX PROCESSING
export const processInboxWithAI = async (userId: string) => {
  if (!getGroqKey()) return false;
  try {
    const rawItems = db.getAllSync(`SELECT * FROM study_brain_dump WHERE is_processed = 0 AND user_id = ?`, [userId]) as any[];
    if (rawItems.length === 0) return false;
    const prompt = `Categorize medical notes into "FLASHCARD" or "SYLLABUS". Return ONLY JSON: [{"id":"...", "action":"FLASHCARD", "front":"...", "back":"...", "deck_name":"..."}]. Notes: ${rawItems.map(i => `[ID: ${i.id}] ${i.content}`).join("\n")}`;
    const result = await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "Medical data organizer." }, { role: "user", content: prompt }]);
    const actions = JSON.parse(result.replace(/```json|```/g, "").trim());
    for (const act of actions) {
      if (act.action === "FLASHCARD") {
        const deck = db.getFirstSync(`SELECT id FROM study_decks WHERE title LIKE ? LIMIT 1`, [`%${act.deck_name}%`]) as any;
        const deckId = deck?.id || generateUUID();
        if (!deck) db.runSync(`INSERT INTO study_decks (id, title, user_id, created_at) VALUES (?, ?, ?, ?)`, [deckId, act.deck_name, userId, new Date().toISOString()]);
        db.runSync(`INSERT INTO study_cards (id, deck_id, front_content, back_content, created_at) VALUES (?, ?, ?, ?, ?)`, [generateUUID(), deckId, act.front, act.back, new Date().toISOString()]);
      }
      db.runSync(`UPDATE study_brain_dump SET is_processed = 1 WHERE id = ?`, [act.id]);
    }
    return true;
  } catch (error) { return false; }
};

// 8. MOTIVATIONAL GENERATOR
export const getMotivationalBoost = async (userId: string) => {
  if (!getGroqKey()) return "Keep going, Doctor! 🩺";
  try {
    const stats = db.getFirstSync(`SELECT SUM(focus_minutes) as focus FROM focus_sessions WHERE user_id = ?`, [userId]) as any;
    return await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "You are a sweet medical mentor." }, { role: "user", content: `Generate a 1-sentence motivation for a student who studied ${stats?.focus || 0}m today. Be very supportive and call them 'Doctor'.` }]);
  } catch (e) { return "The stethoscope looks good on you. Keep going! 🩺"; }
};

// 9. AUTONOMOUS COMMAND PROCESSING
export const processVoiceCommand = async (text: string, userId: string) => {
  const prompt = `Process medical student command: "${text}". 
  Decide action: "NOTE" (brain dump), "FLASHCARD" (new card), "WHITEBOARD" (draw command), "SEARCH" (find info). 
  Return JSON ONLY: {"action":"...", "payload":{...}, "confirmation":"..."}`;
  const result = await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "Command processor." }, { role: "user", content: prompt }]);
  return JSON.parse(result.replace(/```json|```/g, "").trim());
};

// 10. WHITEBOARD VISION
export const analyzeWhiteboardDrawing = async (base64Image: string, boardTitle: string, userId: string) => {
  if (!getGroqKey()) throw new Error("API Key missing");
  try {
    const prompt = `Analyze medical whiteboard: "${boardTitle}". Return JSON: {"summary":"...", "subject": "...", "cards":[{"front":"Q", "back":"A"}]}`;
    const messages = [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }] }];
    const result = await callGroq("llama-3.2-90b-vision", messages);
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch (error: any) { throw error; }
};
