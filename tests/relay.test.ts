import { expect, test } from 'vitest';
import type { CanonicalResult } from '../src/canonical/types.js';
import { handleRequest, type ProviderRunner } from '../src/convert.js';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return {
    logical_model_id: 1,
    priority: 0,
    upstream_format: 'chat',
    base_url: 'https://x/v1',
    api_key: 'k',
    upstream_model: 'gpt-4o',
    models_dev_id: null,
    fallback_status_codes: [],
    enabled: true,
    ...over,
  };
}

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'my-gpt');
  return { db, model };
}

function okResult(
  text: string,
  inputTokens = 0,
  outputTokens = 0,
): CanonicalResult {
  return {
    text,
    tool_calls: [],
    finish_reason: 'stop',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
  };
}

function makeRunner(
  execute: (
    p: Parameters<ProviderRunner['execute']>[0],
  ) => Promise<CanonicalResult>,
): ProviderRunner {
  return {
    execute,
    stream: () => {
      throw new Error('stream not used in test');
    },
  } as ProviderRunner;
}

test('successful chat completion returns 200', async () => {
  const { db, model } = setup();
  createProvider(
    db,
    input({ logical_model_id: model.id, upstream_model: 'A' }),
  );

  const res = await handleRequest(
    db,
    'chat',
    {
      model: 'my-gpt',
      messages: [{ role: 'user', content: 'hey' }],
    },
    makeRunner(async () => okResult('hi from A', 3, 4)),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  expect(json.choices[0].message.content).toBe('hi from A');
  db.close();
});

test('unknown model returns 404', async () => {
  const { db } = setup();
  const res = await handleRequest(
    db,
    'chat',
    { model: 'ghost', messages: [] },
    makeRunner(async () => okResult('')),
  );
  expect(res.status).toBe(404);
  db.close();
});

test('falls back to second provider on hard failure', async () => {
  const { db, model } = setup();
  createProvider(
    db,
    input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }),
  );
  createProvider(
    db,
    input({ logical_model_id: model.id, priority: 1, upstream_model: 'B' }),
  );

  const res = await handleRequest(
    db,
    'chat',
    {
      model: 'my-gpt',
      messages: [{ role: 'user', content: 'x' }],
    },
    makeRunner(async (p) => {
      if (p.upstream_model === 'A') {
        const e = new Error('down') as Error & { status?: number };
        e.status = 503;
        throw e;
      }
      return okResult('from B', 1, 1);
    }),
  );
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  expect(json.choices[0].message.content).toBe('from B');
  db.close();
});

test('all providers fail returns 502', async () => {
  const { db, model } = setup();
  createProvider(
    db,
    input({ logical_model_id: model.id, upstream_model: 'A' }),
  );

  const res = await handleRequest(
    db,
    'chat',
    {
      model: 'my-gpt',
      messages: [{ role: 'user', content: 'x' }],
    },
    makeRunner(async () => {
      const e = new Error('server error') as Error & { statusCode?: number };
      e.statusCode = 500;
      throw e;
    }),
  );
  expect(res.status).toBe(502);
  db.close();
});
