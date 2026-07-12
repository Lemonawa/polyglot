import type Database from 'better-sqlite3';
import { listBudgets } from '../store/budgets.js';
import type { Budget, BudgetAction, BudgetPeriod } from '../types.js';

export interface BudgetStatus {
  budget: Budget;
  spent_usd: number;
  limit_usd: number;
  action: BudgetAction;
  over: boolean;
}

export function periodStart(period: BudgetPeriod, now: Date): string | null {
  if (period === 'total') return null;
  if (period === 'day') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  // month
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function spentSince(
  db: Database.Database,
  sinceIso: string | null,
  logicalModelId?: number,
): number {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (sinceIso !== null) {
    clauses.push('created_at >= ?');
    values.push(sinceIso);
  }
  if (logicalModelId !== undefined) {
    clauses.push('logical_model_id = ?');
    values.push(logicalModelId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM request_logs ${where}`)
    .get(...values) as { total: number };
  return row.total;
}

export function checkBudgets(
  db: Database.Database,
  logicalModelId: number,
  now: Date = new Date(),
): BudgetStatus[] {
  const budgets = [
    ...listBudgets(db, { scope: 'global' }),
    ...listBudgets(db, { scope: 'logical_model', targetId: logicalModelId }),
  ];
  return budgets.map((budget) => {
    const since = periodStart(budget.period, now);
    const scopeModelId = budget.scope === 'logical_model' ? logicalModelId : undefined;
    const spent = spentSince(db, since, scopeModelId);
    return {
      budget,
      spent_usd: spent,
      limit_usd: budget.limit_usd,
      action: budget.action,
      over: spent >= budget.limit_usd,
    };
  });
}
