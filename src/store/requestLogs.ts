import type Database from 'better-sqlite3';
import type { RequestLog } from '../types.js';

export type RequestLogInput = Omit<RequestLog, 'id' | 'created_at'>;

export function insertRequestLog(db: Database.Database, input: RequestLogInput): RequestLog {
  const created_at = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO request_logs
        (logical_model_id, hit_provider_id, client_format, upstream_format,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
         cost_usd, latency_ms, status, error, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.logical_model_id, input.hit_provider_id, input.client_format, input.upstream_format,
      input.input_tokens, input.output_tokens, input.cache_read_tokens, input.cache_write_tokens,
      input.cost_usd, input.latency_ms, input.status, input.error, input.attempts, created_at,
    );
  return { id: Number(info.lastInsertRowid), created_at, ...input };
}

export function listRequestLogs(
  db: Database.Database,
  opts: { logicalModelId?: number; limit?: number; offset?: number } = {},
): RequestLog[] {
  const { logicalModelId, limit = 100, offset = 0 } = opts;
  if (logicalModelId !== undefined) {
    return db
      .prepare(
        'SELECT * FROM request_logs WHERE logical_model_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
      )
      .all(logicalModelId, limit, offset) as RequestLog[];
  }
  return db
    .prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as RequestLog[];
}
