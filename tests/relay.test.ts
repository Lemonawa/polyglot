import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { handleRequest } from '../src/convert.js';
import type { Provider } from '../src/types.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return {
    logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'https://x/v1',
    api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'my-gpt');
  return { db, model };
}

test('POST /v1/chat/completions routes and returns success', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));

  const runner = async (p: Provider) => ({ text: 'hi from A', usage: { input: 3, output: 4 } });

  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'hey' }],
  }, runner);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('hi from A');
  db.close();
});

test('unknown model returns 404 through handleRequest', async () => {
  const { db } = setup();
  const res = await handleRequest(db, 'chat', { model: 'ghost', messages: [] },
    async () => ({ text: '', usage: { input: 0, output: 0 } }));
  expect(res.status).toBe(404);
  db.close();
});

test('fallback to second provider on hard failure', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'B' }));

  const runner = async (p: Provider) => {
    if (p.upstream_model === 'A') {
      const e = new Error('down') as Error & { status?: number };
      e.status = 503;
      throw e;
    }
    return { text: 'from B', usage: { input: 1, output: 1 } };
  };
  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'x' }],
  }, runner);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('from B');
  db.close();
});

test('all providers fail returns 502', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));

  const runner = async () => {
    const e = new Error('server error') as Error & { statusCode?: number };
    e.statusCode = 500;
    throw e;
  };
  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'x' }],
  }, runner);
  expect(res.status).toBe(502);
  db.close();
});
