import { db, generateUUID, queueSyncOperation } from "./db";
import { format, subDays } from "date-fns";

// 🛡️ CONFIGURATION
const GROQ_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY || "";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * DEEP RAG ENGINE: Searches local medical inventory for relevant context.
 */
const getRelevantLocalContext = (userPrompt: string, userId: string) => {
  const keywords = userPrompt.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").split(" ").filter(w => w.length > 3);
  if (keywords.length === 0) return "";
  let contextParts: string[] = [];
  try {
    const cardMatches = db.getAllSync(`SELECT front_content, back_content FROM study_cards JOIN study_decks ON study_cards.deck_id = study_decks.id WHERE study_decks.user_id = ? AND (front_content LIKE ? OR back_content LIKE ?) LIMIT 3`, [userId, `%${keywords[0]}%`, `%${keywords[0]}%`]) as any[];
    if (cardMatches.length > 0) contextParts.push("Relevant Flashcards: " + cardMatches.map(c => `Q: ${c.front_content} A: ${c.back_content}`).join(" | "));
    const dumpMatches = db.getAllSync(`SELECT content FROM study_brain_dump WHERE user_id = ? AND content LIKE ? LIMIT 2`, [userId, `%${keywords[0]}%`]) as any[];
    if (dumpMatches.length > 0) contextParts.push("Notes from your Brain Dump: " + dumpMatches.map(d => d.content).join(" | "));
    const syllabusMatches = db.getAllSync(`SELECT title, theory_status FROM study_syllabus WHERE user_id = ? AND title LIKE ? LIMIT 2`, [userId, `%${keywords[0]}%`]) as any[];
    if (syllabusMatches.length > 0) contextParts.push("Syllabus Status: " + syllabusMatches.map(s => `${s.title} is marked as ${s.theory_status}`).join(", "));
  } catch (e) { console.warn("RAG Search Error:", e); }
  return contextParts.length > 0 ? "\n[OWN DATA CONTEXT]:\n" + contextParts.join("\n") : "";
};

const callGroq = async (model: string, messages: any[]) => {
  const response = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.6 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Groq API Error");
  return data.choices[0].message.content;
};

// 1. CHAT WITH DEEP CONTEXT
export const askAIStudyBuddy = async (userPrompt: string, userId: string) => {
  if (!GROQ_KEY) return "🔑 Groq API Key Missing in .env";
  try {
    const localKnowledge = getRelevantLocalContext(userPrompt, userId);
    const recentSyllabus = db.getAllSync(`SELECT title FROM study_syllabus WHERE user_id = ? ORDER BY created_at DESC LIMIT 3`, [userId]) as any[];
    const focusStats = db.getFirstSync(`SELECT SUM(focus_minutes) as total FROM study_habit_log WHERE user_id = ? AND date >= ?`, [userId, format(subDays(new Date(), 7), 'yyyy-MM-dd')]) as any;
    const systemPrompt = `You are the "MBBS Study Buddy," her personalized medical mentor. Context: STUDYING: ${recentSyllabus.map(t => t.title).join(", ")} | FOCUS: ${focusStats?.total || 0}m this week. ${localKnowledge} Instructions: Use her notes if provided. Be supportive.`;
    return await callGroq("llama-3.3-70b-versatile", [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]);
  } catch (error: any) { return "I'm having a bit of a syncope! Check your internet. 🩺"; }
};

// 2. AUTONOMOUS INBOX PROCESSING
export const processInboxWithAI = async (userId: string) => {
  if (!GROQ_KEY) return false;
  try {
    const rawItems = db.getAllSync(`SELECT * FROM study_brain_dump WHERE is_processed = 0 AND user_id = ?`, [userId]) as any[];
    if (rawItems.length === 0) return false;
    const prompt = `Categorize medical notes into "FLASHCARD" or "SYLLABUS". Return ONLY JSON: [{"id":"...", "action":"FLASHCARD", "front":"...", "back":"...", "deck_name":"..."}]. Notes: ${rawItems.map(i => `[ID: ${i.id}] ${i.content}`).join("\n")}`;
    const result = await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "You are a medical data organizer. Valid JSON only." }, { role: "user", content: prompt }]);
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

// 3. MOTIVATIONAL GENERATOR
export const getMotivationalBoost = async (userId: string) => {
  if (!GROQ_KEY) return "Keep going, Doctor! 🩺";
  try {
    const stats = db.getFirstSync(`SELECT SUM(focus_minutes) as focus FROM study_habit_log WHERE user_id = ?`, [userId]) as any;
    return await callGroq("llama-3.1-8b-instant", [{ role: "system", content: "You are a sweet medical mentor." }, { role: "user", content: `Generate a 1-sentence motivation for a student who studied ${stats?.focus || 0}m today.` }]);
  } catch (e) { return "The stethoscope looks good on you. Keep going! 🩺"; }
};

// 4. WHITEBOARD VISION (STABLE PRODUCTION MODELS)
export const analyzeWhiteboardDrawing = async (base64Image: string, boardTitle: string, userId: string, existingQuestions: string[] = []) => {
  if (!GROQ_KEY) throw new Error("Groq API Key missing in .env");
  
  const VISION_MODELS = [
    "llama-3.2-90b-vision",
    "meta-llama/llama-4-scout-17b-16e-instruct"
  ];

  let lastError = "";
  for (const model of VISION_MODELS) {
    try {
      const prompt = `Expert medical professor mode. Analyze whiteboard: "${boardTitle}". 
      1. Extract text. 2. Explain diagrams. 
      3. Generate 3 high-yield Cue Cards.
      4. Categorize broad subject (e.g. Anatomy).
      
      CRITICAL CONSTRAINT: Do NOT repeat these existing questions: [${existingQuestions.join(", ")}]. 
      Focus on NEW facts or more advanced details.
      
      Return ONLY JSON: {"summary":"...", "notes":"...", "subject": "...", "cards":[{"front":"Q", "back":"A"}]}`;

      const messages = [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }] }];
      const result = await callGroq(model, messages);
      return JSON.parse(result.replace(/```json|```/g, "").trim());
    } catch (error: any) { lastError = error.message; }
  }
  throw new Error(`Vision failed: ${lastError}`);
};
