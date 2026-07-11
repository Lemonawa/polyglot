import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';

test('migrate creates all five tables and is idempotent', () => {
  const db = openDb(':memory:');
  migrate(db);
  migrate(db); // 第二次不应抛错

  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = rows.map((r) => r.name);
  expect(names).toContain('logical_models');
  expect(names).toContain('providers');
  expect(names).toContain('request_logs');
  expect(names).toContain('budgets');
  expect(names).toContain('models_dev_cache');
  db.close();
});

test('foreign keys are enabled', () => {
  const db = openDb(':memory:');
  const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  expect(fk.foreign_keys).toBe(1);
  db.close();
});
