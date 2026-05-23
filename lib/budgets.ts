// Recurring budget rollover.
//
// A budget row in `targets` table represents one budget cycle. When the
// cycle ends and `is_recurring = true`, we spawn a fresh row for the next
// cycle so the user always has a live tracker without re-creating it.
//
// frequency values:
//   'daily'    — period = 1 day
//   'weekly'   — period = 7 days
//   'monthly'  — period = 1 calendar month
//   'yearly'   — period = 1 calendar year

import { db, generateUUID, queueSyncOperation } from './db';

export type BudgetFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

const addPeriod = (date: Date, freq: BudgetFrequency): Date => {
  const d = new Date(date);
  switch (freq) {
    case 'daily':   d.setDate(d.getDate() + 1); break;
    case 'weekly':  d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'yearly':  d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
};

const toYMD = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Scans every budget for the user. Any whose `end_date` is in the past AND
 * `is_recurring = true` AND `frequency` is set gets a fresh next-period row
 * inserted. Idempotent — won't double-create if the next period already exists.
 *
 * Call this on Finance screen mount.
 */
export const runBudgetRollover = (userId: string): number => {
  if (!userId) return 0;
  let created = 0;
  try {
    const today = toYMD(new Date());
    const expired = db.getAllSync(
      `SELECT * FROM targets WHERE user_id = ? AND end_date IS NOT NULL AND end_date < ? AND is_recurring = 1 AND frequency IS NOT NULL`,
      [userId.toLowerCase(), today]
    ) as any[];
    for (const b of expired || []) {
      const freq = b.frequency as BudgetFrequency;
      const oldEnd = new Date(b.end_date);
      // Step forward until the new period covers today.
      let newStart = addPeriod(oldEnd, freq);
      let newEnd = addPeriod(newStart, freq);
      // Subtract one day so end_date is the LAST day of the period, not the
      // first of the next.
      newEnd.setDate(newEnd.getDate() - 1);
      // Catch up if multiple periods have passed.
      while (toYMD(newEnd) < today) {
        newStart = addPeriod(newStart, freq);
        newEnd = addPeriod(newEnd, freq);
      }
      // Check if a next-period row already exists.
      const exists = db.getFirstSync(
        `SELECT id FROM targets WHERE user_id = ? AND title = ? AND start_date = ? LIMIT 1`,
        [userId.toLowerCase(), b.title, toYMD(newStart)]
      );
      if (exists) continue;
      const id = generateUUID();
      const row = {
        id,
        created_at: new Date().toISOString(),
        title: b.title,
        target_amount: b.target_amount,
        current_amount: 0,
        category: b.category,
        user_id: userId.toLowerCase(),
        type: b.type || 'budget',
        period: freq,
        start_date: toYMD(newStart),
        end_date: toYMD(newEnd),
        frequency: freq,
        is_recurring: 1,
        last_period_end: b.end_date,
      };
      db.runSync(
        `INSERT INTO targets (id, created_at, title, target_amount, current_amount, category, user_id, type, period, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.created_at, row.title, row.target_amount, row.current_amount, row.category, row.user_id, row.type, row.period, row.start_date, row.end_date]
      );
      queueSyncOperation('targets', id, 'INSERT', row);
      // Mark the expired budget as no-longer-active so the UI hides it from
      // "current" list. We do this by setting is_recurring=0 on the old row.
      db.runSync(`UPDATE targets SET is_recurring = 0 WHERE id = ?`, [b.id]);
      queueSyncOperation('targets', b.id, 'UPDATE', { is_recurring: false });
      created++;
    }
  } catch (e) {
    console.warn('Budget rollover failed:', e);
  }
  return created;
};

/** Used in the Finance screen to compute used vs target for a budget row. */
export const computeBudgetSpent = (userId: string, budget: any): number => {
  if (!budget?.start_date || !budget?.end_date) return 0;
  try {
    const args: any[] = [userId.toLowerCase(), budget.start_date, budget.end_date];
    let where = `user_id = ? AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ? AND type = 'expense'`;
    if (budget.category && budget.category !== 'All') {
      where += ` AND category = ?`;
      args.push(budget.category);
    }
    const row = db.getFirstSync(`SELECT COALESCE(SUM(amount), 0) AS total FROM finances WHERE ${where}`, args) as any;
    return Number(row?.total) || 0;
  } catch {
    return 0;
  }
};
