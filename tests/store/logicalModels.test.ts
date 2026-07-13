import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import {
  createLogicalModel,
  deleteLogicalModel,
  getLogicalModelByName,
  listLogicalModels,
} from '../../src/store/logicalModels.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('create then read by name', () => {
  const db = freshDb();
  const created = createLogicalModel(db, 'my-sonnet');
  expect(created.id).toBeGreaterThan(0);
  expect(created.name).toBe('my-sonnet');
  expect(created.created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);

  const found = getLogicalModelByName(db, 'my-sonnet');
  expect(found?.id).toBe(created.id);
  db.close();
});

test('list and delete', () => {
  const db = freshDb();
  createLogicalModel(db, 'a');
  const b = createLogicalModel(db, 'b');
  expect(
    listLogicalModels(db)
      .map((m) => m.name)
      .sort(),
  ).toEqual(['a', 'b']);
  deleteLogicalModel(db, b.id);
  expect(listLogicalModels(db).map((m) => m.name)).toEqual(['a']);
  db.close();
});

test('getByName returns null when absent', () => {
  const db = freshDb();
  expect(getLogicalModelByName(db, 'nope')).toBeNull();
  db.close();
});
