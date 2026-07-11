import type Database from 'better-sqlite3';

export function saveModelsDevCache(db: Database.Database, data: string, fetchedAt: string): void {
  db.prepare(
    `INSERT INTO models_dev_cache (id, data, fetched_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
  ).run(data, fetchedAt);
}

export function readModelsDevCache(
  db: Database.Database,
): { data: string; fetched_at: string } | null {
  const row = db.prepare('SELECT data, fetched_at FROM models_dev_cache WHERE id = 1').get() as
    | { data: string; fetched_at: string }
    | undefined;
  return row ?? null;
}
