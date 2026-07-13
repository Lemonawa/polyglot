import type Database from 'better-sqlite3';
import type { Budget, BudgetScope } from '../types.js';

export type BudgetInput = Omit<Budget, 'id'>;

export function createBudget(
  db: Database.Database,
  input: BudgetInput,
): Budget {
  const info = db
    .prepare(
      'INSERT INTO budgets (scope, target_id, limit_usd, period, action) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      input.scope,
      input.target_id,
      input.limit_usd,
      input.period,
      input.action,
    );
  return { id: Number(info.lastInsertRowid), ...input };
}

export function listBudgets(
  db: Database.Database,
  opts: { scope?: BudgetScope; targetId?: number } = {},
): Budget[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (opts.scope !== undefined) {
    clauses.push('scope = ?');
    values.push(opts.scope);
  }
  if (opts.targetId !== undefined) {
    clauses.push('target_id = ?');
    values.push(opts.targetId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM budgets ${where} ORDER BY id`)
    .all(...values) as Budget[];
}

export function deleteBudget(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
}
