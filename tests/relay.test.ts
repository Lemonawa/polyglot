import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { listRequestLogs } from '../src/store/requestLogs.js';
import { handleChat } from '../src/relay.js';
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

test('routes to first provider and returns chat response, logs success', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  const runner = async (p: Provider) => ({ text: `hi from ${p.upstream_model}`, usage: { input: 3, output: 4 } });

  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'hey' }] }, runner);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('hi from A');

  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].status).toBe('success');
  expect(logs[0].attempts).toBe(1);
  expect(logs[0].input_tokens).toBe(3);
  expect(logs[0].cost_usd).toBe(0);
  db.close();
});

test('falls back to second provider on hard failure', async () => {
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
  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'x' }] }, runner);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('from B');
  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].attempts).toBe(2);
  expect(logs[0].hit_provider_id).not.toBeNull();
  db.close();
});

test('unknown model returns 404', async () => {
  const { db } = setup();
  const res = await handleChat(db, { model: 'ghost', messages: [] }, async () => ({ text: '', usage: { input: 0, output: 0 } }));
  expect(res.status).toBe(404);
  db.close();
});

test('stream: true returns 501', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));
  const runner = async () => ({ text: '', usage: { input: 0, output: 0 } });
  const res = await handleChat(
    db,
    { model: 'my-gpt', messages: [{ role: 'user', content: 'hey' }], stream: true },
    runner,
  );
  expect(res.status).toBe(501);
  const json = (await res.json()) as { error: { type: string } };
  expect(json.error.type).toBe('streaming_unsupported');
  db.close();
});

test('AI SDK statusCode:400 is read (not status) — stops chain, does not try second provider', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'B' }));
  let secondCalled = false;
  const runner = async (p: Provider) => {
    if (p.upstream_model === 'A') {
      // Throw an APICallError-shaped object with statusCode (not status)
      const e = new Error('bad request') as Error & { statusCode?: number };
      e.statusCode = 400;
      throw e;
    }
    secondCalled = true;
    return { text: 'from B', usage: { input: 0, output: 0 } };
  };
  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'x' }] }, runner);
  expect(res.status).toBe(502);
  expect(secondCalled).toBe(false); // chain did not try second provider
  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].attempts).toBe(1);
  db.close();
});

test('AI SDK statusCode:500 is read as fallback — single provider still returns 502', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));
  const runner = async () => {
    const e = new Error('server error') as Error & { statusCode?: number };
    e.statusCode = 500;
    throw e;
  };
  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'x' }] }, runner);
  expect(res.status).toBe(502);
  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].attempts).toBe(1);
  db.close();
});
