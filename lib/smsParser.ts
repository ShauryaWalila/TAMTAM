// SMS-INBOX → FINANCES parser. Pure on-device. No AI, no network.
//
// Universal Shortcut on each phone POSTs every transactional SMS as a row
// in Supabase `sms_inbox`. That row syncs down into local SQLite. This
// module then:
//   1. Picks unprocessed rows for the current user.
//   2. Runs regex stack → extracts amount, direction, merchant.
//   3. Scores a confidence in [0..1].
//   4. If confidence >= user-set threshold → inserts into `finances`.
//      Otherwise marks as 'review' so the Finance screen can show a
//      Pending Review banner with one-tap Add / Discard buttons.
//
// The threshold lives in `system_config.sms_confidence_threshold` (default
// 0.7). User adjusts via the slider in Finance → Settings.

import { db, generateUUID, queueSyncOperation } from './db';
import { categoriseDescription } from './financeCategories';

// ── Tunables (also configurable per-user via system_config later if needed)
const SPAM_DENY_RE = /\b(otp|verification\s*code|won|win\s+a\s+|cashback\s+eligible|click\s*here|kyc\s*(update|expir)|loan\s+approved|emi\s+offer|congratulations|lucky\s+draw|prize|lottery|insurance\s+quote)\b/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:^|\s)([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹|rupees?)/i;
const DEBIT_RE  = /\b(debited|spent|paid|sent|withdrawn|purchase|purchased|transferred\s+to|deducted|charged|debit)\b/i;
const CREDIT_RE = /\b(credited|received|refund|deposited|reversed|transferred\s+from|reversal|credit)\b/i;
const MERCHANT_RES = [
  /\b(?:to|at|towards|in\s+favou?r\s+of)\s+([A-Z0-9][A-Z0-9 &.\-_/]{1,40})/,
  /\bVPA\s+([\w.\-]+@[\w.\-]+)/i,
  /\bUPI[\s/:-]+([\w.\-]+@[\w.\-]+)/i,
  /\bfrom\s+([A-Z][A-Z0-9 &.\-]{1,40})/,
];
const SANE_MAX_AMOUNT = 10_000_000; // ₹1 crore — anything above is parse junk

// ── 64-bit FNV-1a hash, returned as 16-char hex. Pure JS, zero deps.
//    Cryptographically irrelevant — we only need collision-resistance for
//    short SMS bodies, which it easily provides.
export function bodyHash(sender: string, body: string): string {
  const input = (sender || '').toLowerCase().trim() + '|' + (body || '').slice(0, 240).toLowerCase().replace(/\s+/g, ' ').trim();
  // BigInt FNV-1a 64-bit
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & MASK;
  }
  return h.toString(16).padStart(16, '0');
}

export interface ParseResult {
  isFinance: boolean;
  confidence: number;             // 0..1
  amount?: number;
  direction?: 'debit' | 'credit';
  merchant?: string;
  category?: string;
  reason: string;                 // human-readable trace (debug)
}

export function parseSms(sender: string, body: string): ParseResult {
  const reasons: string[] = [];

  // STAGE 1 — spam denylist (kills OTPs / promos / KYC scares immediately).
  if (SPAM_DENY_RE.test(body)) {
    return { isFinance: false, confidence: 0, reason: 'spam-deny: matched promo/OTP keyword' };
  }

  // STAGE 2 — must have an amount.
  const amtMatch = body.match(AMOUNT_RE);
  const amtStr = amtMatch ? (amtMatch[1] || amtMatch[2]) : null;
  if (!amtStr) {
    return { isFinance: false, confidence: 0, reason: 'no-amount' };
  }
  const amount = parseFloat(amtStr.replace(/,/g, ''));
  if (!isFinite(amount) || amount <= 0 || amount > SANE_MAX_AMOUNT) {
    return { isFinance: false, confidence: 0, reason: `amount-out-of-range: ${amount}` };
  }
  reasons.push(`amount=${amount}`);

  // STAGE 3 — direction detection.
  const debitHit = DEBIT_RE.exec(body);
  const creditHit = CREDIT_RE.exec(body);
  let direction: 'debit' | 'credit' | undefined;
  if (debitHit && !creditHit) { direction = 'debit'; reasons.push('verb=debit'); }
  else if (creditHit && !debitHit) { direction = 'credit'; reasons.push('verb=credit'); }
  else if (debitHit && creditHit) {
    // Both verbs present (e.g. "transferred from X to Y"). Closer-to-amount wins.
    const amtIdx = amtMatch!.index ?? 0;
    const dDist = Math.abs((debitHit.index ?? 0) - amtIdx);
    const cDist = Math.abs((creditHit.index ?? 0) - amtIdx);
    direction = dDist <= cDist ? 'debit' : 'credit';
    reasons.push(`verb=both,closer=${direction}`);
  } else {
    reasons.push('verb=none');
  }

  // STAGE 4 — merchant / payee (best-effort, no penalty if missing).
  let merchant: string | undefined;
  for (const re of MERCHANT_RES) {
    const m = body.match(re);
    if (m && m[1]) { merchant = m[1].trim().replace(/[.,;:]+$/, ''); break; }
  }
  if (merchant) reasons.push(`merchant="${merchant}"`);

  // STAGE 5 — confidence score.
  //   0.45 base for having an amount
  // + 0.30 if direction unambiguous
  // + 0.15 if merchant extracted
  // + 0.10 if sender looks like a bank/UPI shortcode (no digits-only, ≤ 8 chars after dash)
  let confidence = 0.45;
  if (direction && reasons.includes('verb=debit')) confidence += 0.30;
  else if (direction && reasons.includes('verb=credit')) confidence += 0.30;
  else if (direction) confidence += 0.20; // 'verb=both' is weaker signal
  if (merchant) confidence += 0.15;
  if (looksLikeBankSender(sender)) { confidence += 0.10; reasons.push('sender-bank-shape'); }
  confidence = Math.min(1, confidence);

  // Category resolution (rule-based — no AI).
  const category = categoriseDescription(merchant || body.slice(0, 80), amount);

  return {
    isFinance: true,
    confidence,
    amount,
    direction,
    merchant,
    category,
    reason: reasons.join('; '),
  };
}

function looksLikeBankSender(sender: string): boolean {
  if (!sender) return false;
  // Indian transactional senders: XX-BANKNM, e.g. "VK-HDFCBK", "AD-AXISBK"
  // Promotional/marketing senders: usually "VM-...", "BP-..." but not reliable.
  // The body-shape filter already does most of the work; this is just a bonus signal.
  return /^[A-Z]{2}-[A-Z0-9]{3,10}$/i.test(sender) || /^[A-Z]{6,10}$/i.test(sender);
}

// ── Read threshold from system_config (writable from Settings UI).
export function getConfidenceThreshold(): number {
  try {
    const row = db.getFirstSync<{ value: string }>(
      `SELECT value FROM system_config WHERE key = 'sms_confidence_threshold'`
    );
    const v = row?.value ? parseFloat(row.value) : NaN;
    return isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch { return 0.7; }
}

export function setConfidenceThreshold(t: number): void {
  const v = Math.max(0, Math.min(1, t));
  db.runSync(
    `INSERT INTO system_config (key, value, updated_at) VALUES ('sms_confidence_threshold', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [String(v)]
  );
}

// ── #8 — Sender blocklist. Normalize "VK-HDFCBK" → "HDFCBK" so both spellings
//        of the same bank/service block together.
export function normalizeSender(s: string): string {
  if (!s) return '';
  return s.replace(/^[A-Z]{2}-/i, '').toUpperCase().trim();
}

export function isBlockedSender(userId: string, sender: string): boolean {
  const prefix = normalizeSender(sender);
  if (!prefix) return false;
  const row = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM sms_sender_blocklist WHERE user_id = ? AND sender_prefix = ?`,
    [userId, prefix]
  );
  return (row?.c || 0) > 0;
}

export function blockSender(userId: string, sender: string): void {
  const prefix = normalizeSender(sender);
  if (!prefix) return;
  const id = generateUUID();
  db.runSync(
    `INSERT OR IGNORE INTO sms_sender_blocklist (id, user_id, sender_prefix, original_sender, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    [id, userId, prefix, sender || prefix]
  );
  try {
    queueSyncOperation('sms_sender_blocklist', id, 'INSERT', {
      id, user_id: userId, sender_prefix: prefix, original_sender: sender || prefix,
      created_at: new Date().toISOString(),
    });
  } catch {}
  // Mark every existing row from this sender as spam so the Pending Review tray clears.
  db.runSync(
    `UPDATE sms_inbox SET decision = 'spam', processed_at = datetime('now')
     WHERE user_id = ? AND (decision = 'review' OR processed_at IS NULL)
       AND UPPER(REPLACE(IFNULL(sender,''),' ','')) LIKE '%' || ? || '%'`,
    [userId, prefix]
  );
}

export function unblockSender(userId: string, senderPrefix: string): void {
  db.runSync(
    `DELETE FROM sms_sender_blocklist WHERE user_id = ? AND sender_prefix = ?`,
    [userId, senderPrefix.toUpperCase()]
  );
}

export interface BlockedSender { id: string; sender_prefix: string; original_sender: string | null; created_at: string; }
export function listBlockedSenders(userId: string): BlockedSender[] {
  return db.getAllSync<BlockedSender>(
    `SELECT id, sender_prefix, original_sender, created_at
     FROM sms_sender_blocklist WHERE user_id = ? ORDER BY created_at DESC`,
    [userId]
  );
}

// ── #5 — Recurring debit fingerprint. Same merchant (or near-same amount) in
//        the previous 25–35 day window → flag this transaction as recurring.
export function detectRecurringMatch(userId: string, merchant: string | undefined, amount: number): boolean {
  // Look back 25–35 days for a hit. Two signals: merchant match OR amount within ±5 %.
  // Either alone is weak; we accept either to keep recall high — false positives
  // are harmless (just an extra badge on the txn).
  const lo = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  const hi = new Date(Date.now() - 25 * 86400000).toISOString().slice(0, 10);
  const ampLow  = amount * 0.95;
  const ampHigh = amount * 1.05;

  // Match by amount window (fast path).
  const amtHit = db.getFirstSync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM finances
     WHERE user_id = ? AND type = 'debit'
       AND transaction_date BETWEEN ? AND ?
       AND amount BETWEEN ? AND ?`,
    [userId, lo, hi, ampLow, ampHigh]
  );
  if ((amtHit?.c || 0) > 0) return true;

  // Match by merchant token (if available).
  if (merchant && merchant.length > 2) {
    const token = '%' + merchant.toLowerCase().split(/\s+/)[0] + '%';
    const merHit = db.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM finances
       WHERE user_id = ? AND type = 'debit'
         AND transaction_date BETWEEN ? AND ?
         AND LOWER(IFNULL(description,'')) LIKE ?`,
      [userId, lo, hi, token]
    );
    if ((merHit?.c || 0) > 0) return true;
  }
  return false;
}

// ── #11 — Redact bodies of resolved rows older than 30 days. Runs at most
//          once per calendar day (cheap idempotent guard via system_config).
export function redactOldSmsBodies(userId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const last = db.getFirstSync<{ value: string }>(
    `SELECT value FROM system_config WHERE key = 'sms_last_redaction_ymd'`
  )?.value || '';
  if (last === today) return 0;

  const cutoffIso = new Date(Date.now() - 30 * 86400000).toISOString();
  const result: any = db.runSync(
    `UPDATE sms_inbox
       SET body = '[redacted]'
     WHERE user_id = ?
       AND decision IS NOT NULL AND decision != 'review'
       AND received_at < ?
       AND body != '[redacted]'`,
    [userId, cutoffIso]
  );

  db.runSync(
    `INSERT INTO system_config (key, value, updated_at)
       VALUES ('sms_last_redaction_ymd', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [today]
  );
  return (result?.changes as number) || 0;
}

// ── Main runner. Process all unprocessed rows for this user.
export interface ProcessReport {
  processed: number;
  inserted: number;
  needsReview: number;
  spam: number;
}

export async function processSmsInbox(userId: string): Promise<ProcessReport> {
  const report: ProcessReport = { processed: 0, inserted: 0, needsReview: 0, spam: 0 };
  const threshold = getConfidenceThreshold();
  let rows: any[] = [];
  try {
    rows = db.getAllSync<any>(
      `SELECT * FROM sms_inbox WHERE user_id = ? AND processed_at IS NULL ORDER BY received_at ASC LIMIT 200`,
      [userId]
    );
  } catch (e) {
    // Table not yet created (initDB still running, or migration pending). Skip silently.
    return report;
  }

  for (const row of rows) {
    // #8 — blocklist short-circuit. Block-listed sender → spam, skip parsing entirely.
    if (isBlockedSender(userId, row.sender || '')) {
      db.runSync(
        `UPDATE sms_inbox SET processed_at = datetime('now'), decision = 'spam', confidence = 0 WHERE id = ?`,
        [row.id]
      );
      report.spam++;
      report.processed++;
      continue;
    }

    const parsed = parseSms(row.sender || '', row.body || '');

    if (!parsed.isFinance) {
      db.runSync(
        `UPDATE sms_inbox SET processed_at = datetime('now'), decision = 'spam', confidence = ?, parsed_amount = NULL WHERE id = ?`,
        [parsed.confidence, row.id]
      );
      report.spam++;
      report.processed++;
      continue;
    }

    const meetsBar = parsed.confidence >= threshold && !!parsed.direction;
    if (meetsBar) {
      const txnId = generateUUID();
      const today = new Date().toISOString().slice(0, 10);
      // App-wide convention uses 'credit' | 'debit' (matches the manual-entry UI
// and the totalNetBalance math). Don't switch to 'income'/'expense' here.
const type = parsed.direction === 'credit' ? 'credit' : 'debit';
      const desc = parsed.merchant || row.body.slice(0, 80);

      // #5 — recurring fingerprint: if a similar txn fired ~30 days ago, tag this one.
      const isRecurring = type === 'debit' && detectRecurringMatch(userId, parsed.merchant, parsed.amount!);
      const source = isRecurring ? 'sms_bank_recurring' : 'sms_bank';

      db.runSync(
        `INSERT INTO finances (id, created_at, amount, category, description, user_id, type, transaction_date, source, bank_ref)
         VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [txnId, parsed.amount!, parsed.category || 'Misc', desc, userId, type, today, source, row.id]
      );
      // Mirror to Supabase via existing sync queue.
      try {
        queueSyncOperation('finances', txnId, 'INSERT', {
          id: txnId, amount: parsed.amount, category: parsed.category || 'Misc',
          description: desc, user_id: userId, type, transaction_date: today,
          source, bank_ref: row.id, created_at: new Date().toISOString(),
        });
      } catch {}
      db.runSync(
        `UPDATE sms_inbox SET processed_at = datetime('now'), decision = 'inserted', confidence = ?, parsed_amount = ?, parsed_direction = ?, parsed_merchant = ?, parsed_category = ?, matched_txn_id = ? WHERE id = ?`,
        [parsed.confidence, parsed.amount!, parsed.direction!, parsed.merchant || null, parsed.category || null, txnId, row.id]
      );
      report.inserted++;
    } else {
      db.runSync(
        `UPDATE sms_inbox SET processed_at = datetime('now'), decision = 'review', confidence = ?, parsed_amount = ?, parsed_direction = ?, parsed_merchant = ?, parsed_category = ? WHERE id = ?`,
        [parsed.confidence, parsed.amount!, parsed.direction || null, parsed.merchant || null, parsed.category || null, row.id]
      );
      report.needsReview++;
    }
    report.processed++;
  }

  return report;
}

// ── Pending Review listing for the Finance screen banner.
export interface PendingReviewRow {
  id: string;
  sender: string;
  body: string;
  received_at: string;
  confidence: number;
  parsed_amount: number | null;
  parsed_direction: string | null;
  parsed_merchant: string | null;
  parsed_category: string | null;
}

export function listPendingReview(userId: string, limit = 50): PendingReviewRow[] {
  try {
    return db.getAllSync<PendingReviewRow>(
      `SELECT id, sender, body, received_at, confidence, parsed_amount, parsed_direction, parsed_merchant, parsed_category
       FROM sms_inbox WHERE user_id = ? AND decision = 'review' ORDER BY received_at DESC LIMIT ?`,
      [userId, limit]
    );
  } catch { return []; }
}

export function countPendingReview(userId: string): number {
  try {
    const r = db.getFirstSync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sms_inbox WHERE user_id = ? AND decision = 'review'`,
      [userId]
    );
    return r?.c || 0;
  } catch { return 0; }
}

// One-tap actions from the Pending Review banner.
export function approvePendingReview(inboxId: string, userId: string, overrides?: { amount?: number; direction?: 'debit' | 'credit'; category?: string; merchant?: string }) {
  const row = db.getFirstSync<any>(`SELECT * FROM sms_inbox WHERE id = ?`, [inboxId]);
  if (!row) return;
  const amount = overrides?.amount ?? row.parsed_amount;
  const direction = overrides?.direction ?? row.parsed_direction ?? 'debit';
  const merchant = overrides?.merchant ?? row.parsed_merchant ?? row.body.slice(0, 80);
  const category = overrides?.category ?? row.parsed_category ?? 'Misc';
  if (!amount || amount <= 0) return;

  const txnId = generateUUID();
  const today = new Date().toISOString().slice(0, 10);
  const type = direction === 'credit' ? 'credit' : 'debit';
  const isRecurring = type === 'debit' && detectRecurringMatch(userId, merchant, amount);
  const source = isRecurring ? 'sms_bank_recurring' : 'sms_bank';
  db.runSync(
    `INSERT INTO finances (id, created_at, amount, category, description, user_id, type, transaction_date, source, bank_ref)
     VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [txnId, amount, category, merchant, userId, type, today, source, inboxId]
  );
  try {
    queueSyncOperation('finances', txnId, 'INSERT', {
      id: txnId, amount, category, description: merchant, user_id: userId, type,
      transaction_date: today, source, bank_ref: inboxId,
      created_at: new Date().toISOString(),
    });
  } catch {}
  db.runSync(
    `UPDATE sms_inbox SET decision = 'inserted', matched_txn_id = ? WHERE id = ?`,
    [txnId, inboxId]
  );
}

export function discardPendingReview(inboxId: string) {
  db.runSync(
    `UPDATE sms_inbox SET decision = 'spam' WHERE id = ?`,
    [inboxId]
  );
}
