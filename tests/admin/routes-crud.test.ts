import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createAdminRoutes } from '../../src/admin/routes.js';

const AUTH = { Authorization: 'Bearer t', 'content-type': 'application/json' };

function app() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, api: createAdminRoutes(db, 't') };
}

test('create model, list, add provider, list providers', async () => {
  const { api } = app();
  const created = await api.request('/models', { method: 'POST', headers: AUTH, body: JSON.stringify({ name: 'my-sonnet' }) });
  expect(created.status).toBe(201);
  const { model } = (await created.json()) as { model: { id: number; name: string } };
  expect(model.name).toBe('my-sonnet');

  const list = await api.request('/models', { headers: AUTH });
  expect(((await list.json()) as { models: unknown[] }).models.length).toBe(1);

  const addP = await api.request(`/models/${model.id}/providers`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ priority: 0, upstream_format: 'chat', base_url: 'https://x/v1', api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [], enabled: true }),
  });
  expect(addP.status).toBe(201);
  const { provider } = (await addP.json()) as { provider: { id: number; logical_model_id: number } };
  expect(provider.logical_model_id).toBe(model.id);

  const plist = await api.request(`/models/${model.id}/providers`, { headers: AUTH });
  expect(((await plist.json()) as { providers: unknown[] }).providers.length).toBe(1);
});

test('patch and delete provider', async () => {
  const { db, api } = app();
  const { createLogicalModel } = await import('../../src/store/logicalModels.js');
  const m = createLogicalModel(db, 'm');
  const addP = await api.request(`/models/${m.id}/providers`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ priority: 0, upstream_format: 'chat', base_url: 'x', api_key: 'k', upstream_model: 'a', models_dev_id: null, fallback_status_codes: [], enabled: true }),
  });
  const { provider } = (await addP.json()) as { provider: { id: number } };

  const patch = await api.request(`/providers/${provider.id}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ priority: 9 }) });
  expect(patch.status).toBe(200);
  const del = await api.request(`/providers/${provider.id}`, { method: 'DELETE', headers: AUTH });
  expect(del.status).toBe(204);
});

test('requires auth', async () => {
  const { api } = app();
  const res = await api.request('/models');
  expect(res.status).toBe(401);
});
