import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { refreshModelsDev } from '../../src/cost/modelsDev.js';
import { blockingBudget, costForProvider } from '../../src/cost/apply.js';
import type { BudgetStatus } from '../../src/cost/budget.js';
import type { Budget, Provider } from '../../src/types.js';

const sample = { anthropic: { id: 'anthropic', models: { 'claude-sonnet-4': { cost: { input: 3, output: 15, cache_read: 0, cache_write: 0 } } } } };
function fakeFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
}
function provider(over: Partial<Provider> = {}): Provider {
  return { id: 1, logical_model_id: 1, priority: 0, upstream_format: 'anthropic', base_url: 'x', api_key: 'k', upstream_model: 'claude-sonnet-4', models_dev_id: 'anthropic/claude-sonnet-4', fallback_status_codes: [], enabled: true, ...over };
}

test('costForProvider computes from models.dev price', async () => {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  const cost = costForProvider(db, provider(), { input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBeCloseTo(0.003 + 0.015, 10);
  db.close();
});

test('costForProvider returns 0 when no models_dev_id', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const cost = costForProvider(db, provider({ models_dev_id: null }), { input_tokens: 1000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBe(0);
  db.close();
});

test('costForProvider returns 0 when no price found', async () => {
  const db = openDb(':memory:');
  migrate(db);
  // No models.dev data loaded, so lookupPrice returns null
  const cost = costForProvider(db, provider(), { input_tokens: 1000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBe(0);
  db.close();
});

test('costForProvider returns 0 when provider is null', () => {
  const cost = costForProvider(null as unknown as never, null, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBe(0);
});

test('blockingBudget finds first over+block', () => {
  const b = (over: boolean, action: 'warn' | 'block'): BudgetStatus => ({
    budget: {} as Budget, spent_usd: 1, limit_usd: 1, action, over,
  });
  expect(blockingBudget([b(true, 'warn'), b(true, 'block')])?.action).toBe('block');
  expect(blockingBudget([b(false, 'block'), b(true, 'warn')])).toBeNull();
});
