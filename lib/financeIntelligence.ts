// All on-device finance "intelligence" — auto-learn rules, recurring
// detector, bill predictor, spending forecast, one-tap split, monthly
// snapshot, date-night picker, gift jar. Zero external API calls, zero
// LLM. Everything reads existing local SQLite + writes tiny mirror rows.
//
// Storage is kept minimal: snapshots (12 rows/year), gift_jar (~one row per
// idea), user_finance_rules (~one row per merchant correction).

import { db, generateUUID, queueSyncOperation } from './db';
import { categoriseDescription, type FinanceCategory } from './financeCategories';

// ───────────────────────── 1. Auto-learn categoriser ─────────────────────

/** Save a user's correction so future txns with the same pattern auto-tag. */
export const learnCategoryRule = (userId: string, description: string, category: FinanceCategory) => {
  if (!userId || !description || !category) return;
  const desc = description.trim().toLowerCase();
  if (desc.length < 3) return;
  // Use a short signature: the most-distinctive token from the description.
  // For SMS-style bank descriptions we usually have the merchant in caps,
  // so we pick the longest alphanumeric run (often the merchant name).
  const tokens = desc.split(/[^a-z0-9]+/i).filter(t => t.length >= 4);
  const pattern = (tokens.sort((a, b) => b.length - a.length)[0] || desc).slice(0, 64);

  try {
    // If pattern already exists for this user, increment hit_count; else insert.
    const existing = db.getFirstSync(
      `SELECT id, hit_count FROM user_finance_rules WHERE user_id = ? AND pattern = ? AND category = ? LIMIT 1`,
      [userId.toLowerCase(), pattern, category]
    ) as any;
    if (existing) {
      const next = (existing.hit_count || 1) + 1;
      db.runSync(`UPDATE user_finance_rules SET hit_count = ? WHERE id = ?`, [next, existing.id]);
      queueSyncOperation('user_finance_rules', existing.id, 'UPDATE', { hit_count: next });
    } else {
      const id = generateUUID();
      db.runSync(
        `INSERT INTO user_finance_rules (id, user_id, pattern, category, is_regex, hit_count) VALUES (?, ?, ?, ?, 0, 1)`,
        [id, userId.toLowerCase(), pattern, category]
      );
      queueSyncOperation('user_finance_rules', id, 'INSERT', {
        id, user_id: userId.toLowerCase(), pattern, category, is_regex: false, hit_count: 1,
      });
    }
  } catch {}
};

/** Categorise — checks user rules first, then falls back to built-in. */
export const smartCategorise = (userId: string, description: string, amount?: number): FinanceCategory => {
  if (!description) return 'Misc';
  try {
    const rules = db.getAllSync(
      `SELECT pattern, category FROM user_finance_rules WHERE user_id = ? ORDER BY hit_count DESC LIMIT 200`,
      [userId.toLowerCase()]
    ) as any[];
    const d = description.toLowerCase();
    for (const r of rules || []) {
      if (d.includes((r.pattern as string).toLowerCase())) return r.category as FinanceCategory;
    }
  } catch {}
  return categoriseDescription(description, amount);
};

// ─────────────────── 2. Recurring-subscription detector ──────────────────

export type SubscriptionGuess = {
  signature: string;
  description: string;
  category: string;
  avg_amount: number;
  occurrences: number;
  last_seen: string;
  next_estimate: string | null;
};

const monthDiff = (later: Date, earlier: Date) =>
  (later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth());

/** Returns rows that look like monthly recurring debits. Reads last 6 months. */
export const detectSubscriptions = (userId: string): SubscriptionGuess[] => {
  if (!userId) return [];
  const out: SubscriptionGuess[] = [];
  try {
    const rows = db.getAllSync(
      `SELECT description, category, amount, COALESCE(transaction_date, date(created_at)) AS d
       FROM finances
       WHERE user_id = ? AND type = 'expense'
         AND COALESCE(transaction_date, date(created_at)) >= date('now', '-180 days')`,
      [userId.toLowerCase()]
    ) as any[];

    // Group by a normalised "signature" of the description: keep only the
    // longest 2-3 tokens. This collapses "AMZN*ORDER 123" and "AMZN*ORDER 456".
    const groups: Record<string, any[]> = {};
    for (const r of rows || []) {
      const tokens = String(r.description || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4);
      const sig = tokens.sort((a, b) => b.length - a.length).slice(0, 2).sort().join('|') || 'misc';
      (groups[sig] ||= []).push(r);
    }

    for (const [sig, arr] of Object.entries(groups)) {
      if (arr.length < 2) continue; // need at least 2 hits to call it recurring
      // Check that occurrences are spread across distinct months.
      const dates = arr.map(a => new Date(a.d)).sort((a, b) => +a - +b);
      const monthsSpanned = monthDiff(dates[dates.length - 1], dates[0]);
      if (monthsSpanned < 1) continue;
      // Average amount within ±15% deviation
      const amounts = arr.map(a => Number(a.amount));
      const avg = amounts.reduce((s, n) => s + n, 0) / amounts.length;
      const allClose = amounts.every(a => Math.abs(a - avg) / avg < 0.25);
      if (!allClose) continue;

      const lastDate = dates[dates.length - 1];
      const nextEstimate = new Date(lastDate);
      nextEstimate.setMonth(nextEstimate.getMonth() + 1);

      out.push({
        signature: sig,
        description: arr[0].description,
        category: arr[0].category || 'Misc',
        avg_amount: Math.round(avg),
        occurrences: arr.length,
        last_seen: lastDate.toISOString().slice(0, 10),
        next_estimate: nextEstimate.toISOString().slice(0, 10),
      });
    }
  } catch {}
  return out.sort((a, b) => b.occurrences - a.occurrences);
};

// ─────────────────── 3. Bill cycle predictor ─────────────────────────────

export type BillForecast = {
  description: string;
  category: string;
  next_due: string;
  avg_amount: number;
  days_away: number;
};

/** Predicts next due date for monthly recurring bills (uses the subscription
 *  detector + filters to utility/bill categories only). */
export const predictBills = (userId: string): BillForecast[] => {
  const subs = detectSubscriptions(userId);
  const billCats = new Set(['Bills & Utilities', 'Mobile & Internet', 'Subscriptions', 'Insurance', 'Rent']);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return subs
    .filter(s => billCats.has(s.category) && s.next_estimate)
    .map(s => {
      const next = new Date(s.next_estimate as string);
      return {
        description: s.description,
        category: s.category,
        next_due: s.next_estimate as string,
        avg_amount: s.avg_amount,
        days_away: Math.ceil((next.getTime() - today.getTime()) / 86400000),
      };
    })
    .filter(b => b.days_away >= -1 && b.days_away <= 7)  // 1 day past to 7 days out
    .sort((a, b) => a.days_away - b.days_away);
};

// ─────────────────── 4. Spending forecast ────────────────────────────────

export type SpendingForecast = {
  month_to_date: number;
  daily_avg: number;
  projected_month: number;
  previous_month_total: number;
  trend: 'higher' | 'lower' | 'same';
  pct_change: number;
};

export const computeSpendingForecast = (userId: string): SpendingForecast | null => {
  if (!userId) return null;
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startISO = startOfMonth.toISOString().slice(0, 10);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    const mtdRow = db.getFirstSync(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM finances
       WHERE user_id = ? AND type = 'expense'
         AND COALESCE(transaction_date, date(created_at)) >= ?`,
      [userId.toLowerCase(), startISO]
    ) as any;
    const prevRow = db.getFirstSync(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM finances
       WHERE user_id = ? AND type = 'expense'
         AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ?`,
      [userId.toLowerCase(), prevStart, prevEnd]
    ) as any;

    const mtd = Number(mtdRow?.total) || 0;
    const prev = Number(prevRow?.total) || 0;

    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyAvg = dayOfMonth > 0 ? mtd / dayOfMonth : 0;
    const projected = Math.round(dailyAvg * daysInMonth);

    let trend: 'higher' | 'lower' | 'same' = 'same';
    let pct = 0;
    if (prev > 0) {
      pct = ((projected - prev) / prev) * 100;
      if (pct > 5) trend = 'higher';
      else if (pct < -5) trend = 'lower';
    }
    return { month_to_date: mtd, daily_avg: dailyAvg, projected_month: projected, previous_month_total: prev, trend, pct_change: Math.round(pct) };
  } catch {
    return null;
  }
};

// ─────────────────── 5. One-tap split with partner ───────────────────────

export const splitTransactionWithPartner = (txn: any, partnerUserId: string) => {
  if (!txn || !partnerUserId) return;
  const halved = Math.round((Number(txn.amount) || 0) / 2);
  if (halved <= 0) return;
  // Reduce my row to half of original
  try {
    db.runSync(`UPDATE finances SET amount = ? WHERE id = ?`, [halved, txn.id]);
    queueSyncOperation('finances', txn.id, 'UPDATE', { amount: halved });
  } catch {}
  // Create mirror row on partner side
  const mirrorId = generateUUID();
  const payload: any = {
    id: mirrorId,
    amount: halved,
    type: txn.type,
    category: txn.category,
    description: `(Split) ${txn.description || ''}`.trim(),
    user_id: partnerUserId.toLowerCase(),
    created_at: new Date().toISOString(),
    transaction_date: txn.transaction_date || txn.created_at?.slice(0, 10),
    source: 'split',
    split_from: txn.id,
  };
  try {
    db.runSync(
      `INSERT INTO finances (id, amount, type, category, description, user_id, created_at, transaction_date, source, split_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.id, payload.amount, payload.type, payload.category, payload.description, payload.user_id, payload.created_at, payload.transaction_date, payload.source, payload.split_from]
    );
    queueSyncOperation('finances', mirrorId, 'INSERT', payload);
  } catch {}
};

// ─────────────────── 6. Monthly snapshot ─────────────────────────────────

export const ensureMonthlySnapshots = (userId: string) => {
  if (!userId) return;
  try {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    // Snapshot every prior YYYY-MM not yet recorded (up to 12 months back).
    for (let i = 1; i <= 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const exists = db.getFirstSync(`SELECT 1 FROM monthly_snapshots WHERE user_id = ? AND ym = ? LIMIT 1`, [userId.toLowerCase(), ym]);
      if (exists) continue;
      const start = ym + '-01';
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      const expense = db.getFirstSync(
        `SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c FROM finances WHERE user_id = ? AND type = 'expense' AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ?`,
        [userId.toLowerCase(), start, end]
      ) as any;
      const income = db.getFirstSync(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM finances WHERE user_id = ? AND type = 'income' AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ?`,
        [userId.toLowerCase(), start, end]
      ) as any;
      const totalExpense = Number(expense?.s) || 0;
      const totalIncome  = Number(income?.s) || 0;
      const txnCount = Number(expense?.c) || 0;
      const row = { user_id: userId.toLowerCase(), ym, total_expense: totalExpense, total_income: totalIncome, close_balance: totalIncome - totalExpense, txn_count: txnCount };
      db.runSync(
        `INSERT OR REPLACE INTO monthly_snapshots (user_id, ym, total_expense, total_income, close_balance, txn_count) VALUES (?, ?, ?, ?, ?, ?)`,
        [row.user_id, row.ym, row.total_expense, row.total_income, row.close_balance, row.txn_count]
      );
      queueSyncOperation('monthly_snapshots', `${row.user_id}|${row.ym}`, 'INSERT', row);
    }
  } catch {}
};

// ─────────────────── 9. Date-night picker ────────────────────────────────

export type DateNightSuggestion = {
  source: 'wishlist' | 'chill_item' | 'memory_pin';
  title: string;
  subtitle?: string;
  url?: string;
};

export const suggestDateNight = (count = 3): DateNightSuggestion[] => {
  const out: DateNightSuggestion[] = [];
  try {
    // Pull random wishlist pins
    const wl = db.getAllSync(`SELECT title, comments FROM wishlist ORDER BY RANDOM() LIMIT 3`) as any[];
    (wl || []).forEach((w: any) => out.push({ source: 'wishlist', title: w.title || 'Wishlist spot', subtitle: w.comments?.slice(0, 80) }));
  } catch {}
  try {
    const ci = db.getAllSync(`SELECT title, content FROM chill_items WHERE type IN ('idea','place','activity') ORDER BY RANDOM() LIMIT 3`) as any[];
    (ci || []).forEach((c: any) => {
      let sub = '';
      try { const p = typeof c.content === 'string' ? JSON.parse(c.content) : c.content; sub = p?.note || p?.text || ''; } catch {}
      out.push({ source: 'chill_item', title: c.title || 'Idea', subtitle: sub?.slice(0, 80) });
    });
  } catch {}
  try {
    const places = db.getAllSync(`SELECT name FROM places WHERE category = 'memory' ORDER BY RANDOM() LIMIT 2`) as any[];
    (places || []).forEach((p: any) => out.push({ source: 'memory_pin', title: p.name || 'Memory pin' }));
  } catch {}
  // Shuffle + trim
  return out.sort(() => Math.random() - 0.5).slice(0, count);
};

// ─────────────────── 10. Gift jar ───────────────────────────────────────

export const addToGiftJar = (capturedBy: string, forPartner: string, text: string, source: 'manual' | 'diary' | 'chill_item' = 'manual', sourceRef?: string) => {
  if (!capturedBy || !forPartner || !text?.trim()) return;
  const id = generateUUID();
  const row: any = {
    id,
    captured_by: capturedBy.toLowerCase(),
    for_partner: forPartner.toLowerCase(),
    text: text.trim().slice(0, 300),
    source,
    source_ref: sourceRef || null,
    is_given: 0,
    captured_at: new Date().toISOString(),
  };
  try {
    db.runSync(
      `INSERT INTO gift_jar (id, captured_by, for_partner, text, source, source_ref, is_given, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.captured_by, row.for_partner, row.text, row.source, row.source_ref, row.is_given, row.captured_at]
    );
    queueSyncOperation('gift_jar', id, 'INSERT', row);
  } catch {}
};

export const listGiftJar = (capturedBy: string) => {
  if (!capturedBy) return [];
  try {
    return db.getAllSync(`SELECT * FROM gift_jar WHERE captured_by = ? ORDER BY captured_at DESC`, [capturedBy.toLowerCase()]) as any[];
  } catch { return []; }
};

export const markGiftGiven = (id: string, given = true) => {
  try {
    db.runSync(`UPDATE gift_jar SET is_given = ? WHERE id = ?`, [given ? 1 : 0, id]);
    queueSyncOperation('gift_jar', id, 'UPDATE', { is_given: given });
  } catch {}
};

export const deleteGift = (id: string) => {
  try {
    db.runSync(`DELETE FROM gift_jar WHERE id = ?`, [id]);
    queueSyncOperation('gift_jar', id, 'DELETE', {});
  } catch {}
};

// Naive keyword-based "wish-detection" for diary/chill content.
// Returns true if text looks like the user wants something.
export const looksLikeWish = (text: string): boolean => {
  const t = (text || '').toLowerCase();
  const keys = ['i want', 'i wish', 'i would love', "i'd love", 'wishlist', 'i need', 'i would like', "i'd like", 'someday i', 'dream of', 'planning to buy', 'thinking of buying'];
  return keys.some(k => t.includes(k));
};
