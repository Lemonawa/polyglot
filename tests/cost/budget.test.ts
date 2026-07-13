import { describe, expect, it, test } from 'vitest';
import { checkBudgets, periodStart } from '../../src/cost/budget.js';
import { createBudget } from '../../src/store/budgets.js';
import { migrate, openDb } from '../../src/store/db.js';
import { insertRequestLog } from '../../src/store/requestLogs.js';

describe('periodStart', () => {
  it('day at noon UTC returns that day 00:00:00.000Z', () => {
    const date = new Date(Date.UTC(2026, 6, 11, 12, 30, 0));
    expect(periodStart('day', date)).toBe('2026-07-11T00:00:00.000Z');
  });

  it('day at Jan 31 23:00 UTC returns Jan 31 00:00:00.000Z', () => {
    const date = new Date(Date.UTC(2026, 0, 31, 23, 0, 0));
    expect(periodStart('day', date)).toBe('2026-01-31T00:00:00.000Z');
  });

  it('month returns first-of-month 00:00:00.000Z', () => {
    const date = new Date(Date.UTC(2026, 6, 11, 12, 30, 0));
    expect(periodStart('month', date)).toBe('2026-07-01T00:00:00.000Z');
  });
});

function logCost(db: ReturnType<typeof openDb>, modelId: number, cost: number) {
  insertRequestLog(db, {
    logical_model_id: modelId,
    hit_provider_id: 1,
    client_format: 'chat',
    upstream_format: 'chat',
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: cost,
    latency_ms: 1,
    status: 'success',
    error: null,
    attempts: 1,
  });
}

test('global total budget flags over when spent exceeds limit', () => {
  const db = openDb(':memory:');
  migrate(db);
  createBudget(db, {
    scope: 'global',
    target_id: null,
    limit_usd: 1,
    period: 'total',
    action: 'block',
  });
  logCost(db, 5, 0.6);
  logCost(db, 5, 0.6);
  const statuses = checkBudgets(db, 5);
  expect(statuses.length).toBe(1);
  expect(statuses[0].spent_usd).toBeCloseTo(1.2, 10);
  expect(statuses[0].over).toBe(true);
  expect(statuses[0].action).toBe('block');
  db.close();
});

test('logical_model budget only counts that model, not over when under limit', () => {
  const db = openDb(':memory:');
  migrate(db);
  createBudget(db, {
    scope: 'logical_model',
    target_id: 7,
    limit_usd: 10,
    period: 'total',
    action: 'warn',
  });
  logCost(db, 7, 3);
  logCost(db, 8, 100); // 别的模型不计入
  const statuses = checkBudgets(db, 7);
  expect(statuses[0].spent_usd).toBeCloseTo(3, 10);
  expect(statuses[0].over).toBe(false);
  db.close();
});

test('no budgets -> empty statuses', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(checkBudgets(db, 1)).toEqual([]);
  db.close();
});
