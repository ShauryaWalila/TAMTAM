// Diet AI — enrich an ingredient's nutrient values via Groq LLM.
// Reuses the same `groq_api_key` row in system_config as lib/aiEngine.ts.
// Output schema is strict JSON; the caller validates + lets the user review
// every field before any DB write happens.

import { db } from './db';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const getGroqKey = (): string | null => {
  try {
    const row = db.getFirstSync<{ value: string }>(
      `SELECT value FROM system_config WHERE key = 'groq_api_key'`
    );
    return row?.value?.trim() || null;
  } catch { return null; }
};

export interface AiNutrientValue {
  metric_id: string | null;     // existing diet_metrics.id if matched, else null
  metric_name: string;          // canonical name (lowercase, snake)
  display_name: string;         // human label
  unit: string;                 // e.g. "g", "mg", "kcal"
  value: number;                // numeric, per base_quantity
  confidence: number;           // 0..1
  is_new_metric: boolean;       // true if not in current diet_metrics table
}

export interface AiUnitSuggestion {
  unit_id: string;              // lowercase id
  display_name: string;         // e.g. "tablespoon"
  grams_equivalent?: number;    // optional conversion
  is_new: boolean;              // true if not in current diet_units table
}

export interface EnrichResult {
  ingredient: string;
  base_quantity: number;        // e.g. 100
  base_unit: AiUnitSuggestion;  // recommended unit for base_quantity
  values: AiNutrientValue[];    // nutrient rows
  new_metrics: AiNutrientValue[];   // subset of `values` where is_new_metric === true (convenience)
  new_units: AiUnitSuggestion[];    // any other units suggested (rare)
  notes?: string;
  raw?: string;                 // raw model response for debugging
}

// Numeric sanity caps per 100g/100ml. Defends against the model hallucinating
// "9000 kcal/100g" or negative values. Numbers tuned to common Indian/global
// foods — extend if you log something exotic.
const SANITY_CAPS: Record<string, { min: number; max: number }> = {
  calories:        { min: 0, max: 900 },
  energy:          { min: 0, max: 900 },
  protein:         { min: 0, max: 100 },
  carbs:           { min: 0, max: 100 },
  carbohydrates:   { min: 0, max: 100 },
  fat:             { min: 0, max: 100 },
  fats:            { min: 0, max: 100 },
  saturated_fat:   { min: 0, max: 100 },
  fiber:           { min: 0, max: 80 },
  sugar:           { min: 0, max: 100 },
  sodium:          { min: 0, max: 50000 },  // mg
  potassium:       { min: 0, max: 5000 },
  calcium:         { min: 0, max: 2000 },
  iron:            { min: 0, max: 50 },
  cholesterol:     { min: 0, max: 5000 },
  vitamin_c:       { min: 0, max: 2000 },
  vitamin_a:       { min: 0, max: 30000 },
  vitamin_b12:     { min: 0, max: 1000 },   // mcg
  vitamin_d:       { min: 0, max: 1000 },
};

function normaliseMetricKey(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function sane(name: string, v: number): boolean {
  if (!isFinite(v) || v < 0) return false;
  const cap = SANITY_CAPS[normaliseMetricKey(name)];
  if (!cap) return v <= 100000;   // unknown metric: loose cap
  return v >= cap.min && v <= cap.max;
}

// Cross-check macro math: protein*4 + carbs*4 + fat*9 ≈ calories ±20%.
// If wildly off, drop confidence by 0.2 on calories.
function macroCheck(values: AiNutrientValue[]): AiNutrientValue[] {
  const map: Record<string, AiNutrientValue> = {};
  for (const v of values) map[normaliseMetricKey(v.metric_name)] = v;
  const cal = map['calories'] || map['energy'];
  const p = map['protein']?.value || 0;
  const c = (map['carbs'] || map['carbohydrates'])?.value || 0;
  const f = (map['fat'] || map['fats'])?.value || 0;
  if (!cal || (!p && !c && !f)) return values;
  const expected = p * 4 + c * 4 + f * 9;
  if (Math.abs(expected - cal.value) / Math.max(cal.value, 1) > 0.2) {
    cal.confidence = Math.max(0.2, cal.confidence - 0.2);
  }
  return values;
}

export interface CurrentDietContext {
  metrics: Array<{ id: string; name: string; unit: string }>;
  units: Array<{ id: string; name: string }>;
}

export async function enrichIngredient(
  name: string,
  ctx: CurrentDietContext
): Promise<EnrichResult> {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('Groq API Key not set. Add it in Settings.');
  if (!name || !name.trim()) throw new Error('Ingredient name required.');

  const trimmed = name.trim();

  const sysPrompt = `You are a nutrition database. Given an ingredient name, return a strict JSON object with nutrient values per 100g (or per 100ml if liquid). Use widely-accepted reference values (USDA or equivalent for Indian foods). Round to 1 decimal. NEVER invent units that don't exist. Output ONLY the JSON, no prose.`;

  const userPrompt = `Ingredient: "${trimmed}"

Existing diet_metrics in the user's app (use these IDs verbatim when applicable):
${JSON.stringify(ctx.metrics, null, 0)}

Existing diet_units (use these IDs verbatim when applicable):
${JSON.stringify(ctx.units, null, 0)}

Required JSON schema:
{
  "ingredient": string,
  "base_quantity": number,
  "base_unit": {"unit_id": string, "display_name": string, "grams_equivalent": number|null, "is_new": boolean},
  "values": [
    {
      "metric_id": string|null,
      "metric_name": string,
      "display_name": string,
      "unit": string,
      "value": number,
      "confidence": number,
      "is_new_metric": boolean
    }
  ],
  "notes": string
}

Rules:
- For every nutrient you know about (calories, protein, carbs, fat, fiber, sugar, sodium, calcium, iron, plus any other common one), include a row.
- If the metric ID exists in diet_metrics list, set metric_id to that ID and is_new_metric=false.
- If the metric is genuinely new and useful (e.g. omega-3 for fish), include it with is_new_metric=true and metric_id=null.
- Use snake_case lowercase for any new metric_name. display_name human-readable.
- confidence: how sure are you? 0.9+ for common foods, 0.5–0.8 for variable/regional, 0.3 or less if you're guessing.
- base_quantity should be 100 unless the ingredient is naturally measured otherwise (e.g. 1 egg).
- For base_unit, prefer "g" for solids, "ml" for liquids. Match an existing unit ID where possible.
- Do NOT invent unrealistic numbers. If unsure, lower the confidence.`;

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const raw = await response.json();
  if (!response.ok) throw new Error(raw?.error?.message || 'Groq error');
  const content = raw?.choices?.[0]?.message?.content || '{}';

  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch { throw new Error('AI returned malformed JSON. Try again.'); }

  // Validate + sanitise
  const values: AiNutrientValue[] = Array.isArray(parsed.values) ? parsed.values : [];
  const cleanedValues: AiNutrientValue[] = [];
  for (const v of values) {
    if (!v || typeof v.value !== 'number') continue;
    if (!sane(v.metric_name || '', v.value)) continue;
    cleanedValues.push({
      metric_id: v.metric_id || null,
      metric_name: normaliseMetricKey(v.metric_name || ''),
      display_name: String(v.display_name || v.metric_name || '').slice(0, 60),
      unit: String(v.unit || '').slice(0, 20),
      value: Number(v.value),
      confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0.5)),
      is_new_metric: !!v.is_new_metric || !v.metric_id,
    });
  }
  macroCheck(cleanedValues);

  const baseUnit: AiUnitSuggestion = parsed.base_unit || { unit_id: 'g', display_name: 'gram', is_new: false };
  const result: EnrichResult = {
    ingredient: String(parsed.ingredient || trimmed),
    base_quantity: Number(parsed.base_quantity) || 100,
    base_unit: {
      unit_id: String(baseUnit.unit_id || 'g').toLowerCase(),
      display_name: String(baseUnit.display_name || 'gram'),
      grams_equivalent: baseUnit.grams_equivalent || undefined,
      is_new: !!baseUnit.is_new,
    },
    values: cleanedValues,
    new_metrics: cleanedValues.filter(v => v.is_new_metric),
    new_units: baseUnit.is_new ? [baseUnit] : [],
    notes: parsed.notes || '',
    raw: content,
  };

  // No caching — once user saves the ingredient, its values live in
  // `ingredients`. Re-querying is cheap on the free tier.

  return result;
}

// Helper for the review modal — once user confirms, call this to actually
// write any approved new metrics + units to the local DB. Returns map of
// newly-created metric_name → metric_id so the caller can wire IDs into the
// nutrients object before saving the ingredient.
export interface ApproveResult {
  metric_id_map: Record<string, string>;   // metric_name → id (only for newly-created)
  unit_id_map: Record<string, string>;     // unit_id requested → id stored
}

export function approveAndCreateNewMetrics(
  newMetrics: AiNutrientValue[],
  newUnits: AiUnitSuggestion[],
  approvedMetricNames: Set<string>,
  approvedUnitIds: Set<string>
): ApproveResult {
  const metric_id_map: Record<string, string> = {};
  const unit_id_map: Record<string, string> = {};

  for (const u of newUnits) {
    if (!approvedUnitIds.has(u.unit_id)) continue;
    const id = u.unit_id.toLowerCase();
    try {
      db.runSync(`INSERT OR IGNORE INTO diet_units (id, name) VALUES (?, ?)`, [id, u.display_name || id]);
      unit_id_map[u.unit_id] = id;
    } catch {}
  }

  for (const m of newMetrics) {
    if (!approvedMetricNames.has(m.metric_name)) continue;
    const id = 'm_' + m.metric_name;
    try {
      db.runSync(`INSERT OR IGNORE INTO diet_metrics (id, name, unit) VALUES (?, ?, ?)`,
        [id, m.display_name || m.metric_name, m.unit || '']);
      metric_id_map[m.metric_name] = id;
    } catch {}
  }
  return { metric_id_map, unit_id_map };
}
