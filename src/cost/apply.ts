import type Database from 'better-sqlite3';
import { computeCost, lookupPrice } from './pricing.js';
import type { BudgetStatus } from './budget.js';
import type { Provider, TokenUsage } from '../types.js';

export function costForProvider(
  db: Database.Database,
  provider: Provider | null,
  usage: TokenUsage,
): number {
  if (!provider?.models_dev_id) return 0;
  const price = lookupPrice(db, provider.models_dev_id);
  if (!price) return 0;
  return computeCost(price, usage);
}

export function blockingBudget(statuses: BudgetStatus[]): BudgetStatus | null {
  return statuses.find((s) => s.over && s.action === 'block') ?? null;
}
