# 架构详解

本文解释 Polyglot 的内部结构、请求生命周期、关键设计决策。

## 分层总览

```
┌──────────────────────────────────────────────────────────┐
│ server.ts  (Hono + @hono/node-server)                    │
│   /v1/*       → createRelay (relay.ts)                   │
│   /admin      → 静态 UI (admin/mount.ts)                 │
│   /admin/api  → createAdminRoutes (admin/routes.ts) [鉴权]│
└──────────────────────────────────────────────────────────┘
        │ /v1/* 请求
        ▼
┌──────────────────────────────────────────────────────────┐
│ convert.ts  handleRequest(db, clientFormat, body)        │
│                                                          │
│  1. parseInbound(clientFormat, body) → CanonicalRequest  │
│  2. resolveChain(db, req.model) → Provider[]   (router)  │
│     └─ 空链 → 404                                        │
│  3. checkBudgets → blockingBudget? → 402 budget_exceeded │
│  4a. 流式: runner.stream(首provider) → serializeSSE       │
│      └─ 开流后不再 fallback;成本经 resultPromise 记日志  │
│  4b. 非流式: runChain(execute) → serializeJson           │
│      └─ fallback 降级;成功后 costForProvider 记日志      │
└──────────────────────────────────────────────────────────┘
        │ Canonical ↔ 各家 wire 格式
        ▼
┌──────────────────────────────────────────────────────────┐
│ inbound/   parseChat / parseResponses / parseAnthropic   │
│ outbound/  execute (AI SDK) + serialize{Chat,...}{Json,SSE}│
│ router/    resolveChain + shouldFallback + runChain      │
│ cost/      modelsDev / pricing / budget / apply          │
│ store/     SQLite (5 表)                                 │
└──────────────────────────────────────────────────────────┘
```

## 请求生命周期(非流式)

以「客户端发 OpenAI Chat,上游走 Anthropic」为例:

1. **入站** `parseChat(body)` —— 把 `{messages:[{role:'system'...},{role:'user'...}]}` 转成 `CanonicalRequest{system, messages: ModelMessage[]}`。system 提到顶层(AI SDK 7 默认拒绝 messages 里的 system role)。
2. **解析链** `resolveChain(db, 'my-sonnet')` —— 查 logical_models → providers,返回按 priority 升序、enabled 的 provider 列表。
3. **预算检查** `checkBudgets(db, logicalModelId)` —— 汇总 request_logs.cost_usd,对比上限。任一 over + block → 直接 402,不打上游。
4. **执行(带 fallback)** `runChain(chain, provider => execute(buildModel(provider), req))`:
   - `buildModel(provider)` 依 `upstream_format` 选 `createAnthropic(...)(upstream_model)`(或 OpenAI 的 `.chat()/.responses()`)。
   - `execute` 调 AI SDK 7 `generateText`。失败抛错(可能带 `statusCode`)。
   - `shouldFallback` 判定:5xx/429/无状态码/`fallback_status_codes` 命中 → 降级下一个 provider;普通 4xx → 停。
   - `extractStatus` 读 AI SDK 错误的 `statusCode`(非 `status`)——这是 Phase 1 broad review 抓到的关键修正。
5. **成本** `costForProvider(db, hitProvider, usage)` —— `lookupPrice` 查 models.dev 缓存 → `computeCost`。
6. **日志** `insertRequestLog(...)` —— 记 token 四分类、cost_usd、命中 provider、尝试次数、延迟、状态。
7. **出站** `serializeJson(clientFormat, model, result)` —— 按**客户端**格式(chat)序列化,不是上游格式。

## 请求生命周期(流式)

`req.stream === true` 时走不同分支:

- **只用链上第一个 provider**,不 fallback(开流后无法干净降级)。
- `runner.stream(provider, req)` → AI SDK `streamText` → 消费**全 part 流**(`result.stream`,v7),映射成 `StreamEvent`(`{kind:'text'} | {kind:'tool-call'}`)。
- `serializeSSE(clientFormat, model, events)` 把事件流转成客户端格式的 SSE 字节流,边收边发。
- 成本/日志在 `resultPromise` resolve 后异步写入(fire-and-forget,已用 try/catch 包裹防 unhandled rejection)。

## Canonical 中间表示

核心设计:所有格式转换经一个中立表示,而非 N×N 两两转换器。加一种格式只需写它的 in/out 两个 adapter。

```typescript
interface CanonicalRequest {
  model: string;              // 逻辑模型名
  system?: string;            // 提取自各家 system,执行时作为顶层 instructions
  messages: ModelMessage[];   // AI SDK 7 规范消息(含 ToolCallPart/ToolResultPart)
  tools?: unknown[];          // wire 形工具定义 → toToolSet 转 ToolSet
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number; top_p?: number; stop?: string[];
  stream: boolean;
  reasoning?: { effort?: string };   // → AI SDK 顶层 reasoning(string 枚举)
  extra?: Record<string, unknown>;   // 无法映射的字段原样透传
}

interface CanonicalResult {
  text: string;
  tool_calls: CanonicalToolCall[];   // {toolCallId, toolName, args(JSON字符串)}
  finish_reason: string;
  usage: TokenUsage;                  // input/output/cache_read/cache_write
  raw_provider_metadata?: unknown;
}
```

## Tool / Function Calling

转发器**透传**工具,不执行(执行在客户端下一轮回传)。完整支持链路:

- **入站**:三家解析器把工具定义(OpenAI 的 `{type:'function',function:{...}}`、Anthropic 的 `tools:[{name,input_schema,...}]`、Responses 的同名形)转成 AI SDK `ToolSet`(`tool({inputSchema: jsonSchema(parameters), description})`,**无 execute**)。assistant 的 tool_call、tool/tool_result 消息转成 `ToolCallPart`/`ToolResultPart`。
- **执行**:`buildCallOptions` 转发 `tools`/`toolChoice`;`extractToolCalls` 把 `result.toolCalls` 提取成 `CanonicalToolCall[]`(`args` 统一为 JSON 字符串)。
- **出站**:三格式 JSON 序列化器发 tool_calls(chat 的 `function.arguments`、anthropic 的 `tool_use.input`(parse 回对象)、responses 的 `function_call`)。流式 SSE 按 part 发:chat 发 `delta.tool_calls` chunk;anthropic 发 `content_block_start`(tool_use)+`input_json_delta`;responses 发 `output_item.added`+`function_call_arguments.delta`。

## Fallback 引擎

`src/router/fallback.ts`:

```typescript
shouldFallback(outcome):
  ok            → false
  status===undefined(连接/超时) → true
  status>=500   → true
  status===429  → true
  status ∈ provider.fallback_status_codes → true
  其它(4xx)     → false   // 不浪费配额

runChain(chain, attempt):
  依次尝试;成功即返回 {value, outcome:{ok:true}, attempts}
  shouldFallback→继续;否则停;全失败返回最终 outcome
```

关键:`extractStatus` 读 AI SDK `APICallError.statusCode`(非 `.status`)。否则真实上游 400 会误判成连接错误、全链烧穿。

## 成本与计价

```
models.dev api.json
  → refreshModelsDev (fetch + 校验 JSON + 存 cache 表)
  → getCachedData (读 + parse,corrupt 时返回 null 不崩)
  → lookupPrice(modelsDevId)  支持 "provider/key" 与裸 key 两种形态
  → computeCost(price, usage) = Σ(token×price)/1e6

checkBudgets(db, modelId):
  global 预算 → 汇总全部 cost_usd
  logical_model 预算 → 只汇总该模型
  periodStart(day/month/total) → UTC 边界
  over = spent >= limit
```

预算检查在**请求前**做(check-before-act);成本在**请求后**按实际命中 provider 记。这意味着单个请求可能把花费推过上限一点(下一次才拦),对个人自用可接受。

## 数据模型(SQLite,5 表)

- `logical_models` (id, name, created_at)
- `providers` (id, logical_model_id, priority, upstream_format, base_url, api_key, upstream_model, models_dev_id, fallback_status_codes JSON, enabled 0/1)
- `request_logs` (id, logical_model_id, hit_provider_id, client_format, upstream_format, 4 类 tokens, cost_usd, latency_ms, status, error, attempts, created_at)
- `budgets` (id, scope, target_id, limit_usd, period, action)
- `models_dev_cache` (id=1 单行, data JSON, fetched_at)

布尔存 0/1、数组/对象存 JSON TEXT,store 层转换。`CREATE TABLE IF NOT EXISTS` 幂等迁移。

## AI SDK 7 关键点

实现中踩到的、与旧版/计划假设不同的地方(均已处理):

- `reasoning` 是**字符串枚举**(`'low'|'medium'|'high'|...`),不是 `{effort, budget_tokens}` 对象。
- cache token 在 `usage.inputTokenDetails.cacheReadTokens/cacheWriteTokens`,不是顶层 `cachedInputTokens`。
- Anthropic 的 cacheCreation 在 `providerMetadata.anthropic.cacheCreationInputTokens`(不在 inputTokenDetails)。
- `LanguageModelCallOptions`(非 `LanguageModelV4CallOptions`)从 `ai` 导出。
- 流式用 `result.stream`(全 part 流),`fullStream` 已弃用。
- `system` → `instructions`(`system` 弃用但仍可用)。
- 默认拒绝 messages 里的 system role(防注入)——所以入站解析把 system 提到顶层。

## 已知限制

见 README「已知限制」与 `docs/superpowers/specs/...-design.md` §10「明确不做」。摘要:tiered pricing 未处理、流式 fallback 不支持(开流即定)、并发预算竞态(check-before-act)、admin token 非 timing-safe 比较。
