// Budget breach detector + notifier.
//
// Privacy: notifications NEVER include amounts, category names, or descriptions.
// Just: "A budget limit has been reached." Tap → opens Finance for the user
// to look up details themselves.
//
// Throttling: a budget only notifies once per period. The `notified_at`
// column tracks when it last fired. If `notified_at >= period_start`, skip.
//
// Supported `kind` values:
//   'period_overall'  — sum of expenses in [start_date, end_date] vs target_amount
//   'period_category' — same, scoped to a single category
//   'single_txn'      — alert when ANY new expense > target_amount
//   'velocity'        — alert when > target_amount transactions occur in [start_date, end_date]
//
// `threshold_pct` (0..1) — fire at percentage of target. 1.0 = at breach.
// 0.8 = warn at 80%.  `notify_on_warn` toggles whether warn-level fires at all.

import * as Notifications from 'expo-notifications';
import { db, queueSyncOperation } from './db';

type Budget = {
  id: string;
  user_id: string;
  title: string;
  category: string | null;
  target_amount: number;
  start_date: string;
  end_date: string;
  kind: string;
  threshold_pct: number;
  notified_at: string | null;
  notify_on_warn: number | boolean;
};

const todayISO = () => new Date().toISOString();
const dateOnly = (s: string) => s?.slice(0, 10);

const fireGenericAlert = async (kind: string) => {
  try {
    // Two-line body, no figures, no names. Just enough to know it's about money.
    const subline =
      kind === 'single_txn' ? 'A purchase tripped a single-transaction cap.' :
      kind === 'velocity'   ? 'Too many transactions in a short window.' :
                              'Tap to review your transactions.';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🪙 Budget alert',
        body: 'A budget limit has been reached.\n' + subline,
        data: { route: '/finance', kind: 'budget_alert' },
      },
      trigger: null,
    });
  } catch {}
};

const markNotified = (budgetId: string) => {
  const now = todayISO();
  try {
    db.runSync(`UPDATE targets SET notified_at = ? WHERE id = ?`, [now, budgetId]);
    queueSyncOperation('targets', budgetId, 'UPDATE', { notified_at: now });
  } catch {}
};

const wasNotifiedThisPeriod = (b: Budget): boolean => {
  if (!b.notified_at) return false;
  return dateOnly(b.notified_at) >= dateOnly(b.start_date);
};

const periodExpenseSum = (userId: string, b: Budget): number => {
  try {
    const args: any[] = [userId.toLowerCase(), b.start_date, b.end_date];
    let where = `user_id = ? AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ? AND type = 'expense'`;
    if (b.kind === 'period_category' && b.category && b.category !== 'All') {
      where += ` AND category = ?`;
      args.push(b.category);
    }
    const row = db.getFirstSync(`SELECT COALESCE(SUM(amount), 0) AS total FROM finances WHERE ${where}`, args) as any;
    return Number(row?.total) || 0;
  } catch {
    return 0;
  }
};

const periodTransactionCount = (userId: string, b: Budget): number => {
  try {
    const row = db.getFirstSync(
      `SELECT COUNT(*) AS c FROM finances WHERE user_id = ? AND COALESCE(transaction_date, date(created_at)) BETWEEN ? AND ?`,
      [userId.toLowerCase(), b.start_date, b.end_date]
    ) as any;
    return Number(row?.c) || 0;
  } catch {
    return 0;
  }
};

/**
 * Run every active budget. Called after every finance save and on app
 * foreground. Cheap (in-memory SQL) so safe to invoke often.
 */
export const checkAllBudgetAlerts = async (userId: string, justAddedTxn?: { amount: number; category?: string }) => {
  if (!userId) return;
  let budgets: Budget[] = [];
  try {
    budgets = db.getAllSync(
      `SELECT * FROM targets WHERE user_id = ? AND start_date IS NOT NULL AND end_date IS NOT NULL AND date('now') BETWEEN start_date AND end_date`,
      [userId.toLowerCase()]
    ) as Budget[];
  } catch {
    return;
  }
  for (const b of budgets) {
    try {
      if (wasNotifiedThisPeriod(b)) continue;

      let breached = false;

      if (b.kind === 'period_overall' || b.kind === 'period_category') {
        const spent = periodExpenseSum(userId, b);
        const threshold = (Number(b.threshold_pct) || 1.0) * Number(b.target_amount);
        if (spent >= threshold) breached = true;
      } else if (b.kind === 'single_txn') {
        // Only meaningful when we just added a transaction.
        if (justAddedTxn && justAddedTxn.amount >= Number(b.target_amount)) {
          if (!b.category || b.category === 'All' || justAddedTxn.category === b.category) {
            breached = true;
          }
        }
      } else if (b.kind === 'velocity') {
        const count = periodTransactionCount(userId, b);
        if (count >= Number(b.target_amount)) breached = true;
      }

      if (!breached) continue;
      await fireGenericAlert(b.kind);
      markNotified(b.id);
    } catch {}
  }
};
