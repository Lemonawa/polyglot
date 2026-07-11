import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createLogicalModel } from '../../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../../src/store/providers.js';
import { resolveChain } from '../../src/router/resolve.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return {
    logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'https://x/v1',
    api_key: 'k', upstream_model: 'm', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

test('returns enabled providers ordered by priority', () => {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'my-sonnet');
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'second' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'first' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 2, upstream_model: 'disabled', enabled: false }));

  const chain = resolveChain(db, 'my-sonnet');
  expect(chain.map((p) => p.upstream_model)).toEqual(['first', 'second']);
  db.close();
});

test('unknown model returns empty chain', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(resolveChain(db, 'nope')).toEqual([]);
  db.close();
});
