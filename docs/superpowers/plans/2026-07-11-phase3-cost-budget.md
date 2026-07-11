# 阶段 3：成本与预算 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给转发器加上成本观测与预算上限：按 models.dev 官方价计算每次请求成本，写入 request_logs；请求前检查预算，block 模式超限拒绝、warn 模式告警。

**Architecture:** `cost/modelsDev.ts` 拉取并缓存 models.dev 价目；`cost/pricing.ts` 查价并按四类 token 计算美元成本；`cost/budget.ts` 按周期汇总 request_logs 与预算比较；集成到阶段 2 的 `handleRequest`：请求前查预算、请求后算成本写日志。

**Tech Stack:** TypeScript 7.0（strict）、better-sqlite3、`fetch`（Node ≥ 22 原生）、vitest。依赖阶段 1、2 已完成。

## Global Constraints

- 依赖阶段 1、2 交付：`store/*`、`cost/*` 目录、`convert.ts` 的 `handleRequest`、`request_logs` 写入点已存在。
- 成本 = Σ(各类 token × 对应单价 / 1e6)，直接用 models.dev 官方价，**不做 ratio、不做手填覆盖**（第一版）。
- 单价四类对齐 models.dev 的 `cost`：`input`/`output`/`cache_read`/`cache_write`（每百万 token 美元价）。
- models.dev 结构：顶层按 provider 分组，每 provider 有 `models` map，key 是模型 id，value 含 `cost` 与 `limit`。`models_dev_id`（如 `anthropic/claude-sonnet-4`）= `<provider>/<modelKey>` 或直接是 models map 的 key，实现里两种查找都支持。
- 预算作用域 global / logical_model；周期 day / month / total；action warn / block。
- TDD、DRY、YAGNI、Conventional Commits。严格遵守 `00-shared-contract.md` 的签名（`computeCost`/`lookupPrice`/`checkBudgets`/`BudgetStatus`），不得改名。

---

### Task 1: models.dev 拉取与缓存

**Files:**
- Create: `src/cost/modelsDev.ts`
- Test: `tests/cost/modelsDev.test.ts`

**Interfaces:**
- Consumes: `saveModelsDevCache`/`readModelsDevCache`（阶段1 store）
- Produces:
  - `refreshModelsDev(db, fetchImpl?: typeof fetch, now?: () => string): Promise<void>` —— 拉取 `https://models.dev/api.json`，存入缓存（`fetchImpl`/`now` 可注入用于测试）。
  - `getCachedData(db): Record<string, unknown> | null` —— 读缓存并 JSON.parse。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/cost/modelsDev.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { getCachedData, refreshModelsDev } from '../../src/cost/modelsDev.js';

const sample = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-sonnet-4': { id: 'claude-sonnet-4', cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }, limit: { context: 200000, output: 64000 } },
    },
  },
};

function fakeFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
}

test('refresh stores parsed models.dev data', async () => {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  const data = getCachedData(db) as typeof sample;
  expect(data.anthropic.models['claude-sonnet-4'].cost.input).toBe(3);
  db.close();
});

test('getCachedData returns null when empty', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(getCachedData(db)).toBeNull();
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/cost/modelsDev.test.ts`
Expected: FAIL —— 找不到模块 `../../src/cost/modelsDev.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/cost/modelsDev.ts
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
  JSON.parse(text); // 校验合法 JSON, 非法则抛错
  saveModelsDevCache(db, text, now());
}

export function getCachedData(db: Database.Database): Record<string, unknown> | null {
  const cached = readModelsDevCache(db);
  if (!cached) return null;
  return JSON.parse(cached.data) as Record<string, unknown>;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/cost/modelsDev.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/cost/modelsDev.ts tests/cost/modelsDev.test.ts
git commit -m "feat: fetch and cache models.dev pricing data"
```

---

### Task 2: 查价与成本计算

**Files:**
- Create: `src/cost/pricing.ts`
- Test: `tests/cost/pricing.test.ts`

**Interfaces:**
- Consumes: `getCachedData`（Task 1）、`UnitPrice`/`TokenUsage`（`src/types.ts`）
- Produces:
  - `lookupPrice(db, modelsDevId: string): UnitPrice | null` —— 在缓存里查 `modelsDevId`。支持两种形态：`<provider>/<modelKey>`（拆开查 `data[provider].models[modelKey]`）或直接遍历所有 provider 的 models 找 key 匹配。缺字段按 0 计。
  - `computeCost(price: UnitPrice, usage: TokenUsage): number` —— `(input×price.input + output×price.output + cache_read×price.cache_read + cache_write×price.cache_write) / 1e6`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/cost/pricing.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { refreshModelsDev } from '../../src/cost/modelsDev.js';
import { computeCost, lookupPrice } from '../../src/cost/pricing.js';
import type { UnitPrice } from '../../src/types.js';

const sample = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-sonnet-4': { id: 'claude-sonnet-4', cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } },
    },
  },
};

function fakeFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
}

async function seeded() {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  return db;
}

test('lookupPrice by provider/model form', async () => {
  const db = await seeded();
  const price = lookupPrice(db, 'anthropic/claude-sonnet-4');
  expect(price).toEqual({ input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 });
  db.close();
});

test('lookupPrice by bare model key', async () => {
  const db = await seeded();
  expect(lookupPrice(db, 'claude-sonnet-4')?.input).toBe(3);
  db.close();
});

test('lookupPrice returns null for unknown id', async () => {
  const db = await seeded();
  expect(lookupPrice(db, 'nope/nope')).toBeNull();
  db.close();
});

test('computeCost sums four token classes per million', () => {
  const price: UnitPrice = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 };
  // 1000 input @ $3/1M = 0.003; 500 output @ $15/1M = 0.0075; 2000 cache_read @0.3 = 0.0006; 0 cache_write
  const cost = computeCost(price, { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 2000, cache_write_tokens: 0 });
  expect(cost).toBeCloseTo(0.003 + 0.0075 + 0.0006, 10);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/cost/pricing.test.ts`
Expected: FAIL —— 找不到模块 `../../src/cost/pricing.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/cost/pricing.ts
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

  // 形态 1: "<provider>/<modelKey>"
  const slash = modelsDevId.indexOf('/');
  if (slash !== -1) {
    const provider = modelsDevId.slice(0, slash);
    const modelKey = modelsDevId.slice(slash + 1);
    const model = data[provider]?.models?.[modelKey];
    if (model) return toUnitPrice(model.cost);
  }

  // 形态 2: 裸 modelKey, 遍历所有 provider
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/cost/pricing.test.ts`
Expected: PASS —— 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/cost/pricing.ts tests/cost/pricing.test.ts
git commit -m "feat: look up models.dev price and compute cost per request"
```

---

### Task 3: 预算检查

**Files:**
- Create: `src/cost/budget.ts`
- Test: `tests/cost/budget.test.ts`

**Interfaces:**
- Consumes: `listBudgets`（阶段1）、`Budget`/`BudgetAction`（`src/types.ts`）、`request_logs` 表
- Produces:
  - `interface BudgetStatus { budget: Budget; spent_usd: number; limit_usd: number; action: BudgetAction; over: boolean }`
  - `periodStart(period: BudgetPeriod, now: Date): string | null` —— day→当天 00:00 UTC ISO；month→当月 1 号 00:00 UTC ISO；total→null（不设下界）。
  - `spentSince(db, sinceIso: string | null, logicalModelId?: number): number` —— 汇总 request_logs.cost_usd。
  - `checkBudgets(db, logicalModelId: number, now?: Date): BudgetStatus[]` —— 取所有 global 预算 + 该逻辑模型的 logical_model 预算，各自按周期算已花与上限比较。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/cost/budget.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createBudget } from '../../src/store/budgets.js';
import { insertRequestLog } from '../../src/store/requestLogs.js';
import { checkBudgets } from '../../src/cost/budget.js';

function logCost(db: ReturnType<typeof openDb>, modelId: number, cost: number) {
  insertRequestLog(db, {
    logical_model_id: modelId, hit_provider_id: 1, client_format: 'chat', upstream_format: 'chat',
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: cost, latency_ms: 1, status: 'success', error: null, attempts: 1,
  });
}

test('global total budget flags over when spent exceeds limit', () => {
  const db = openDb(':memory:');
  migrate(db);
  createBudget(db, { scope: 'global', target_id: null, limit_usd: 1, period: 'total', action: 'block' });
  logCost(db, 5, 0.6);
  logCost(db, 5, 0.6);
  const statuses = checkBudgets(db, 5);
  expect(statuses.length).toBe(1);
  expect(statuses[0].spent_usd).toBeCloseTo(1.2, 10);
  expect(statuses[0].over).toBe(true);
  expect(statuses[0].action).toBe('block');
  db.close();
});

test('logical_model budget only counts that model, not over when under limit', () => {
  const db = openDb(':memory:');
  migrate(db);
  createBudget(db, { scope: 'logical_model', target_id: 7, limit_usd: 10, period: 'total', action: 'warn' });
  logCost(db, 7, 3);
  logCost(db, 8, 100); // 别的模型不计入
  const statuses = checkBudgets(db, 7);
  expect(statuses[0].spent_usd).toBeCloseTo(3, 10);
  expect(statuses[0].over).toBe(false);
  db.close();
});

test('no budgets -> empty statuses', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(checkBudgets(db, 1)).toEqual([]);
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/cost/budget.test.ts`
Expected: FAIL —— 找不到模块 `../../src/cost/budget.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/cost/budget.ts
import type Database from 'better-sqlite3';
import { listBudgets } from '../store/budgets.js';
import type { Budget, BudgetAction, BudgetPeriod } from '../types.js';

export interface BudgetStatus {
  budget: Budget;
  spent_usd: number;
  limit_usd: number;
  action: BudgetAction;
  over: boolean;
}

export function periodStart(period: BudgetPeriod, now: Date): string | null {
  if (period === 'total') return null;
  if (period === 'day') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  // month
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function spentSince(
  db: Database.Database,
  sinceIso: string | null,
  logicalModelId?: number,
): number {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (sinceIso !== null) {
    clauses.push('created_at >= ?');
    values.push(sinceIso);
  }
  if (logicalModelId !== undefined) {
    clauses.push('logical_model_id = ?');
    values.push(logicalModelId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const row = db
    .prepare(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM request_logs ${where}`)
    .get(...values) as { total: number };
  return row.total;
}

export function checkBudgets(
  db: Database.Database,
  logicalModelId: number,
  now: Date = new Date(),
): BudgetStatus[] {
  const budgets = [
    ...listBudgets(db, { scope: 'global' }),
    ...listBudgets(db, { scope: 'logical_model', targetId: logicalModelId }),
  ];
  return budgets.map((budget) => {
    const since = periodStart(budget.period, now);
    const scopeModelId = budget.scope === 'logical_model' ? logicalModelId : undefined;
    const spent = spentSince(db, since, scopeModelId);
    return {
      budget,
      spent_usd: spent,
      limit_usd: budget.limit_usd,
      action: budget.action,
      over: spent >= budget.limit_usd,
    };
  });
}
```

> 注：`checkBudgets` 用 `new Date()` 默认参数，测试用 `total` 周期避免时间依赖；`day`/`month` 的边界逻辑由 `periodStart` 单独覆盖（可在实现阶段补一个纯函数测试）。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/cost/budget.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/cost/budget.ts tests/cost/budget.test.ts
git commit -m "feat: budget checking with period aggregation"
```

---

### Task 4: 把成本与预算接入请求流程

**Files:**
- Create: `src/cost/apply.ts`
- Modify: `src/convert.ts`
- Test: `tests/cost/apply.test.ts`
- Test: `tests/convert-budget.test.ts`

**Interfaces:**
- Consumes: `checkBudgets`/`BudgetStatus`（Task 3）、`lookupPrice`/`computeCost`（Task 2）、`Provider`/`TokenUsage`（`src/types.ts`）
- Produces:
  - `costForProvider(db, provider: Provider | null, usage: TokenUsage): number` —— provider 有 `models_dev_id` 且缓存查得到价则算成本，否则 0。
  - `blockingBudget(statuses: BudgetStatus[]): BudgetStatus | null` —— 返回第一个 `over && action==='block'` 的预算，否则 null。
  - `convert.ts` 集成：`handleRequest` 开头解析出逻辑模型后、发请求前调用 `checkBudgets`；若有 blocking 预算返回 402；请求后用 `costForProvider` 替换所有 `cost_usd: 0`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/cost/apply.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { refreshModelsDev } from '../../src/cost/modelsDev.js';
import { blockingBudget, costForProvider } from '../../src/cost/apply.js';
import type { BudgetStatus } from '../../src/cost/budget.js';
import type { Budget, Provider } from '../../src/types.js';

const sample = { anthropic: { id: 'anthropic', models: { 'claude-sonnet-4': { cost: { input: 3, output: 15, cache_read: 0, cache_write: 0 } } } } };
function fakeFetch(): typeof fetch {
  return (async () => new Response(JSON.stringify(sample), { status: 200 })) as unknown as typeof fetch;
}
function provider(over: Partial<Provider> = {}): Provider {
  return { id: 1, logical_model_id: 1, priority: 0, upstream_format: 'anthropic', base_url: 'x', api_key: 'k', upstream_model: 'claude-sonnet-4', models_dev_id: 'anthropic/claude-sonnet-4', fallback_status_codes: [], enabled: true, ...over };
}

test('costForProvider computes from models.dev price', async () => {
  const db = openDb(':memory:');
  migrate(db);
  await refreshModelsDev(db, fakeFetch(), () => '2026-07-11T00:00:00.000Z');
  const cost = costForProvider(db, provider(), { input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBeCloseTo(0.003 + 0.015, 10);
  db.close();
});

test('costForProvider returns 0 when no models_dev_id', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const cost = costForProvider(db, provider({ models_dev_id: null }), { input_tokens: 1000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
  expect(cost).toBe(0);
  db.close();
});

test('blockingBudget finds first over+block', () => {
  const b = (over: boolean, action: 'warn' | 'block'): BudgetStatus => ({
    budget: {} as Budget, spent_usd: 1, limit_usd: 1, action, over,
  });
  expect(blockingBudget([b(true, 'warn'), b(true, 'block')])?.action).toBe('block');
  expect(blockingBudget([b(false, 'block'), b(true, 'warn')])).toBeNull();
});
```

```typescript
// tests/convert-budget.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { createBudget } from '../src/store/budgets.js';
import { insertRequestLog } from '../src/store/requestLogs.js';
import { handleRequest } from '../src/convert.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return { logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'x', api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [], enabled: true, ...over };
}

test('blocking budget over limit returns 402 before calling upstream', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const m = createLogicalModel(db, 'my-gpt');
  createProvider(db, input({ logical_model_id: m.id }));
  createBudget(db, { scope: 'logical_model', target_id: m.id, limit_usd: 0.001, period: 'total', action: 'block' });
  insertRequestLog(db, { logical_model_id: m.id, hit_provider_id: 1, client_format: 'chat', upstream_format: 'chat', input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.005, latency_ms: 1, status: 'success', error: null, attempts: 1 });

  const res = await handleRequest(db, 'chat', { model: 'my-gpt', messages: [{ role: 'user', content: 'hi' }] });
  expect(res.status).toBe(402);
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/cost/apply.test.ts tests/convert-budget.test.ts`
Expected: FAIL —— 找不到模块 `../../src/cost/apply.js`；`handleRequest` 尚未做预算拦截（402 断言失败）。

- [ ] **Step 3: 写实现**

```typescript
// src/cost/apply.ts
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
```

在 `src/convert.ts` 的 `handleRequest` 中集成（改动点，其余保留）：

```typescript
// src/convert.ts (在 imports 增加)
import { checkBudgets } from './cost/budget.js';
import { blockingBudget, costForProvider } from './cost/apply.js';
```

```typescript
// src/convert.ts —— 在解析出 chain、拿到 logicalModelId 之后，发请求之前插入预算拦截:
  const logicalModelId = chain[0].logical_model_id;

  const budgetStatuses = checkBudgets(db, logicalModelId);
  const blocking = blockingBudget(budgetStatuses);
  if (blocking) {
    return new Response(
      JSON.stringify({
        error: {
          message: `budget exceeded: spent $${blocking.spent_usd.toFixed(4)} >= limit $${blocking.limit_usd.toFixed(4)}`,
          type: 'budget_exceeded',
        },
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  }

  const start = Date.now();
```

```typescript
// src/convert.ts —— 把三处 insertRequestLog 中的 cost_usd: 0 替换为实际成本:
//   1) 流式成功 (resultPromise.then): 用命中 provider (即 chain[0]/provider) 与 result.usage
//        cost_usd: costForProvider(db, provider, result.usage),
//   2) 非流式成功 (run.value): 用 run.outcome.provider 与 run.value.usage
//        cost_usd: costForProvider(db, run.outcome.provider, run.value.usage),
//   3) 失败分支保持 cost_usd: 0 (无 usage)
```

> 实现要点：流式成功分支里，`provider` 变量即 `chain[0]`（流式只用首个 provider），把 `cost_usd: 0` 改为 `costForProvider(db, provider, result.usage)`；非流式成功分支把 `cost_usd: 0` 改为 `costForProvider(db, run.outcome.provider, run.value.usage)`。失败分支无 usage，维持 0。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run && npm run typecheck`
Expected: PASS —— 全部测试通过（含阶段1、2）；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/cost/apply.ts src/convert.ts tests/cost/apply.test.ts tests/convert-budget.test.ts
git commit -m "feat: apply cost and budget enforcement to request flow"
```

---

## 阶段 3 完成标准

- `npm test` 全绿；`npm run typecheck` 无错误。
- 每次请求按 models.dev 官方价算出 `cost_usd` 写入 request_logs（有 `models_dev_id` 时）。
- 请求前检查预算，block 模式超限返回 402、不打上游；warn 模式记录状态不拦截。
- `refreshModelsDev` 可手动触发刷新价目缓存（阶段4 admin 暴露触发按钮）。
