import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { handleRequest, type ProviderRunner } from '../src/convert.js';
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

/** Build a ProviderRunner from a simple execute function (stream throws). */
function runnerFrom(execute: (p: Provider, req: unknown) => Promise<{ text: string; usage: { input: number; output: number } }>): ProviderRunner {
  return {
    execute: execute as ProviderRunner['execute'],
    stream: () => { throw new Error('stream not implemented in test'); },
  };
}

test('successful chat completion returns 200', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));

  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'hey' }],
  }, runnerFrom(async () => ({ text: 'hi from A', usage: { input: 3, output: 4 } })));
  expect(res.status).toBe(200);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('hi from A');
  db.close();
});

test('unknown model returns 404', async () => {
  const { db } = setup();
  const res = await handleRequest(db, 'chat', { model: 'ghost', messages: [] },
    runnerFrom(async () => ({ text: '', usage: { input: 0, output: 0 } })));
  expect(res.status).toBe(404);
  db.close();
});

test('falls back to second provider on hard failure', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'B' }));

  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'x' }],
  }, runnerFrom(async (p: Provider) => {
    if (p.upstream_model === 'A') {
      const e = new Error('down') as Error & { status?: number };
      e.status = 503;
      throw e;
    }
    return { text: 'from B', usage: { input: 1, output: 1 } };
  }));
  expect(res.status).toBe(200);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('from B');
  db.close();
});

test('all providers fail returns 502', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));

  const res = await handleRequest(db, 'chat', {
    model: 'my-gpt', messages: [{ role: 'user', content: 'x' }],
  }, runnerFrom(async () => {
    const e = new Error('server error') as Error & { statusCode?: number };
    e.statusCode = 500;
    throw e;
  }));
  expect(res.status).toBe(502);
  db.close();
});
