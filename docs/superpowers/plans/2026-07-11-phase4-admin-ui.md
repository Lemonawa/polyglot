# 阶段 4：Admin 管理界面 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供一个受 token 保护的 Web 管理界面，只做「逻辑模型与 provider 链的增删改查 + 预算设置 + 日志/成本查看 + 刷新价目」这几件事，做扎实，不堆多租户/令牌分组/充值。

**Architecture:** `admin/auth.ts` 用单一 `ADMIN_TOKEN`（Bearer）保护 `/admin/*`；`admin/routes.ts` 是挂在 `/admin/api` 的 Hono 子路由，复用阶段 1-3 的 store 与 cost 函数做 REST；`admin/ui/index.html` 是一个零构建链的单页（原生 HTML + vanilla JS），由 Hono 静态返回。

**Tech Stack:** TypeScript 7.0（strict）、Hono、better-sqlite3、vitest。依赖阶段 1、2、3 已完成。

## Global Constraints

- 依赖阶段 1-3 交付：`store/*`（logicalModels/providers/budgets/requestLogs）、`cost/modelsDev.refreshModelsDev`、`cost/budget.checkBudgets`、`relay.createRelay`、`server.ts` 已存在。
- **安全**：admin 面板与所有 `/admin/*` 路由必须经 `ADMIN_TOKEN` 校验；未配置 `ADMIN_TOKEN` 时拒绝启动 admin（fail closed）。转发端点 `/v1/*` 保持不变（由各 provider 自己的 key 鉴权上游）。**明确提示：不能裸奔公网。**
- 范围收窄：只做 CRUD + 查看 + 刷新。不做用户系统、令牌分组、充值、图表可视化（纯表格）。
- API 路由测试用 Hono 的 `app.request()`，不起真实端口。
- TDD、DRY、YAGNI、Conventional Commits。严格遵守 `00-shared-contract.md` 的类型与目录结构。

---

### Task 1: admin 鉴权中间件

**Files:**
- Create: `src/admin/auth.ts`
- Test: `tests/admin/auth.test.ts`

**Interfaces:**
- Consumes: Hono `MiddlewareHandler`
- Produces: `requireAdmin(token: string): MiddlewareHandler` —— 校验请求头 `Authorization: Bearer <token>`；不匹配返回 401。`token` 为空串时该中间件永远 401（fail closed）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/admin/auth.test.ts
import { expect, test } from 'vitest';
import { Hono } from 'hono';
import { requireAdmin } from '../../src/admin/auth.js';

function appWith(token: string) {
  const app = new Hono();
  app.use('/admin/*', requireAdmin(token));
  app.get('/admin/ping', (c) => c.json({ ok: true }));
  return app;
}

test('rejects without bearer token', async () => {
  const res = await appWith('secret').request('/admin/ping');
  expect(res.status).toBe(401);
});

test('accepts correct bearer token', async () => {
  const res = await appWith('secret').request('/admin/ping', {
    headers: { Authorization: 'Bearer secret' },
  });
  expect(res.status).toBe(200);
});

test('fail closed when token empty', async () => {
  const res = await appWith('').request('/admin/ping', {
    headers: { Authorization: 'Bearer ' },
  });
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/admin/auth.test.ts`
Expected: FAIL —— 找不到模块 `../../src/admin/auth.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/admin/auth.ts
import type { MiddlewareHandler } from 'hono';

export function requireAdmin(token: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const prefix = 'Bearer ';
    const provided = header.startsWith(prefix) ? header.slice(prefix.length) : '';
    if (token.length === 0 || provided !== token) {
      return c.json({ error: { message: 'unauthorized' } }, 401);
    }
    await next();
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/admin/auth.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/admin/auth.ts tests/admin/auth.test.ts
git commit -m "feat: add admin bearer-token auth middleware (fail closed)"
```

---

### Task 2: admin REST —— 逻辑模型与 provider CRUD

**Files:**
- Create: `src/admin/routes.ts`
- Test: `tests/admin/routes-crud.test.ts`

**Interfaces:**
- Consumes: 阶段1 store（`createLogicalModel`/`listLogicalModels`/`deleteLogicalModel`、`createProvider`/`listProvidersByModelId`/`updateProvider`/`deleteProvider`/`ProviderInput`）、`requireAdmin`（Task 1）
- Produces: `createAdminRoutes(db, token: string): Hono` —— 返回一个 Hono 实例，全部路由前置 `requireAdmin(token)`。本任务实现：
  - `GET /models` → `{ models: LogicalModel[] }`
  - `POST /models` `{ name }` → 201 `{ model }`
  - `DELETE /models/:id` → 204
  - `GET /models/:id/providers` → `{ providers: Provider[] }`
  - `POST /models/:id/providers` `ProviderInput`（不含 `logical_model_id`，用路径 id）→ 201 `{ provider }`
  - `PATCH /providers/:id` `Partial<ProviderInput>` → 200 `{ ok: true }`
  - `DELETE /providers/:id` → 204

- [ ] **Step 1: 写失败测试**

```typescript
// tests/admin/routes-crud.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createAdminRoutes } from '../../src/admin/routes.js';

const AUTH = { Authorization: 'Bearer t', 'content-type': 'application/json' };

function app() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, api: createAdminRoutes(db, 't') };
}

test('create model, list, add provider, list providers', async () => {
  const { api } = app();
  const created = await api.request('/models', { method: 'POST', headers: AUTH, body: JSON.stringify({ name: 'my-sonnet' }) });
  expect(created.status).toBe(201);
  const { model } = (await created.json()) as { model: { id: number; name: string } };
  expect(model.name).toBe('my-sonnet');

  const list = await api.request('/models', { headers: AUTH });
  expect(((await list.json()) as { models: unknown[] }).models.length).toBe(1);

  const addP = await api.request(`/models/${model.id}/providers`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ priority: 0, upstream_format: 'chat', base_url: 'https://x/v1', api_key: 'k', upstream_model: 'gpt-4o', models_dev_id: null, fallback_status_codes: [], enabled: true }),
  });
  expect(addP.status).toBe(201);
  const { provider } = (await addP.json()) as { provider: { id: number; logical_model_id: number } };
  expect(provider.logical_model_id).toBe(model.id);

  const plist = await api.request(`/models/${model.id}/providers`, { headers: AUTH });
  expect(((await plist.json()) as { providers: unknown[] }).providers.length).toBe(1);
});

test('patch and delete provider', async () => {
  const { db, api } = app();
  const { createLogicalModel } = await import('../../src/store/logicalModels.js');
  const m = createLogicalModel(db, 'm');
  const addP = await api.request(`/models/${m.id}/providers`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ priority: 0, upstream_format: 'chat', base_url: 'x', api_key: 'k', upstream_model: 'a', models_dev_id: null, fallback_status_codes: [], enabled: true }),
  });
  const { provider } = (await addP.json()) as { provider: { id: number } };

  const patch = await api.request(`/providers/${provider.id}`, { method: 'PATCH', headers: AUTH, body: JSON.stringify({ priority: 9 }) });
  expect(patch.status).toBe(200);
  const del = await api.request(`/providers/${provider.id}`, { method: 'DELETE', headers: AUTH });
  expect(del.status).toBe(204);
});

test('requires auth', async () => {
  const { api } = app();
  const res = await api.request('/models');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/admin/routes-crud.test.ts`
Expected: FAIL —— 找不到模块 `../../src/admin/routes.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/admin/routes.ts
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { requireAdmin } from './auth.js';
import {
  createLogicalModel,
  deleteLogicalModel,
  listLogicalModels,
} from '../store/logicalModels.js';
import {
  createProvider,
  deleteProvider,
  listProvidersByModelId,
  updateProvider,
  type ProviderInput,
} from '../store/providers.js';

export function createAdminRoutes(db: Database.Database, token: string): Hono {
  const app = new Hono();
  app.use('*', requireAdmin(token));

  app.get('/models', (c) => c.json({ models: listLogicalModels(db) }));

  app.post('/models', async (c) => {
    const body = (await c.req.json()) as { name: string };
    const model = createLogicalModel(db, body.name);
    return c.json({ model }, 201);
  });

  app.delete('/models/:id', (c) => {
    deleteLogicalModel(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  app.get('/models/:id/providers', (c) => {
    const providers = listProvidersByModelId(db, Number(c.req.param('id')));
    return c.json({ providers });
  });

  app.post('/models/:id/providers', async (c) => {
    const logical_model_id = Number(c.req.param('id'));
    const body = (await c.req.json()) as Omit<ProviderInput, 'logical_model_id'>;
    const provider = createProvider(db, { ...body, logical_model_id });
    return c.json({ provider }, 201);
  });

  app.patch('/providers/:id', async (c) => {
    const patch = (await c.req.json()) as Partial<ProviderInput>;
    updateProvider(db, Number(c.req.param('id')), patch);
    return c.json({ ok: true });
  });

  app.delete('/providers/:id', (c) => {
    deleteProvider(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  return app;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/admin/routes-crud.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.ts tests/admin/routes-crud.test.ts
git commit -m "feat: admin REST for logical models and provider chains"
```

---

### Task 3: admin REST —— 预算、日志、价目刷新

**Files:**
- Modify: `src/admin/routes.ts`
- Test: `tests/admin/routes-ops.test.ts`

**Interfaces:**
- Consumes: `createBudget`/`listBudgets`/`deleteBudget`/`BudgetInput`（阶段1）、`listRequestLogs`（阶段1）、`checkBudgets`（阶段3）、`refreshModelsDev`（阶段3）
- Produces（在 `createAdminRoutes` 内追加路由）：
  - `GET /budgets` → `{ budgets: Budget[] }`
  - `POST /budgets` `BudgetInput` → 201 `{ budget }`
  - `DELETE /budgets/:id` → 204
  - `GET /logs?model=<id>&limit=&offset=` → `{ logs: RequestLog[] }`（无 model 则全部）
  - `GET /models/:id/budget-status` → `{ statuses: BudgetStatus[] }`
  - `POST /models-dev/refresh` → `{ ok: true }`（调用 `refreshModelsDev`；失败返回 502）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/admin/routes-ops.test.ts
import { expect, test } from 'vitest';
import { migrate, openDb } from '../../src/store/db.js';
import { createAdminRoutes } from '../../src/admin/routes.js';
import { insertRequestLog } from '../../src/store/requestLogs.js';

const AUTH = { Authorization: 'Bearer t', 'content-type': 'application/json' };

function app() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, api: createAdminRoutes(db, 't') };
}

test('budget create/list/delete', async () => {
  const { api } = app();
  const created = await api.request('/budgets', {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ scope: 'global', target_id: null, limit_usd: 50, period: 'month', action: 'block' }),
  });
  expect(created.status).toBe(201);
  const { budget } = (await created.json()) as { budget: { id: number } };
  const list = await api.request('/budgets', { headers: AUTH });
  expect(((await list.json()) as { budgets: unknown[] }).budgets.length).toBe(1);
  const del = await api.request(`/budgets/${budget.id}`, { method: 'DELETE', headers: AUTH });
  expect(del.status).toBe(204);
});

test('logs endpoint returns rows filtered by model', async () => {
  const { db, api } = app();
  insertRequestLog(db, { logical_model_id: 3, hit_provider_id: 1, client_format: 'chat', upstream_format: 'chat', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01, latency_ms: 5, status: 'success', error: null, attempts: 1 });
  const res = await api.request('/logs?model=3', { headers: AUTH });
  const { logs } = (await res.json()) as { logs: { cost_usd: number }[] };
  expect(logs.length).toBe(1);
  expect(logs[0].cost_usd).toBe(0.01);
});

test('budget-status endpoint', async () => {
  const { api } = app();
  await api.request('/budgets', { method: 'POST', headers: AUTH, body: JSON.stringify({ scope: 'global', target_id: null, limit_usd: 1, period: 'total', action: 'warn' }) });
  const res = await api.request('/models/5/budget-status', { headers: AUTH });
  const { statuses } = (await res.json()) as { statuses: unknown[] };
  expect(statuses.length).toBe(1);
});

test('models-dev refresh uses injected fetch via env is not testable here; unknown route 404s under auth', async () => {
  const { api } = app();
  const res = await api.request('/nope', { headers: AUTH });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/admin/routes-ops.test.ts`
Expected: FAIL —— 预算/日志/状态路由未定义（404 而非预期状态）。

- [ ] **Step 3: 写实现（在 routes.ts 追加）**

在 `createAdminRoutes` 的 `return app;` 之前追加，并补充 import：

```typescript
// src/admin/routes.ts (imports 追加)
import { createBudget, deleteBudget, listBudgets, type BudgetInput } from '../store/budgets.js';
import { listRequestLogs } from '../store/requestLogs.js';
import { checkBudgets } from '../cost/budget.js';
import { refreshModelsDev } from '../cost/modelsDev.js';
```

```typescript
// src/admin/routes.ts (在 return app 之前追加路由)
  app.get('/budgets', (c) => c.json({ budgets: listBudgets(db) }));

  app.post('/budgets', async (c) => {
    const body = (await c.req.json()) as BudgetInput;
    const budget = createBudget(db, body);
    return c.json({ budget }, 201);
  });

  app.delete('/budgets/:id', (c) => {
    deleteBudget(db, Number(c.req.param('id')));
    return c.body(null, 204);
  });

  app.get('/logs', (c) => {
    const model = c.req.query('model');
    const limit = c.req.query('limit');
    const offset = c.req.query('offset');
    const logs = listRequestLogs(db, {
      logicalModelId: model ? Number(model) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return c.json({ logs });
  });

  app.get('/models/:id/budget-status', (c) => {
    const statuses = checkBudgets(db, Number(c.req.param('id')));
    return c.json({ statuses });
  });

  app.post('/models-dev/refresh', async (c) => {
    try {
      await refreshModelsDev(db);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: { message: (err as Error).message } }, 502);
    }
  });
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/admin/routes-ops.test.ts`
Expected: PASS —— 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/admin/routes.ts tests/admin/routes-ops.test.ts
git commit -m "feat: admin REST for budgets, logs, budget-status, price refresh"
```

---

### Task 4: 静态管理页面与 server 挂载

**Files:**
- Create: `src/admin/ui/index.html`
- Create: `src/admin/mount.ts`
- Modify: `src/server.ts`
- Test: `tests/admin/mount.test.ts`

**Interfaces:**
- Consumes: `createAdminRoutes`（Task 2-3）、`requireAdmin`（Task 1）、Hono、`readFileSync`
- Produces:
  - `mountAdmin(app: Hono, db, token: string): void` —— 把 `createAdminRoutes` 挂到 `/admin/api`，并在 `/admin`（GET，**不经 token**，因为要先输 token 才能调 API）返回静态 `index.html`。
  - `src/server.ts`：读取 `ADMIN_TOKEN`，非空则 `mountAdmin`，为空则打印安全警告且不挂载 admin（fail closed）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/admin/mount.test.ts
import { expect, test } from 'vitest';
import { Hono } from 'hono';
import { migrate, openDb } from '../../src/store/db.js';
import { mountAdmin } from '../../src/admin/mount.js';

function app() {
  const db = openDb(':memory:');
  migrate(db);
  const a = new Hono();
  mountAdmin(a, db, 't');
  return a;
}

test('GET /admin serves html without token', async () => {
  const res = await app().request('/admin');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('Polyglot');
});

test('admin api under /admin/api requires token', async () => {
  const unauth = await app().request('/admin/api/models');
  expect(unauth.status).toBe(401);
  const ok = await app().request('/admin/api/models', { headers: { Authorization: 'Bearer t' } });
  expect(ok.status).toBe(200);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/admin/mount.test.ts`
Expected: FAIL —— 找不到模块 `../../src/admin/mount.js`。

- [ ] **Step 3: 写实现**

```html
<!-- src/admin/ui/index.html -->
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Polyglot Admin</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 960px; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: .4rem .6rem; text-align: left; font-size: 14px; }
    input, select, button { padding: .3rem .5rem; margin: .2rem; }
    h2 { margin-top: 2rem; }
    .muted { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Polyglot</h1>
  <p class="muted">个人 AI 转发器管理台。所有操作需要 Admin Token。</p>
  <div>
    <input id="token" type="password" placeholder="Admin Token" size="32" />
    <button onclick="saveToken()">保存 Token</button>
    <button onclick="refreshPrices()">刷新 models.dev 价目</button>
  </div>

  <h2>逻辑模型</h2>
  <input id="model-name" placeholder="模型名，如 my-sonnet" />
  <button onclick="addModel()">新增模型</button>
  <table id="models"><thead><tr><th>id</th><th>name</th><th>操作</th></tr></thead><tbody></tbody></table>

  <h2>Provider 链<span class="muted" id="chain-for"></span></h2>
  <table id="providers"><thead><tr><th>priority</th><th>format</th><th>base_url</th><th>model</th><th>models_dev_id</th><th>enabled</th><th>操作</th></tr></thead><tbody></tbody></table>

  <h2>请求日志</h2>
  <table id="logs"><thead><tr><th>time</th><th>model_id</th><th>hit</th><th>attempts</th><th>tokens(in/out)</th><th>cost($)</th><th>ms</th><th>status</th></tr></thead><tbody></tbody></table>

  <script>
    const tok = () => localStorage.getItem('polyglot_token') || '';
    const H = () => ({ Authorization: 'Bearer ' + tok(), 'content-type': 'application/json' });
    function saveToken() { localStorage.setItem('polyglot_token', document.getElementById('token').value); loadModels(); loadLogs(); }
    async function api(path, opts) { return fetch('/admin/api' + path, { ...opts, headers: { ...H(), ...(opts && opts.headers) } }); }

    async function loadModels() {
      const r = await api('/models'); if (!r.ok) return;
      const { models } = await r.json();
      const tb = document.querySelector('#models tbody'); tb.innerHTML = '';
      for (const m of models) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${m.id}</td><td>${m.name}</td><td><button>查看链</button> <button>删除</button></td>`;
        tr.querySelectorAll('button')[0].onclick = () => loadProviders(m);
        tr.querySelectorAll('button')[1].onclick = async () => { await api('/models/' + m.id, { method: 'DELETE' }); loadModels(); };
        tb.appendChild(tr);
      }
    }
    async function addModel() {
      await api('/models', { method: 'POST', body: JSON.stringify({ name: document.getElementById('model-name').value }) });
      loadModels();
    }
    async function loadProviders(m) {
      document.getElementById('chain-for').textContent = ' — ' + m.name;
      const r = await api('/models/' + m.id + '/providers'); const { providers } = await r.json();
      const tb = document.querySelector('#providers tbody'); tb.innerHTML = '';
      for (const p of providers) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${p.priority}</td><td>${p.upstream_format}</td><td>${p.base_url}</td><td>${p.upstream_model}</td><td>${p.models_dev_id||''}</td><td>${p.enabled}</td><td><button>删除</button></td>`;
        tr.querySelector('button').onclick = async () => { await api('/providers/' + p.id, { method: 'DELETE' }); loadProviders(m); };
        tb.appendChild(tr);
      }
    }
    async function loadLogs() {
      const r = await api('/logs?limit=50'); if (!r.ok) return;
      const { logs } = await r.json();
      const tb = document.querySelector('#logs tbody'); tb.innerHTML = '';
      for (const l of logs) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${l.created_at}</td><td>${l.logical_model_id}</td><td>${l.hit_provider_id||''}</td><td>${l.attempts}</td><td>${l.input_tokens}/${l.output_tokens}</td><td>${l.cost_usd.toFixed(6)}</td><td>${l.latency_ms}</td><td>${l.status}</td>`;
        tb.appendChild(tr);
      }
    }
    async function refreshPrices() { const r = await api('/models-dev/refresh', { method: 'POST' }); alert(r.ok ? '价目已刷新' : '刷新失败'); }
    document.getElementById('token').value = tok();
    if (tok()) { loadModels(); loadLogs(); }
  </script>
</body>
</html>
```

```typescript
// src/admin/mount.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { Hono } from 'hono';
import { createAdminRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function mountAdmin(app: Hono, db: Database.Database, token: string): void {
  const html = readFileSync(join(__dirname, 'ui', 'index.html'), 'utf8');
  app.get('/admin', (c) => c.html(html));
  app.route('/admin/api', createAdminRoutes(db, token));
}
```

> 构建注意：`index.html` 是静态资源，`tsc` 不会拷贝。在 `package.json` 的 `build` 脚本后追加拷贝：`"build": "tsc && cp -r src/admin/ui dist/admin/ui"`（或用 `copyfiles`）。开发用 `tsx` 时 `import.meta.url` 指向 `src/`，直接读取源文件，无需拷贝。

```typescript
// src/server.ts (修改：挂载 admin)
import { serve } from '@hono/node-server';
import { createRelay } from './relay.js';
import { mountAdmin } from './admin/mount.js';
import { migrate, openDb } from './store/db.js';

const dbPath = process.env.DB_PATH ?? 'polyglot.sqlite';
const port = Number(process.env.PORT ?? 8787);
const adminToken = process.env.ADMIN_TOKEN ?? '';

const db = openDb(dbPath);
migrate(db);
const app = createRelay(db);

if (adminToken) {
  mountAdmin(app, db, adminToken);
  console.log('admin UI mounted at /admin');
} else {
  console.warn('ADMIN_TOKEN not set — admin UI disabled. Set ADMIN_TOKEN to enable. Never expose relay to public without auth.');
}

serve({ fetch: app.fetch, port });
console.log(`polyglot relay listening on :${port} (db: ${dbPath})`);
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/admin/mount.test.ts && npm test && npm run typecheck`
Expected: PASS —— mount 2 passed；全部测试通过；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/admin/ui/index.html src/admin/mount.ts src/server.ts package.json tests/admin/mount.test.ts
git commit -m "feat: mount admin UI and REST, wire into server (fail closed on token)"
```

---

## 阶段 4 完成标准

- `npm test` 全绿；`npm run typecheck` 无错误。
- 设置 `ADMIN_TOKEN` 启动后，`/admin` 打开管理页，输入 token 即可增删改查逻辑模型/provider 链、设预算、看日志与成本、刷新价目。
- 未设 `ADMIN_TOKEN` 时 admin 不挂载并打印安全警告。
- 范围严格收窄在 CRUD + 查看 + 刷新，无多租户/令牌分组/充值。
