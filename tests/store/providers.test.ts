import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createLogicalModel } from '../../src/store/logicalModels.js';
import {
  createProvider,
  deleteProvider,
  listProvidersByModelId,
  type ProviderInput,
  updateProvider,
} from '../../src/store/providers.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'm');
  return { db, model };
}

function input(over: Partial<ProviderInput> = {}): ProviderInput {
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

test('create round-trips JSON codes and boolean', () => {
  const { db, model } = setup();
  const p = createProvider(
    db,
    input({
      logical_model_id: model.id,
      fallback_status_codes: [402, 403],
      enabled: false,
    }),
  );
  expect(p.id).toBeGreaterThan(0);
  expect(p.fallback_status_codes).toEqual([402, 403]);
  expect(p.enabled).toBe(false);
  const list = listProvidersByModelId(db, model.id);
  expect(list[0].fallback_status_codes).toEqual([402, 403]);
  expect(list[0].enabled).toBe(false);
  db.close();
});

test('list ordered by priority ascending', () => {
  const { db, model } = setup();
  createProvider(
    db,
    input({ logical_model_id: model.id, priority: 2, upstream_model: 'c' }),
  );
  createProvider(
    db,
    input({ logical_model_id: model.id, priority: 0, upstream_model: 'a' }),
  );
  createProvider(
    db,
    input({ logical_model_id: model.id, priority: 1, upstream_model: 'b' }),
  );
  expect(
    listProvidersByModelId(db, model.id).map((p) => p.upstream_model),
  ).toEqual(['a', 'b', 'c']);
  db.close();
});

test('update and delete', () => {
  const { db, model } = setup();
  const p = createProvider(db, input({ logical_model_id: model.id }));
  updateProvider(db, p.id, { priority: 5, enabled: false });
  const got = listProvidersByModelId(db, model.id)[0];
  expect(got.priority).toBe(5);
  expect(got.enabled).toBe(false);
  deleteProvider(db, p.id);
  expect(listProvidersByModelId(db, model.id)).toEqual([]);
  db.close();
});
