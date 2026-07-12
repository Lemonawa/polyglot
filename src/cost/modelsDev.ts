import type Database from 'better-sqlite3';
import { readModelsDevCache, saveModelsDevCache } from '../store/modelsDevCache.js';

const MODELS_DEV_URL = 'https://models.dev/api.json';

export async function refreshModelsDev(
  db: Database.Database,
  fetchImpl: typeof fetch = fetch,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const res = await fetchImpl(MODELS_DEV_URL);
  if (!res.ok) throw new Error(`models.dev fetch failed: ${res.status}`);
  const text = await res.text();
  JSON.parse(text); // validate JSON, throws on invalid
  saveModelsDevCache(db, text, now());
}

export function getCachedData(db: Database.Database): Record<string, unknown> | null {
  const cached = readModelsDevCache(db);
  if (!cached) return null;
  try {
    return JSON.parse(cached.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}
