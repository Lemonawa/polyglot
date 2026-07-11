import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createBudget, deleteBudget, listBudgets } from '../../src/store/budgets.js';
import { insertRequestLog, listRequestLogs } from '../../src/store/requestLogs.js';
import { readModelsDevCache, saveModelsDevCache } from '../../src/store/modelsDevCache.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('insert and list request logs (newest first, filter by model)', () => {
  const db = freshDb();
  insertRequestLog(db, {
    logical_model_id: 1, hit_provider_id: 7, client_format: 'chat', upstream_format: 'chat',
    input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0, latency_ms: 123, status: 'success', error: null, attempts: 1,
  });
  insertRequestLog(db, {
    logical_model_id: 2, hit_provider_id: null, client_format: 'chat', upstream_format: null,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0, latency_ms: 9, status: 'error', error: 'boom', attempts: 2,
  });
  expect(listRequestLogs(db).length).toBe(2);
  const forModel1 = listRequestLogs(db, { logicalModelId: 1 });
  expect(forModel1.length).toBe(1);
  expect(forModel1[0].hit_provider_id).toBe(7);
  expect(forModel1[0].created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  db.close();
});

test('budgets create/list/delete with filter', () => {
  const db = freshDb();
  const g = createBudget(db, { scope: 'global', target_id: null, limit_usd: 50, period: 'month', action: 'block' });
  createBudget(db, { scope: 'logical_model', target_id: 1, limit_usd: 5, period: 'day', action: 'warn' });
  expect(listBudgets(db).length).toBe(2);
  expect(listBudgets(db, { scope: 'logical_model', targetId: 1 }).length).toBe(1);
  deleteBudget(db, g.id);
  expect(listBudgets(db, { scope: 'global' }).length).toBe(0);
  db.close();
});

test('models_dev_cache upserts single row', () => {
  const db = freshDb();
  expect(readModelsDevCache(db)).toBeNull();
  saveModelsDevCache(db, '{"a":1}', '2026-07-11T00:00:00.000Z');
  saveModelsDevCache(db, '{"a":2}', '2026-07-11T01:00:00.000Z');
  const c = readModelsDevCache(db);
  expect(c?.data).toBe('{"a":2}');
  expect(c?.fetched_at).toBe('2026-07-11T01:00:00.000Z');
  db.close();
});
