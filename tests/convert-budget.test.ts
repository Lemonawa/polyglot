import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { createBudget } from '../src/store/budgets.js';
import { insertRequestLog, listRequestLogs } from '../src/store/requestLogs.js';
import { handleRequest, type ProviderRunner } from '../src/convert.js';
import type { CanonicalResult } from '../src/canonical/types.js';
import type { StreamEvent, StreamHandle } from '../src/outbound/execute.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return { logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'x', api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [], enabled: true, ...over };
}

test('blocking budget over limit returns 402 before calling upstream', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const m = createLogicalModel(db, 'my-gpt');
  createProvider(db, input({ logical_model_id: m.id }));
  createBudget(db, { scope: 'logical_model', target_id: m.id, limit_usd: 0.001, period: 'total', action: 'block' });
  insertRequestLog(db, { logical_model_id: m.id, hit_provider_id: 1, client_format: 'chat', upstream_format: 'chat', input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.005, latency_ms: 1, status: 'success', error: null, attempts: 1 });

  const res = await handleRequest(db, 'chat', { model: 'my-gpt', messages: [{ role: 'user', content: 'hi' }] });
  expect(res.status).toBe(402);
  db.close();
});

test('non-streaming cost: fake runner records cost_usd from models.dev price', async () => {
  const { refreshModelsDev } = await import('../src/cost/modelsDev.js');
  const sample = { openai: { id: 'openai', models: { 'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 0 } } } } };
  const fakeFetch = (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch, () => '2026-07-12T00:00:00.000Z');
  const m = createLogicalModel(db, 'my-gpt');
  createProvider(db, input({ logical_model_id: m.id, upstream_model: 'gpt-4o', models_dev_id: 'openai/gpt-4o' }));

  const fakeRunner: ProviderRunner = {
    execute: async (_provider, _req) => ({
      text: 'hello',
      tool_calls: [],
      finish_reason: 'stop',
      usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 },
    }),
    stream: () => {
      throw new Error('not used');
    },
  };

  const res = await handleRequest(db, 'chat', { model: 'my-gpt', messages: [{ role: 'user', content: 'hi' }] }, fakeRunner);
  expect(res.status).toBe(200);

  const logs = listRequestLogs(db, { logicalModelId: m.id });
  expect(logs.length).toBe(1);
  expect(logs[0].cost_usd).toBeCloseTo(0.0075, 10);
  expect(logs[0].cost_usd).not.toBe(0);
  expect(logs[0].input_tokens).toBe(1000);
  expect(logs[0].output_tokens).toBe(500);
  expect(logs[0].status).toBe('success');
  db.close();
});

test('streaming cost: fake runner records cost_usd from models.dev price', async () => {
  const { refreshModelsDev } = await import('../src/cost/modelsDev.js');
  const sample = { openai: { id: 'openai', models: { 'gpt-4o': { cost: { input: 2.5, output: 10, cache_read: 1.25, cache_write: 0 } } } } };
  const fakeFetch = (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch, () => '2026-07-12T00:00:00.000Z');
  const m = createLogicalModel(db, 'my-gpt');
  createProvider(db, input({ logical_model_id: m.id, upstream_model: 'gpt-4o', models_dev_id: 'openai/gpt-4o' }));

  const fakeRunner: ProviderRunner = {
    execute: () => {
      throw new Error('not used');
    },
    stream: (_provider, _req) => {
      let done = false;
      const stream: AsyncIterable<StreamEvent> = {
        [Symbol.asyncIterator]: () => ({
          next: () => {
            if (!done) { done = true; return Promise.resolve({ value: { kind: 'text', text: 'Hi there' }, done: false }); }
            return Promise.resolve({ value: undefined, done: true });
          },
        }),
      };
      const resultPromise: Promise<CanonicalResult> = Promise.resolve({
        text: 'Hi there',
        tool_calls: [],
        finish_reason: 'stop',
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0 },
      });
      return { stream, resultPromise } satisfies StreamHandle;
    },
  };

  const res = await handleRequest(db, 'chat', { model: 'my-gpt', messages: [{ role: 'user', content: 'hi' }], stream: true }, fakeRunner);
  expect(res.status).toBe(200);

  // Drain SSE response body
  const reader = res.body!.getReader();
  while (!(await reader.read()).done) { /* drain */ }

  // Streaming log is fire-and-forget via .then — allow it to settle
  await new Promise((r) => setTimeout(r, 50));

  const logs = listRequestLogs(db, { logicalModelId: m.id });
  expect(logs.length).toBe(1);
  expect(logs[0].cost_usd).toBeCloseTo(0.0075, 10);
  expect(logs[0].cost_usd).not.toBe(0);
  expect(logs[0].input_tokens).toBe(1000);
  expect(logs[0].output_tokens).toBe(500);
  expect(logs[0].status).toBe('success');
  db.close();
});
