import { db, generateUUID, queueSyncOperation } from "./db";
import { format, subDays } from "date-fns";
import { supabase } from "./supabase";
import * as Speech from 'expo-speech';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';

// 🛡️ CONFIGURATION
const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_AUDIO_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * HYBRID RAG ENGINE: Combines Offline FTS5 (Keyword) and Online Supabase pgvector (Semantic)
 */
export const getHybridContext = async (userPrompt: string, userId: string) => {
  const keywords = userPrompt.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(" ").filter(w => w.length > 3);
  if (keywords.length === 0) return "";
  let contextParts: string[] = [];
  try {
    const ftsQuery = keywords.join(' OR ');
    const localMatches = db.getAllSync(`SELECT f.front_content, f.back_content FROM study_cards_fts f JOIN study_decks d ON f.deck_id = d.id WHERE d.user_id = ? AND study_cards_fts MATCH ? ORDER BY rank LIMIT 2`, [userId, ftsQuery]) as any[];
    if (localMatches.length > 0) contextParts.push("[OFFLINE KEYWORD MATCHES]: " + localMatches.map(c => `Q: ${c.front_content} A: ${c.back_content}`).join(" | "));
  } catch (e) {}
  try {
    const { data: { embedding }, error } = await supabase.functions.invoke('embed', { body: { text: userPrompt } });
    if (!error && embedding) {
      const { data: matches } = await supabase.rpc('match_study_cards', { query_embedding: embedding, match_threshold: 0.5, match_count: 2 });
      if (matches?.length > 0) contextParts.push("[ONLINE SEMANTIC MATCHES]: " + matches.map((m: any) => `Q: ${m.front_content} A: ${m.back_content}`).join(" | "));
    }
  } catch (e) {}
  return contextParts.length > 0 ? "\n" + contextParts.join("\n") : "";
};

const callGroq = async (model: string, messages: any[], temperature = 0.6) => {
  const response = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Groq API Error");
  return data.choices[0].message.content;
};

// 1. VOICE TRANSCRIPTION (STT)
export const transcribeAudio = async (uri: string) => {
  if (!GROQ_KEY) throw new Error("API Key Missing");
  try {
    const formData = new FormData();
    // @ts-ignore
    formData.append('file', { uri, name: 'audio.m4a', type: 'audio/m4a' });
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'json');
    formData.append('language', 'en');

    const response = await fetch(GROQ_AUDIO_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY.trim()}` },
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

  if (!GROQ_KEY) return "🔑 API Key Missing";
  
  try {
    const hybridKnowledge = await getHybridContext(userPrompt, userId);
    const systemPrompt = `You are the "MBBS Study Buddy." 
    STRICT INSTRUCTIONS: 
    1. Provide in-depth, detailed medical explanations. 
    2. Maintain strict conversation context (e.g. if the user says "Anatomy" after asking about "Heart", explain Heart Anatomy).
    3. Do NOT show Ward Tips by default unless specifically relevant or requested.
    4. Focus on clinical integration and high-yield professional exam content.
    5. Use the following context from the user's notes: ${hybridKnowledge}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userPrompt }
    ];

    return await callGroq("llama-3.3-70b-versatile", messages);
  } catch (error: any) { return "Syncope! Check internet. 🩺"; }
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
  if (!GROQ_KEY) return null;
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
  if (!GROQ_KEY) return null;
  try {
    const prompt = `Evaluate medical reasoning. Case: "${caseContext}". Correct: "${correctAnswer}". User: "${userAnswer}". Return JSON ONLY: {"score": 0, "feedback": "...", "practical_tip": "..."}`;
    const result = await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "Medical mentor." }, { role: "user", content: prompt }]);
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch (e) { return null; }
};

// 7. AUTONOMOUS INBOX PROCESSING
export const processInboxWithAI = async (userId: string) => {
  if (!GROQ_KEY) return false;
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
  if (!GROQ_KEY) return "Keep going, Doctor! 🩺";
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
  if (!GROQ_KEY) throw new Error("API Key missing");
  try {
    const prompt = `Analyze medical whiteboard: "${boardTitle}". Return JSON: {"summary":"...", "subject": "...", "cards":[{"front":"Q", "back":"A"}]}`;
    const messages = [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }] }];
    const result = await callGroq("llama-3.2-90b-vision", messages);
    return JSON.parse(result.replace(/```json|```/g, "").trim());
  } catch (error: any) { throw error; }
};
