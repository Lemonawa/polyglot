import Database from 'better-sqlite3';

export function openDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logical_models (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      logical_model_id      INTEGER NOT NULL REFERENCES logical_models(id) ON DELETE CASCADE,
      priority              INTEGER NOT NULL DEFAULT 0,
      upstream_format       TEXT NOT NULL,
      base_url              TEXT NOT NULL,
      api_key               TEXT NOT NULL,
      upstream_model        TEXT NOT NULL,
      models_dev_id         TEXT,
      fallback_status_codes TEXT NOT NULL DEFAULT '[]',
      enabled               INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_providers_model ON providers(logical_model_id, priority);

    CREATE TABLE IF NOT EXISTS request_logs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      logical_model_id   INTEGER NOT NULL,
      hit_provider_id    INTEGER,
      client_format      TEXT NOT NULL,
      upstream_format    TEXT,
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      output_tokens      INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd           REAL NOT NULL DEFAULT 0,
      latency_ms         INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL,
      error              TEXT,
      attempts           INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_model_time ON request_logs(logical_model_id, created_at);

    CREATE TABLE IF NOT EXISTS budgets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      target_id  INTEGER,
      limit_usd  REAL NOT NULL,
      period     TEXT NOT NULL,
      action     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS models_dev_cache (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data       TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
  `);
}
