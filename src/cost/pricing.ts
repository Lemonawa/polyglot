import type Database from 'better-sqlite3';
import { getCachedData } from './modelsDev.js';
import type { TokenUsage, UnitPrice } from '../types.js';

interface RawCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}
interface RawModel {
  cost?: RawCost;
}
interface RawProvider {
  models?: Record<string, RawModel>;
}

function toUnitPrice(cost: RawCost | undefined): UnitPrice {
  return {
    input: cost?.input ?? 0,
    output: cost?.output ?? 0,
    cache_read: cost?.cache_read ?? 0,
    cache_write: cost?.cache_write ?? 0,
  };
}

export function lookupPrice(db: Database.Database, modelsDevId: string): UnitPrice | null {
  const data = getCachedData(db) as Record<string, RawProvider> | null;
  if (!data) return null;

  // Form 1: "<provider>/<modelKey>"
  const slash = modelsDevId.indexOf('/');
  if (slash !== -1) {
    const provider = modelsDevId.slice(0, slash);
    const modelKey = modelsDevId.slice(slash + 1);
    const model = data[provider]?.models?.[modelKey];
    if (model) return toUnitPrice(model.cost);
  }

  // Form 2: bare modelKey, scan all providers
  for (const provider of Object.values(data)) {
    const model = provider.models?.[modelsDevId];
    if (model) return toUnitPrice(model.cost);
  }
  return null;
}

export function computeCost(price: UnitPrice, usage: TokenUsage): number {
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      usage.cache_read_tokens * price.cache_read +
      usage.cache_write_tokens * price.cache_write) /
    1_000_000
  );
}
