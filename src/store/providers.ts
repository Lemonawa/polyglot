import type Database from 'better-sqlite3';
import type { Provider } from '../types.js';

export type ProviderInput = Omit<Provider, 'id'>;

interface ProviderRow {
  id: number;
  logical_model_id: number;
  priority: number;
  upstream_format: string;
  base_url: string;
  api_key: string;
  upstream_model: string;
  models_dev_id: string | null;
  fallback_status_codes: string;
  enabled: number;
}

export function rowToProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    logical_model_id: row.logical_model_id,
    priority: row.priority,
    upstream_format: row.upstream_format as Provider['upstream_format'],
    base_url: row.base_url,
    api_key: row.api_key,
    upstream_model: row.upstream_model,
    models_dev_id: row.models_dev_id,
    fallback_status_codes: JSON.parse(row.fallback_status_codes) as number[],
    enabled: row.enabled === 1,
  };
}

export function createProvider(db: Database.Database, input: ProviderInput): Provider {
  const info = db
    .prepare(
      `INSERT INTO providers
        (logical_model_id, priority, upstream_format, base_url, api_key, upstream_model,
         models_dev_id, fallback_status_codes, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.logical_model_id,
      input.priority,
      input.upstream_format,
      input.base_url,
      input.api_key,
      input.upstream_model,
      input.models_dev_id,
      JSON.stringify(input.fallback_status_codes),
      input.enabled ? 1 : 0,
    );
  return { id: Number(info.lastInsertRowid), ...input };
}

export function listProvidersByModelId(db: Database.Database, logicalModelId: number): Provider[] {
  const rows = db
    .prepare('SELECT * FROM providers WHERE logical_model_id = ? ORDER BY priority ASC, id ASC')
    .all(logicalModelId) as ProviderRow[];
  return rows.map(rowToProvider);
}

export function updateProvider(
  db: Database.Database,
  id: number,
  patch: Partial<ProviderInput>,
): void {
  const ALLOWED = new Set<string>(['priority','upstream_format','base_url','api_key','upstream_model','models_dev_id','fallback_status_codes','enabled']);
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!ALLOWED.has(key)) continue;
    fields.push(`${key} = ?`);
    if (key === 'fallback_status_codes') values.push(JSON.stringify(value));
    else if (key === 'enabled') values.push(value ? 1 : 0);
    else values.push(value);
  }
  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteProvider(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM providers WHERE id = ?').run(id);
}
