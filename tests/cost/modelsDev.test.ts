import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { getCachedData, refreshModelsDev } from '../../src/cost/modelsDev.js';

const sample = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-sonnet-4': { id: 'claude-sonnet-4', cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }, limit: { context: 200000, output: 64000 } },
    },
  },
};

function fakeFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
}

test('refresh stores parsed models.dev data', async () => {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  const data = getCachedData(db) as typeof sample;
  expect(data.anthropic.models['claude-sonnet-4'].cost.input).toBe(3);
  db.close();
});

test('getCachedData returns null when empty', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(getCachedData(db)).toBeNull();
  db.close();
});
