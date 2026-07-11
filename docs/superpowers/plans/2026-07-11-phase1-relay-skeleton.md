# 阶段 1：最小可用转发骨架 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出一个能真正运行的 AI 转发器骨架：请求打到逻辑模型 → 解析 provider 链 → 依次尝试、失败降级 → 同格式（chat→chat）转发并返回（含流式）。

**Architecture:** Hono HTTP 入口暴露 `/v1/chat/completions`；SQLite（better-sqlite3）存逻辑模型与 provider 链；router 按 priority 解析链并执行 fallback；outbound 用 AI SDK 7 由 provider 配置构造 LanguageModel 并透传请求。本阶段只做同格式直传，不做格式转换/成本/admin。

**Tech Stack:** TypeScript 7.0（strict）、Node ≥ 22、ESM、Hono + @hono/node-server、better-sqlite3、AI SDK 7（`ai` / `@ai-sdk/openai` / `@ai-sdk/anthropic`）、vitest、tsx、biome。

## Global Constraints

- Node ≥ 22，TypeScript 7.0，ESM（`"type": "module"`），strict 模式。
- 不引入 typescript-eslint（TS 7.0 无稳定编程式 API，尚不兼容）；lint/format 用 biome。
- SQLite：布尔存 0/1，数组/对象存 JSON TEXT，读出时在 store 层转换成 `src/types.ts` 类型。
- 金额单位统一美元，`cost_usd` 浮点；本阶段 request_logs 成本字段一律填 0（阶段 3 补）。
- 每个任务遵循 TDD：先写失败测试 → 验证失败 → 最小实现 → 验证通过 → 提交。
- 提交用 Conventional Commits（`feat:` / `test:` / `chore:`）。
- 严格遵守 `docs/superpowers/plans/00-shared-contract.md` 的类型名、函数签名、目录结构，不得改名。

---

### Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `biome.json`
- Create: `.gitignore`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 可运行的 `npm test`（vitest）、`npm run typecheck`（tsc --noEmit）、`npm run build`（tsc）脚手架。

- [ ] **Step 1: 写冒烟测试**

```typescript
// tests/smoke.test.ts
import { expect, test } from 'vitest';

test('vitest runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npm test`
Expected: FAIL —— 命令不存在或无 vitest（尚未建 package.json）。

- [ ] **Step 3: 写脚手架文件**

```json
// package.json
{
  "name": "polyglot",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "lint": "biome check .",
    "format": "biome format --write ."
  },
  "dependencies": {
    "ai": "^7.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^7.0.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@biomejs/biome": "^1.9.0"
  }
}
```

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

```json
// biome.json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 }
}
```

```gitignore
# .gitignore
node_modules/
dist/
*.sqlite
*.sqlite-journal
.env
```

- [ ] **Step 4: 安装依赖并跑测试验证通过**

Run: `npm install && npm test`
Expected: PASS —— `tests/smoke.test.ts` 1 passed。

- [ ] **Step 5: 提交**

```bash
git add package.json tsconfig.json vitest.config.ts biome.json .gitignore tests/smoke.test.ts
git commit -m "chore: scaffold project (TS7, AI SDK 7, hono, sqlite, vitest, biome)"
```

---

### Task 2: 全局共享类型

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `WireFormat`、`LogicalModel`、`Provider`、`RequestLog`、`Budget`（含 `BudgetScope`/`BudgetPeriod`/`BudgetAction`）、`TokenUsage`、`UnitPrice` —— 后续所有任务与阶段共享。

- [ ] **Step 1: 写失败测试**

类型是编译期构造，用一个「构造合法对象」的运行时测试锁定字段名与形态：

```typescript
// tests/types.test.ts
import { expect, test } from 'vitest';
import type { Budget, Provider, TokenUsage } from '../src/types.js';
import { isWireFormat } from '../src/types.js';

test('Provider shape compiles and holds expected fields', () => {
  const p: Provider = {
    id: 1,
    logical_model_id: 1,
    priority: 0,
    upstream_format: 'chat',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-x',
    upstream_model: 'gpt-4o',
    models_dev_id: null,
    fallback_status_codes: [402, 403],
    enabled: true,
  };
  expect(p.fallback_status_codes).toEqual([402, 403]);
});

test('Budget scope/period/action are constrained', () => {
  const b: Budget = { id: 1, scope: 'global', target_id: null, limit_usd: 50, period: 'month', action: 'block' };
  expect(b.period).toBe('month');
});

test('TokenUsage has four token buckets', () => {
  const u: TokenUsage = { input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4 };
  expect(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens).toBe(10);
});

test('isWireFormat guards valid formats', () => {
  expect(isWireFormat('chat')).toBe(true);
  expect(isWireFormat('responses')).toBe(true);
  expect(isWireFormat('anthropic')).toBe(true);
  expect(isWireFormat('grpc')).toBe(false);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL —— 找不到模块 `../src/types.js` / `isWireFormat` 未定义。

- [ ] **Step 3: 写实现**

```typescript
// src/types.ts

// ---- 格式标识 ----
export type WireFormat = 'chat' | 'responses' | 'anthropic';

export function isWireFormat(v: unknown): v is WireFormat {
  return v === 'chat' || v === 'responses' || v === 'anthropic';
}

// ---- 数据模型行类型(与 SQLite 表一一对应) ----
export interface LogicalModel {
  id: number;
  name: string;
  created_at: string; // ISO 8601
}

export interface Provider {
  id: number;
  logical_model_id: number;
  priority: number; // 升序 = 尝试顺序
  upstream_format: WireFormat;
  base_url: string;
  api_key: string;
  upstream_model: string;
  models_dev_id: string | null;
  fallback_status_codes: number[]; // 存储为 JSON TEXT
  enabled: boolean; // 存储为 0/1
}

export interface RequestLog {
  id: number;
  logical_model_id: number;
  hit_provider_id: number | null;
  client_format: WireFormat;
  upstream_format: WireFormat | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  latency_ms: number;
  status: 'success' | 'error';
  error: string | null;
  attempts: number;
  created_at: string; // ISO 8601
}

export type BudgetScope = 'global' | 'logical_model';
export type BudgetPeriod = 'day' | 'month' | 'total';
export type BudgetAction = 'warn' | 'block';

export interface Budget {
  id: number;
  scope: BudgetScope;
  target_id: number | null;
  limit_usd: number;
  period: BudgetPeriod;
  action: BudgetAction;
}

// ---- 计价 ----
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface UnitPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/types.test.ts && npm run typecheck`
Expected: PASS —— 4 passed；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add global shared types"
```

---

### Task 3: SQLite 连接与建表迁移

**Files:**
- Create: `src/store/db.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `openDb(path: string): Database.Database` —— 打开（或创建）SQLite，启用 WAL 与外键。`path` 传 `':memory:'` 可用于测试。
  - `migrate(db: Database.Database): void` —— 幂等建表：logical_models / providers / request_logs / budgets / models_dev_cache。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/store/db.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';

test('migrate creates all five tables and is idempotent', () => {
  const db = openDb(':memory:');
  migrate(db);
  migrate(db); // 第二次不应抛错

  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = rows.map((r) => r.name);
  expect(names).toContain('logical_models');
  expect(names).toContain('providers');
  expect(names).toContain('request_logs');
  expect(names).toContain('budgets');
  expect(names).toContain('models_dev_cache');
  db.close();
});

test('foreign keys are enabled', () => {
  const db = openDb(':memory:');
  const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  expect(fk.foreign_keys).toBe(1);
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/store/db.test.ts`
Expected: FAIL —— 找不到模块 `../../src/store/db.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/store/db.ts
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/store/db.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/store/db.ts tests/store/db.test.ts
git commit -m "feat: add sqlite connection and schema migration"
```

---

### Task 4: logical_models 存储层

**Files:**
- Create: `src/store/logicalModels.ts`
- Test: `tests/store/logicalModels.test.ts`

**Interfaces:**
- Consumes: `openDb`/`migrate`（Task 3）、`LogicalModel`（Task 2）
- Produces:
  - `createLogicalModel(db, name: string): LogicalModel`
  - `getLogicalModelByName(db, name: string): LogicalModel | null`
  - `getLogicalModelById(db, id: number): LogicalModel | null`
  - `listLogicalModels(db): LogicalModel[]`
  - `deleteLogicalModel(db, id: number): void`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/store/logicalModels.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import {
  createLogicalModel,
  deleteLogicalModel,
  getLogicalModelByName,
  listLogicalModels,
} from '../../src/store/logicalModels.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('create then read by name', () => {
  const db = freshDb();
  const created = createLogicalModel(db, 'my-sonnet');
  expect(created.id).toBeGreaterThan(0);
  expect(created.name).toBe('my-sonnet');
  expect(created.created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);

  const found = getLogicalModelByName(db, 'my-sonnet');
  expect(found?.id).toBe(created.id);
  db.close();
});

test('list and delete', () => {
  const db = freshDb();
  createLogicalModel(db, 'a');
  const b = createLogicalModel(db, 'b');
  expect(listLogicalModels(db).map((m) => m.name).sort()).toEqual(['a', 'b']);
  deleteLogicalModel(db, b.id);
  expect(listLogicalModels(db).map((m) => m.name)).toEqual(['a']);
  db.close();
});

test('getByName returns null when absent', () => {
  const db = freshDb();
  expect(getLogicalModelByName(db, 'nope')).toBeNull();
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/store/logicalModels.test.ts`
Expected: FAIL —— 找不到模块 `../../src/store/logicalModels.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/store/logicalModels.ts
import type Database from 'better-sqlite3';
import type { LogicalModel } from '../types.js';

export function createLogicalModel(db: Database.Database, name: string): LogicalModel {
  const created_at = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO logical_models (name, created_at) VALUES (?, ?)')
    .run(name, created_at);
  return { id: Number(info.lastInsertRowid), name, created_at };
}

export function getLogicalModelByName(db: Database.Database, name: string): LogicalModel | null {
  const row = db.prepare('SELECT * FROM logical_models WHERE name = ?').get(name) as
    | LogicalModel
    | undefined;
  return row ?? null;
}

export function getLogicalModelById(db: Database.Database, id: number): LogicalModel | null {
  const row = db.prepare('SELECT * FROM logical_models WHERE id = ?').get(id) as
    | LogicalModel
    | undefined;
  return row ?? null;
}

export function listLogicalModels(db: Database.Database): LogicalModel[] {
  return db.prepare('SELECT * FROM logical_models ORDER BY name').all() as LogicalModel[];
}

export function deleteLogicalModel(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM logical_models WHERE id = ?').run(id);
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/store/logicalModels.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/store/logicalModels.ts tests/store/logicalModels.test.ts
git commit -m "feat: add logical_models store"
```

---

### Task 5: providers 存储层

**Files:**
- Create: `src/store/providers.ts`
- Test: `tests/store/providers.test.ts`

**Interfaces:**
- Consumes: `openDb`/`migrate`（Task 3）、`createLogicalModel`（Task 4）、`Provider`/`WireFormat`（Task 2）
- Produces:
  - `type ProviderInput = Omit<Provider, 'id'>`
  - `createProvider(db, input: ProviderInput): Provider`
  - `listProvidersByModelId(db, logicalModelId: number): Provider[]` —— 按 priority 升序返回**全部**（含 disabled）
  - `updateProvider(db, id: number, patch: Partial<ProviderInput>): void`
  - `deleteProvider(db, id: number): void`
  - `rowToProvider(row): Provider` —— 内部转换（JSON 解析 fallback_status_codes、0/1→boolean），导出供其它 store 复用。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/store/providers.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createLogicalModel } from '../../src/store/logicalModels.js';
import {
  createProvider,
  deleteProvider,
  listProvidersByModelId,
  updateProvider,
  type ProviderInput,
} from '../../src/store/providers.js';

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'm');
  return { db, model };
}

function input(over: Partial<ProviderInput> = {}): ProviderInput {
  return {
    logical_model_id: 1,
    priority: 0,
    upstream_format: 'chat',
    base_url: 'https://x/v1',
    api_key: 'k',
    upstream_model: 'gpt-4o',
    models_dev_id: null,
    fallback_status_codes: [],
    enabled: true,
    ...over,
  };
}

test('create round-trips JSON codes and boolean', () => {
  const { db, model } = setup();
  const p = createProvider(db, input({ logical_model_id: model.id, fallback_status_codes: [402, 403], enabled: false }));
  expect(p.id).toBeGreaterThan(0);
  expect(p.fallback_status_codes).toEqual([402, 403]);
  expect(p.enabled).toBe(false);
  const list = listProvidersByModelId(db, model.id);
  expect(list[0].fallback_status_codes).toEqual([402, 403]);
  expect(list[0].enabled).toBe(false);
  db.close();
});

test('list ordered by priority ascending', () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 2, upstream_model: 'c' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'a' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'b' }));
  expect(listProvidersByModelId(db, model.id).map((p) => p.upstream_model)).toEqual(['a', 'b', 'c']);
  db.close();
});

test('update and delete', () => {
  const { db, model } = setup();
  const p = createProvider(db, input({ logical_model_id: model.id }));
  updateProvider(db, p.id, { priority: 5, enabled: false });
  let got = listProvidersByModelId(db, model.id)[0];
  expect(got.priority).toBe(5);
  expect(got.enabled).toBe(false);
  deleteProvider(db, p.id);
  expect(listProvidersByModelId(db, model.id)).toEqual([]);
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/store/providers.test.ts`
Expected: FAIL —— 找不到模块 `../../src/store/providers.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/store/providers.ts
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
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/store/providers.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/store/providers.ts tests/store/providers.test.ts
git commit -m "feat: add providers store"
```

---

### Task 6: request_logs、budgets、models_dev_cache 存储层

**Files:**
- Create: `src/store/requestLogs.ts`
- Create: `src/store/budgets.ts`
- Create: `src/store/modelsDevCache.ts`
- Test: `tests/store/misc-stores.test.ts`

**Interfaces:**
- Consumes: `openDb`/`migrate`（Task 3）、`RequestLog`/`Budget`/`BudgetInput`（Task 2）
- Produces:
  - requestLogs.ts：`type RequestLogInput = Omit<RequestLog, 'id' | 'created_at'>`；`insertRequestLog(db, input: RequestLogInput): RequestLog`；`listRequestLogs(db, opts?: { logicalModelId?: number; limit?: number; offset?: number }): RequestLog[]`
  - budgets.ts：`type BudgetInput = Omit<Budget, 'id'>`；`createBudget(db, input: BudgetInput): Budget`；`listBudgets(db, opts?: { scope?: BudgetScope; targetId?: number }): Budget[]`；`deleteBudget(db, id: number): void`
  - modelsDevCache.ts：`saveModelsDevCache(db, data: string, fetchedAt: string): void`（upsert 到 id=1）；`readModelsDevCache(db): { data: string; fetched_at: string } | null`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/store/misc-stores.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createBudget, deleteBudget, listBudgets } from '../../src/store/budgets.js';
import { insertRequestLog, listRequestLogs } from '../../src/store/requestLogs.js';
import { readModelsDevCache, saveModelsDevCache } from '../../src/store/modelsDevCache.js';

function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

test('insert and list request logs (newest first, filter by model)', () => {
  const db = freshDb();
  insertRequestLog(db, {
    logical_model_id: 1, hit_provider_id: 7, client_format: 'chat', upstream_format: 'chat',
    input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0, latency_ms: 123, status: 'success', error: null, attempts: 1,
  });
  insertRequestLog(db, {
    logical_model_id: 2, hit_provider_id: null, client_format: 'chat', upstream_format: null,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0, latency_ms: 9, status: 'error', error: 'boom', attempts: 2,
  });
  expect(listRequestLogs(db).length).toBe(2);
  const forModel1 = listRequestLogs(db, { logicalModelId: 1 });
  expect(forModel1.length).toBe(1);
  expect(forModel1[0].hit_provider_id).toBe(7);
  expect(forModel1[0].created_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  db.close();
});

test('budgets create/list/delete with filter', () => {
  const db = freshDb();
  const g = createBudget(db, { scope: 'global', target_id: null, limit_usd: 50, period: 'month', action: 'block' });
  createBudget(db, { scope: 'logical_model', target_id: 1, limit_usd: 5, period: 'day', action: 'warn' });
  expect(listBudgets(db).length).toBe(2);
  expect(listBudgets(db, { scope: 'logical_model', targetId: 1 }).length).toBe(1);
  deleteBudget(db, g.id);
  expect(listBudgets(db, { scope: 'global' }).length).toBe(0);
  db.close();
});

test('models_dev_cache upserts single row', () => {
  const db = freshDb();
  expect(readModelsDevCache(db)).toBeNull();
  saveModelsDevCache(db, '{"a":1}', '2026-07-11T00:00:00.000Z');
  saveModelsDevCache(db, '{"a":2}', '2026-07-11T01:00:00.000Z');
  const c = readModelsDevCache(db);
  expect(c?.data).toBe('{"a":2}');
  expect(c?.fetched_at).toBe('2026-07-11T01:00:00.000Z');
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/store/misc-stores.test.ts`
Expected: FAIL —— 找不到模块 `requestLogs.js` 等。

- [ ] **Step 3: 写实现**

```typescript
// src/store/requestLogs.ts
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
```

```typescript
// src/store/budgets.ts
import type Database from 'better-sqlite3';
import type { Budget, BudgetScope } from '../types.js';

export type BudgetInput = Omit<Budget, 'id'>;

export function createBudget(db: Database.Database, input: BudgetInput): Budget {
  const info = db
    .prepare(
      'INSERT INTO budgets (scope, target_id, limit_usd, period, action) VALUES (?, ?, ?, ?, ?)',
    )
    .run(input.scope, input.target_id, input.limit_usd, input.period, input.action);
  return { id: Number(info.lastInsertRowid), ...input };
}

export function listBudgets(
  db: Database.Database,
  opts: { scope?: BudgetScope; targetId?: number } = {},
): Budget[] {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (opts.scope !== undefined) {
    clauses.push('scope = ?');
    values.push(opts.scope);
  }
  if (opts.targetId !== undefined) {
    clauses.push('target_id = ?');
    values.push(opts.targetId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM budgets ${where} ORDER BY id`).all(...values) as Budget[];
}

export function deleteBudget(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
}
```

```typescript
// src/store/modelsDevCache.ts
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/store/misc-stores.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/store/requestLogs.ts src/store/budgets.ts src/store/modelsDevCache.ts tests/store/misc-stores.test.ts
git commit -m "feat: add request_logs, budgets, models_dev_cache stores"
```

---

### Task 7: 逻辑模型 → provider 链解析

**Files:**
- Create: `src/router/resolve.ts`
- Test: `tests/router/resolve.test.ts`

**Interfaces:**
- Consumes: `getLogicalModelByName`（Task 4）、`listProvidersByModelId`（Task 5）、`Provider`（Task 2）
- Produces: `resolveChain(db, logicalModelName: string): Provider[]` —— 返回按 priority 升序、**仅 enabled** 的 provider；逻辑模型不存在或无启用 provider 返回 `[]`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/router/resolve.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createLogicalModel } from '../../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../../src/store/providers.js';
import { resolveChain } from '../../src/router/resolve.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return {
    logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'https://x/v1',
    api_key: 'k', upstream_model: 'm', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

test('returns enabled providers ordered by priority', () => {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'my-sonnet');
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'second' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'first' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 2, upstream_model: 'disabled', enabled: false }));

  const chain = resolveChain(db, 'my-sonnet');
  expect(chain.map((p) => p.upstream_model)).toEqual(['first', 'second']);
  db.close();
});

test('unknown model returns empty chain', () => {
  const db = openDb(':memory:');
  migrate(db);
  expect(resolveChain(db, 'nope')).toEqual([]);
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/router/resolve.test.ts`
Expected: FAIL —— 找不到模块 `../../src/router/resolve.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/router/resolve.ts
import type Database from 'better-sqlite3';
import { getLogicalModelByName } from '../store/logicalModels.js';
import { listProvidersByModelId } from '../store/providers.js';
import type { Provider } from '../types.js';

export function resolveChain(db: Database.Database, logicalModelName: string): Provider[] {
  const model = getLogicalModelByName(db, logicalModelName);
  if (!model) return [];
  return listProvidersByModelId(db, model.id).filter((p) => p.enabled);
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/router/resolve.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/router/resolve.ts tests/router/resolve.test.ts
git commit -m "feat: add logical-model to provider chain resolution"
```

---

### Task 8: fallback 判定与执行引擎

**Files:**
- Create: `src/router/fallback.ts`
- Test: `tests/router/fallback.test.ts`

**Interfaces:**
- Consumes: `Provider`（Task 2）
- Produces:
  - `interface AttemptOutcome { provider: Provider; ok: boolean; status?: number; error?: Error }`
  - `shouldFallback(outcome: AttemptOutcome): boolean` —— 硬失败（无 status 的连接/超时错误、status ≥ 500、429）或 `status ∈ provider.fallback_status_codes` → true；成功（ok）或普通 4xx（非 429、不在自定义码内）→ false。
  - `interface RunResult<T> { value?: T; outcome: AttemptOutcome; attempts: number }`
  - `runChain<T>(chain: Provider[], attempt: (p: Provider) => Promise<T>): Promise<RunResult<T>>` —— 依次 attempt；成功即返回；失败且 shouldFallback 则降级；最后一个仍失败则返回最终失败结果。`attempt` 抛出的错误若带 `.status`（number）会被读入 outcome。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/router/fallback.test.ts
import { expect, test } from 'vitest';
import { runChain, shouldFallback, type AttemptOutcome } from '../../src/router/fallback.js';
import type { Provider } from '../../src/types.js';

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: 1, logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'x',
    api_key: 'k', upstream_model: 'm', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

test('shouldFallback: hard failures trigger, plain 4xx does not', () => {
  const p = provider();
  expect(shouldFallback({ provider: p, ok: true })).toBe(false);
  expect(shouldFallback({ provider: p, ok: false, error: new Error('ECONNREFUSED') })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 500 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 429 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 400 })).toBe(false);
});

test('shouldFallback: custom fallback_status_codes trigger', () => {
  const p = provider({ fallback_status_codes: [402, 403] });
  expect(shouldFallback({ provider: p, ok: false, status: 402 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 403 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 404 })).toBe(false);
});

test('runChain: falls through to second provider on hard failure', async () => {
  const a = provider({ id: 1, upstream_model: 'a' });
  const b = provider({ id: 2, upstream_model: 'b' });
  const res = await runChain([a, b], async (p) => {
    if (p.id === 1) {
      const e = new Error('boom') as Error & { status?: number };
      e.status = 500;
      throw e;
    }
    return `ok-${p.upstream_model}`;
  });
  expect(res.value).toBe('ok-b');
  expect(res.outcome.ok).toBe(true);
  expect(res.attempts).toBe(2);
});

test('runChain: stops on non-fallback error (plain 400)', async () => {
  const a = provider({ id: 1 });
  const b = provider({ id: 2 });
  let bCalled = false;
  const res = await runChain([a, b], async (p) => {
    if (p.id === 1) {
      const e = new Error('bad') as Error & { status?: number };
      e.status = 400;
      throw e;
    }
    bCalled = true;
    return 'ok';
  });
  expect(res.value).toBeUndefined();
  expect(res.outcome.status).toBe(400);
  expect(res.attempts).toBe(1);
  expect(bCalled).toBe(false);
});

test('runChain: empty chain returns zero attempts', async () => {
  const res = await runChain([], async () => 'x');
  expect(res.attempts).toBe(0);
  expect(res.value).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/router/fallback.test.ts`
Expected: FAIL —— 找不到模块 `../../src/router/fallback.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/router/fallback.ts
import type { Provider } from '../types.js';

export interface AttemptOutcome {
  provider: Provider;
  ok: boolean;
  status?: number;
  error?: Error;
}

export interface RunResult<T> {
  value?: T;
  outcome: AttemptOutcome;
  attempts: number;
}

export function shouldFallback(outcome: AttemptOutcome): boolean {
  if (outcome.ok) return false;
  const { status, provider } = outcome;
  if (status === undefined) return true; // 连接/超时等无状态码的硬失败
  if (status >= 500) return true;
  if (status === 429) return true;
  if (provider.fallback_status_codes.includes(status)) return true;
  return false; // 普通 4xx（如 400）不降级
}

export async function runChain<T>(
  chain: Provider[],
  attempt: (p: Provider) => Promise<T>,
): Promise<RunResult<T>> {
  let attempts = 0;
  let lastOutcome: AttemptOutcome = {
    provider: chain[0] as Provider,
    ok: false,
    error: new Error('empty chain'),
  };

  for (const provider of chain) {
    attempts++;
    try {
      const value = await attempt(provider);
      return { value, outcome: { provider, ok: true }, attempts };
    } catch (err) {
      const e = err as Error & { status?: number };
      lastOutcome = { provider, ok: false, status: e.status, error: e };
      if (!shouldFallback(lastOutcome)) break;
    }
  }

  return { outcome: lastOutcome, attempts };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/router/fallback.test.ts`
Expected: PASS —— 5 passed。

- [ ] **Step 5: 提交**

```bash
git add src/router/fallback.ts tests/router/fallback.test.ts
git commit -m "feat: add fallback decision and chain execution engine"
```

---

### Task 9: 由 provider 配置构造 AI SDK 模型

**Files:**
- Create: `src/outbound/model.ts`
- Test: `tests/outbound/model.test.ts`

**Interfaces:**
- Consumes: `Provider`（Task 2）、AI SDK 7 的 `createOpenAI`（`@ai-sdk/openai`）、`createAnthropic`（`@ai-sdk/anthropic`）、`LanguageModel`（`ai`）
- Produces: `buildModel(provider: Provider): LanguageModel` —— 依 `upstream_format` 选择 provider 工厂：`chat`→`createOpenAI({baseURL,apiKey}).chat(upstream_model)`；`responses`→`createOpenAI({baseURL,apiKey}).responses(upstream_model)`；`anthropic`→`createAnthropic({baseURL,apiKey})(upstream_model)`。

- [ ] **Step 1: 写失败测试**

AI SDK 模型实例带 `modelId` 与 `provider` 字段，用它们断言构造正确、不真正发网络请求：

```typescript
// tests/outbound/model.test.ts
import { expect, test } from 'vitest';
import { buildModel } from '../../src/outbound/model.js';
import type { Provider } from '../../src/types.js';

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: 1, logical_model_id: 1, priority: 0, upstream_format: 'chat',
    base_url: 'https://proxy.example/v1', api_key: 'sk-test', upstream_model: 'gpt-4o',
    models_dev_id: null, fallback_status_codes: [], enabled: true, ...over,
  };
}

test('chat format builds an openai chat model with the upstream model id', () => {
  const m = buildModel(provider({ upstream_format: 'chat', upstream_model: 'gpt-4o' }));
  expect(m.modelId).toBe('gpt-4o');
  expect(m.provider).toContain('openai');
});

test('anthropic format builds an anthropic model', () => {
  const m = buildModel(
    provider({ upstream_format: 'anthropic', base_url: 'https://api.anthropic.com', upstream_model: 'claude-sonnet-4' }),
  );
  expect(m.modelId).toBe('claude-sonnet-4');
  expect(m.provider).toContain('anthropic');
});

test('responses format builds an openai responses model', () => {
  const m = buildModel(provider({ upstream_format: 'responses', upstream_model: 'gpt-5' }));
  expect(m.modelId).toBe('gpt-5');
  expect(m.provider).toContain('openai');
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/outbound/model.test.ts`
Expected: FAIL —— 找不到模块 `../../src/outbound/model.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/outbound/model.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Provider } from '../types.js';

export function buildModel(provider: Provider): LanguageModel {
  switch (provider.upstream_format) {
    case 'chat': {
      const openai = createOpenAI({ baseURL: provider.base_url, apiKey: provider.api_key });
      return openai.chat(provider.upstream_model);
    }
    case 'responses': {
      const openai = createOpenAI({ baseURL: provider.base_url, apiKey: provider.api_key });
      return openai.responses(provider.upstream_model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ baseURL: provider.base_url, apiKey: provider.api_key });
      return anthropic(provider.upstream_model);
    }
  }
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/outbound/model.test.ts`
Expected: PASS —— 3 passed。

> 注：AI SDK 7 各 provider 包的模型实例暴露 `modelId` 与 `provider` 只读属性；若某包省略 `.chat()`/`.responses()` 命名，实现阶段以 `@ai-sdk/openai` 当时文档为准调整，但对外签名 `buildModel(provider): LanguageModel` 不变。

- [ ] **Step 5: 提交**

```bash
git add src/outbound/model.ts tests/outbound/model.test.ts
git commit -m "feat: build AI SDK language model from provider config"
```

---

### Task 10: 转发处理器（同格式直传）与 Hono server 集成

**Files:**
- Create: `src/outbound/passthrough.ts`
- Create: `src/relay.ts`
- Create: `src/server.ts`
- Test: `tests/relay.test.ts`

**Interfaces:**
- Consumes: `resolveChain`（Task 7）、`runChain`/`AttemptOutcome`（Task 8）、`buildModel`（Task 9）、`insertRequestLog`（Task 6）、AI SDK 7 `streamText`（`ai`）
- Produces:
  - passthrough.ts：`interface ChatBody { model: string; messages: { role: string; content: string }[]; stream?: boolean; [k: string]: unknown }`；`callProviderChat(model: LanguageModel, body: ChatBody): Promise<{ text: string; usage: { input: number; output: number } }>` —— 用 `streamText` 消费流得到完整文本（本阶段先返回聚合文本，流式端点在 relay 内直接转发 `.textStream`）。
  - relay.ts：`createRelay(db)` 返回一个 `Hono` 实例；`handleChat(db, body: ChatBody): Promise<Response>` —— 解析链、runChain 逐个尝试、写 request_logs（cost 填 0）、返回 OpenAI chat 兼容响应（流式时返回 SSE）。
  - server.ts：装配 `createRelay(db)`，`@hono/node-server` 启动，读取 `PORT`（默认 8787）与 `DB_PATH`（默认 `polyglot.sqlite`）。
- 注入点：`handleChat` 接受一个可选 `runner` 参数（默认用真实 `buildModel`+`callProviderChat`），测试注入假 runner，避免真实网络。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/relay.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../src/store/db.js';
import { createLogicalModel } from '../src/store/logicalModels.js';
import { createProvider, type ProviderInput } from '../src/store/providers.js';
import { listRequestLogs } from '../src/store/requestLogs.js';
import { handleChat } from '../src/relay.js';
import type { Provider } from '../src/types.js';

function input(over: Partial<ProviderInput>): ProviderInput {
  return {
    logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'https://x/v1',
    api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

function setup() {
  const db = openDb(':memory:');
  migrate(db);
  const model = createLogicalModel(db, 'my-gpt');
  return { db, model };
}

test('routes to first provider and returns chat response, logs success', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  const runner = async (p: Provider) => ({ text: `hi from ${p.upstream_model}`, usage: { input: 3, output: 4 } });

  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'hey' }] }, runner);
  expect(res.status).toBe(200);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('hi from A');

  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].status).toBe('success');
  expect(logs[0].attempts).toBe(1);
  expect(logs[0].input_tokens).toBe(3);
  expect(logs[0].cost_usd).toBe(0); // 阶段1 成本填 0
  db.close();
});

test('falls back to second provider on hard failure', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, priority: 0, upstream_model: 'A' }));
  createProvider(db, input({ logical_model_id: model.id, priority: 1, upstream_model: 'B' }));
  const runner = async (p: Provider) => {
    if (p.upstream_model === 'A') {
      const e = new Error('down') as Error & { status?: number };
      e.status = 503;
      throw e;
    }
    return { text: 'from B', usage: { input: 1, output: 1 } };
  };
  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'x' }] }, runner);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  expect(json.choices[0].message.content).toBe('from B');
  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].attempts).toBe(2);
  expect(logs[0].hit_provider_id).not.toBeNull();
  db.close();
});

test('unknown model returns 404', async () => {
  const { db } = setup();
  const res = await handleChat(db, { model: 'ghost', messages: [] }, async () => ({ text: '', usage: { input: 0, output: 0 } }));
  expect(res.status).toBe(404);
  db.close();
});

test('all providers fail returns 502 and logs error', async () => {
  const { db, model } = setup();
  createProvider(db, input({ logical_model_id: model.id, upstream_model: 'A' }));
  const runner = async () => {
    const e = new Error('boom') as Error & { status?: number };
    e.status = 500;
    throw e;
  };
  const res = await handleChat(db, { model: 'my-gpt', messages: [{ role: 'user', content: 'x' }] }, runner);
  expect(res.status).toBe(502);
  const logs = listRequestLogs(db, { logicalModelId: model.id });
  expect(logs[0].status).toBe('error');
  db.close();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/relay.test.ts`
Expected: FAIL —— 找不到模块 `../src/relay.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/outbound/passthrough.ts
import { streamText } from 'ai';
import type { LanguageModel } from 'ai';

export interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
  [k: string]: unknown;
}

export interface ProviderReply {
  text: string;
  usage: { input: number; output: number };
}

// 用 AI SDK 消费上游, 聚合成完整文本。system 提取到 instructions(AI SDK 7 默认拒绝 messages 中 system role)。
export async function callProviderChat(model: LanguageModel, body: ChatBody): Promise<ProviderReply> {
  const system = body.messages.find((m) => m.role === 'system')?.content;
  const messages = body.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const result = streamText({ model, instructions: system, messages });
  let text = '';
  for await (const delta of result.textStream) text += delta;
  const usage = await result.usage;
  return {
    text,
    usage: { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 },
  };
}
```

```typescript
// src/relay.ts
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { buildModel } from './outbound/model.js';
import { callProviderChat, type ChatBody, type ProviderReply } from './outbound/passthrough.js';
import { runChain } from './router/fallback.js';
import { resolveChain } from './router/resolve.js';
import { insertRequestLog } from './store/requestLogs.js';
import type { Provider } from './types.js';

export type ChatRunner = (provider: Provider, body: ChatBody) => Promise<ProviderReply>;

const defaultRunner: ChatRunner = (provider, body) => callProviderChat(buildModel(provider), body);

function toChatResponse(model: string, reply: ProviderReply): Response {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: reply.text }, finish_reason: 'stop' },
    ],
    usage: {
      prompt_tokens: reply.usage.input,
      completion_tokens: reply.usage.output,
      total_tokens: reply.usage.input + reply.usage.output,
    },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleChat(
  db: Database.Database,
  body: ChatBody,
  runner: ChatRunner = defaultRunner,
): Promise<Response> {
  const chain = resolveChain(db, body.model);
  const modelRow = chain[0]?.logical_model_id;
  if (chain.length === 0) {
    return new Response(JSON.stringify({ error: { message: `unknown model: ${body.model}` } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const start = Date.now();
  const run = await runChain(chain, (provider) => runner(provider, body));
  const latency = Date.now() - start;
  const logicalModelId = modelRow as number;

  if (run.value) {
    insertRequestLog(db, {
      logical_model_id: logicalModelId,
      hit_provider_id: run.outcome.provider.id,
      client_format: 'chat',
      upstream_format: run.outcome.provider.upstream_format,
      input_tokens: run.value.usage.input,
      output_tokens: run.value.usage.output,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0, // 阶段3 补
      latency_ms: latency,
      status: 'success',
      error: null,
      attempts: run.attempts,
    });
    return toChatResponse(body.model, run.value);
  }

  insertRequestLog(db, {
    logical_model_id: logicalModelId,
    hit_provider_id: null,
    client_format: 'chat',
    upstream_format: run.outcome.provider?.upstream_format ?? null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    latency_ms: latency,
    status: 'error',
    error: run.outcome.error?.message ?? 'all providers failed',
    attempts: run.attempts,
  });
  return new Response(
    JSON.stringify({ error: { message: run.outcome.error?.message ?? 'all providers failed' } }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

export function createRelay(db: Database.Database): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', async (c) => {
    const body = (await c.req.json()) as ChatBody;
    return handleChat(db, body);
  });
  return app;
}
```

```typescript
// src/server.ts
import { serve } from '@hono/node-server';
import { createRelay } from './relay.js';
import { migrate, openDb } from './store/db.js';

const dbPath = process.env.DB_PATH ?? 'polyglot.sqlite';
const port = Number(process.env.PORT ?? 8787);

const db = openDb(dbPath);
migrate(db);
const app = createRelay(db);

serve({ fetch: app.fetch, port });
console.log(`polyglot relay listening on :${port} (db: ${dbPath})`);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/relay.test.ts && npm run typecheck`
Expected: PASS —— 4 passed；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/outbound/passthrough.ts src/relay.ts src/server.ts tests/relay.test.ts
git commit -m "feat: add same-format chat relay with fallback and hono server"
```

---

## 阶段 1 完成标准

- `npm test` 全绿；`npm run typecheck` 无错误。
- `npm run dev` 起服务后，配置好一条 chat provider 链，向 `/v1/chat/completions` 发请求能正确转发、失败降级，并在 request_logs 留痕（成本为 0）。
- 交付物为阶段 2（格式转换）与阶段 3（成本）提供 store、router、outbound、relay 骨架与稳定接口。
