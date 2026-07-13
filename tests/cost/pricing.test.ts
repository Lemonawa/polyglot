import { expect, test } from 'vitest';
import { refreshModelsDev } from '../../src/cost/modelsDev.js';
import { computeCost, lookupPrice } from '../../src/cost/pricing.js';
import { migrate, openDb } from '../../src/store/db.js';
import type { UnitPrice } from '../../src/types.js';

const sample = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-sonnet-4': {
        id: 'claude-sonnet-4',
        cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
    },
  },
};

function fakeFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(sample), {
      status: 200,
    })) as unknown as typeof fetch;
}

async function seeded() {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  return db;
}

test('lookupPrice by provider/model form', async () => {
  const db = await seeded();
  const price = lookupPrice(db, 'anthropic/claude-sonnet-4');
  expect(price).toEqual({
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write: 3.75,
  });
  db.close();
});

test('lookupPrice by bare model key', async () => {
  const db = await seeded();
  expect(lookupPrice(db, 'claude-sonnet-4')?.input).toBe(3);
  db.close();
});

test('lookupPrice returns null for unknown id', async () => {
  const db = await seeded();
  expect(lookupPrice(db, 'nope/nope')).toBeNull();
  db.close();
});

test('computeCost sums four token classes per million', () => {
  const price: UnitPrice = {
    input: 3,
    output: 15,
    cache_read: 0.3,
    cache_write: 3.75,
  };
  // 1000 input @ $3/1M = 0.003; 500 output @ $15/1M = 0.0075; 2000 cache_read @0.3 = 0.0006; 0 cache_write
  const cost = computeCost(price, {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 2000,
    cache_write_tokens: 0,
  });
  expect(cost).toBeCloseTo(0.003 + 0.0075 + 0.0006, 10);
});
