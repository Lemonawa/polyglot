# Polyglot 共享契约（所有阶段计划的公共基础）

> 这份文档不是独立的实现计划，而是 4 份阶段计划共享的**文件结构、核心 TS 类型、数据模型、技术栈事实**。每份阶段计划都假定读者已读过本文件。任何阶段引入的新类型若被后续阶段依赖，必须回填到本文件。

## 技术栈事实（已核实，写代码时照此）

- **运行时**：Node.js ≥ 22，TypeScript 7.0（原生 Go 编译器，2026-07-08 GA，`npm i -D typescript` 即 7.0；用 `tsx` 跑测试与开发；生产用 `tsc` 编译到 `dist/`）。
  - **TS 7.0 坑**：无稳定编程式 API（等 7.1），`typescript-eslint` 尚未兼容 7.0——**第一版不引入 ESLint**（或用不依赖 tsc API 的 linter 如 Biome）。7.0 strict 为默认、6.0 弃用变硬错误，代码一律按 strict 写。
- **HTTP**：Hono（`hono` 包，`@hono/node-server` 起服务）。
- **测试**：`vitest`（走 esbuild 转译，不依赖 tsc API，兼容 TS 7.0）。lint/format 用 `biome`（Rust 实现，不依赖 typescript API）。
- **SQLite**：`better-sqlite3`（同步 API，单文件，个人自用足够）。
- **AI SDK 7**（2026-06-25 发布，最新主版本，用这个，不是 v5）：
  - `ai` 包提供 `streamText` / `generateText`。全部包 ESM-only。
  - `@ai-sdk/openai` 提供 `createOpenAI({ baseURL, apiKey, headers })`；实例上 `openai.chat(modelId)` 用于 Chat Completions，`openai.responses(modelId)` 用于 Responses API。自定义中转站用 `.chat()`。
  - `@ai-sdk/anthropic` 提供 `createAnthropic({ baseURL, apiKey, headers })`，实例 `anthropic(modelId)`。
  - usage 字段：`usage.inputTokens`、`usage.outputTokens`、`usage.cachedInputTokens`（缓存命中）；cache write 在 `providerMetadata.openai?.usage?.cacheWriteTokens`（可能 undefined）。v7 起 `result.usage` 报告跨步骤总量（`totalUsage` 已弃用）。
  - **AI SDK 不原生输出 OpenAI / Anthropic wire 格式的 SSE**。出站响应/流再序列化成客户端要的格式必须自己写。
  - **v7 关键变化（写代码照此）**：
    - 顶层 `reasoning` 参数：`generateText`/`streamText` 直接接受 `reasoning`，映射到各家原生推理设置——对应 Canonical 的 `reasoning` 字段。
    - `system` 参数被 `instructions` 取代（`system` 弃用但仍可用）；**优先用 `instructions`**。
    - 默认拒绝 `messages` 里的 `system` role（防注入）。入站解析各家格式时，system 提示要提取到顶层 `instructions`，不要塞进 messages。若确需保留可传 `allowSystemInMessages: true`，但默认不用。
    - 流式：用 `streamText` 结果的 `.stream`（`fullStream` 已弃用）。
    - 多步循环用 `isStepCount`（`stepCountIs` 已弃用）。
- **models.dev**：`https://models.dev/api.json`。结构：顶层按 provider 分组，每个 provider 有 `models` map，每个 model 有 `cost: { input, output, cache_read, cache_write }`（单位：每百万 token 的美元价）与 `limit: { context, output }`。

## 目录结构

```
polyglot/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types.ts                 -- 全局共享 TS 类型（见下）
    server.ts                -- Hono 入口, 装配所有单元, 启动服务

    store/
      db.ts                  -- better-sqlite3 连接 + 迁移(建表)
      logicalModels.ts       -- logical_models 表 CRUD
      providers.ts           -- providers 表 CRUD
      requestLogs.ts         -- request_logs 表 写入 + 查询
      budgets.ts             -- budgets 表 CRUD + 用量汇总查询
      modelsDevCache.ts      -- models_dev_cache 表 读写

    canonical/
      types.ts               -- Canonical 请求/响应/流 事件类型(阶段2 定义, 见下占位)

    inbound/
      detect.ts              -- 从 HTTP 路径/请求体识别客户端格式
      chat.ts                -- parseChat: OpenAI chat 请求体 → CanonicalRequest
      responses.ts           -- parseResponses: OpenAI responses 请求体 → CanonicalRequest
      anthropic.ts           -- parseAnthropic: Anthropic messages 请求体 → CanonicalRequest

    outbound/
      model.ts               -- 由 provider 配置构造 AI SDK LanguageModel 实例
      execute.ts             -- 用 AI SDK 执行 Canonical 请求(流式/非流式) → Canonical 结果
      serializeChat.ts       -- Canonical 结果 → OpenAI chat wire 格式(含 SSE)
      serializeResponses.ts  -- Canonical 结果 → OpenAI responses wire 格式(含 SSE)
      serializeAnthropic.ts  -- Canonical 结果 → Anthropic messages wire 格式(含 SSE)

    router/
      resolve.ts             -- 逻辑模型名 → 有序启用的 provider 列表
      fallback.ts            -- fallback 执行引擎(依次尝试, 判定是否降级)

    cost/
      pricing.ts             -- 由 models_dev_id + token 用量 计算 cost_usd
      modelsDev.ts           -- 拉取 models.dev 并写入缓存
      budget.ts              -- 预算检查(请求前) + 用量汇总

    admin/
      routes.ts              -- Hono 子路由: CRUD + 日志/预算查看 API
      auth.ts                -- admin 鉴权中间件
      ui/                    -- 静态管理界面(阶段4 决定形态)

  tests/
    store/ inbound/ outbound/ router/ cost/ admin/   -- 与 src 镜像
  docs/superpowers/
    specs/2026-07-11-polyglot-ai-relay-design.md
    plans/*.md
```

## 全局共享 TS 类型（`src/types.ts`）

阶段 1 创建本文件，内容如下（后续阶段只在本文件追加，不改已有字段名）：

```typescript
// ---- 格式标识 ----
export type WireFormat = 'chat' | 'responses' | 'anthropic';

// ---- 数据模型行类型(与 SQLite 表一一对应) ----
export interface LogicalModel {
  id: number;
  name: string;            // 用户自起, 如 "my-sonnet"
  created_at: string;      // ISO 8601
}

export interface Provider {
  id: number;
  logical_model_id: number;
  priority: number;                 // 升序 = 尝试顺序
  upstream_format: WireFormat;      // 打给上游用的格式
  base_url: string;
  api_key: string;
  upstream_model: string;           // 上游真实模型名
  models_dev_id: string | null;     // 关联 models.dev, 如 "anthropic/claude-sonnet-4"
  fallback_status_codes: number[];  // 额外触发 fallback 的状态码(存储为 JSON TEXT)
  enabled: boolean;                 // 存储为 0/1
}

export interface RequestLog {
  id: number;
  logical_model_id: number;
  hit_provider_id: number | null;   // 最终命中的 provider; 全失败为 null
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
  attempts: number;                 // 尝试了几个 provider
  created_at: string;               // ISO 8601
}

export type BudgetScope = 'global' | 'logical_model';
export type BudgetPeriod = 'day' | 'month' | 'total';
export type BudgetAction = 'warn' | 'block';

export interface Budget {
  id: number;
  scope: BudgetScope;
  target_id: number | null;         // scope=logical_model 时指向 logical_models.id
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

export interface UnitPrice {                 // 每百万 token 美元价
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}
```

## Canonical 类型（`src/canonical/types.ts`，阶段 2 定义）

阶段 2 负责定义。约定：Canonical 直接采用/薄封装 AI SDK v5 的 `ModelMessage[]` 作为请求消息表示，加上顶层参数。占位签名（阶段 2 细化）：

```typescript
import type { ModelMessage } from 'ai';

export interface CanonicalRequest {
  model: string;                    // 逻辑模型名
  system?: string;
  messages: ModelMessage[];         // AI SDK 规范消息
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  reasoning?: { effort?: string; budget_tokens?: number };
  extra?: Record<string, unknown>;  // 无法映射的字段原样透传
}

export interface CanonicalResult {
  text: string;
  tool_calls: unknown[];
  finish_reason: string;
  usage: TokenUsage;                // 从 src/types.ts 导入
  raw_provider_metadata?: unknown;
}
```

## 跨阶段接口约定（关键签名，各阶段照此实现，不得改名）

```typescript
// store/db.ts
export function openDb(path: string): Database;      // better-sqlite3 Database
export function migrate(db: Database): void;         // 幂等建表

// router/resolve.ts
export function resolveChain(db: Database, logicalModelName: string): Provider[];
//   返回按 priority 升序、enabled 的 provider 列表; 逻辑模型不存在返回 []

// router/fallback.ts
export interface AttemptOutcome {
  provider: Provider;
  ok: boolean;
  status?: number;
  error?: Error;
}
export function shouldFallback(outcome: AttemptOutcome): boolean;
//   硬失败(连接错误/超时/5xx/429)或 status ∈ provider.fallback_status_codes → true

// outbound/model.ts
import type { LanguageModel } from 'ai';
export function buildModel(provider: Provider): LanguageModel;

// cost/pricing.ts
export function computeCost(price: UnitPrice, usage: TokenUsage): number;   // 返回 cost_usd
export function lookupPrice(db: Database, modelsDevId: string): UnitPrice | null;

// cost/budget.ts
export interface BudgetStatus { budget: Budget; spent_usd: number; limit_usd: number; action: BudgetAction; over: boolean; }
export function checkBudgets(db: Database, logicalModelId: number): BudgetStatus[];
//   请求前调用; 任一 over && action==='block' → 调用方拒绝请求
```

## 全局约束

- Node ≥ 22，TypeScript ≥ 5.6，ESM（`"type": "module"`）。
- 所有金额单位统一为**美元**，`cost_usd` 为浮点。
- SQLite 布尔存 0/1，数组/对象存 JSON TEXT，读出时在 store 层转换成上面类型。
- 每个任务遵循 TDD：先写失败测试 → 验证失败 → 最小实现 → 验证通过 → 提交。
- 提交信息用 Conventional Commits（`feat:` / `test:` / `chore:`）。
- 安全：admin 面板与转发端点默认需鉴权（阶段 4 落实），不裸奔公网。
