import type Database from 'better-sqlite3';
import type { LogicalModel } from '../types.js';

export function createLogicalModel(
  db: Database.Database,
  name: string,
): LogicalModel {
  const created_at = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO logical_models (name, created_at) VALUES (?, ?)')
    .run(name, created_at);
  return { id: Number(info.lastInsertRowid), name, created_at };
}

export function getLogicalModelByName(
  db: Database.Database,
  name: string,
): LogicalModel | null {
  const row = db
    .prepare('SELECT * FROM logical_models WHERE name = ?')
    .get(name) as LogicalModel | undefined;
  return row ?? null;
}

export function getLogicalModelById(
  db: Database.Database,
  id: number,
): LogicalModel | null {
  const row = db.prepare('SELECT * FROM logical_models WHERE id = ?').get(id) as
    | LogicalModel
    | undefined;
  return row ?? null;
}

export function listLogicalModels(db: Database.Database): LogicalModel[] {
  return db
    .prepare('SELECT * FROM logical_models ORDER BY name')
    .all() as LogicalModel[];
}

export function deleteLogicalModel(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM logical_models WHERE id = ?').run(id);
}
