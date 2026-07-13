import type Database from 'better-sqlite3';
import { getLogicalModelByName } from '../store/logicalModels.js';
import { listProvidersByModelId } from '../store/providers.js';
import type { Provider } from '../types.js';

export function resolveChain(
  db: Database.Database,
  logicalModelName: string,
): Provider[] {
  const model = getLogicalModelByName(db, logicalModelName);
  if (!model) return [];
  return listProvidersByModelId(db, model.id).filter((p) => p.enabled);
}
