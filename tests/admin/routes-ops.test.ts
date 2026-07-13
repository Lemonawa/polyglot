import { expect, test } from 'vitest';
import { createAdminRoutes } from '../../src/admin/routes.js';
import { migrate, openDb } from '../../src/store/db.js';
import { insertRequestLog } from '../../src/store/requestLogs.js';

const AUTH = { Authorization: 'Bearer t', 'content-type': 'application/json' };

function app() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, api: createAdminRoutes(db, 't') };
}

test('budget create/list/delete', async () => {
  const { api } = app();
  const created = await api.request('/budgets', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      scope: 'global',
      target_id: null,
      limit_usd: 50,
      period: 'month',
      action: 'block',
    }),
  });
  expect(created.status).toBe(201);
  const { budget } = (await created.json()) as { budget: { id: number } };
  const list = await api.request('/budgets', { headers: AUTH });
  expect(((await list.json()) as { budgets: unknown[] }).budgets.length).toBe(
    1,
  );
  const del = await api.request(`/budgets/${budget.id}`, {
    method: 'DELETE',
    headers: AUTH,
  });
  expect(del.status).toBe(204);
});

test('logs endpoint returns rows filtered by model', async () => {
  const { db, api } = app();
  insertRequestLog(db, {
    logical_model_id: 3,
    hit_provider_id: 1,
    client_format: 'chat',
    upstream_format: 'chat',
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0.01,
    latency_ms: 5,
    status: 'success',
    error: null,
    attempts: 1,
  });
  const res = await api.request('/logs?model=3', { headers: AUTH });
  const { logs } = (await res.json()) as { logs: { cost_usd: number }[] };
  expect(logs.length).toBe(1);
  expect(logs[0].cost_usd).toBe(0.01);
});

test('budget-status endpoint', async () => {
  const { api } = app();
  await api.request('/budgets', {
    method: 'POST',
    headers: AUTH,
    body: JSON.stringify({
      scope: 'global',
      target_id: null,
      limit_usd: 1,
      period: 'total',
      action: 'warn',
    }),
  });
  const res = await api.request('/models/5/budget-status', { headers: AUTH });
  const { statuses } = (await res.json()) as { statuses: unknown[] };
  expect(statuses.length).toBe(1);
});

test('models-dev refresh uses injected fetch via env is not testable here; unknown route 404s under auth', async () => {
  const { api } = app();
  const res = await api.request('/nope', { headers: AUTH });
  expect(res.status).toBe(404);
});
