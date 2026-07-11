# Polyglot — 面向个人的 AI 转发器 设计文档

日期：2026-07-11
状态：设计已确认，待评审

## 1. 背景与目标

现有的 [New API](https://github.com/QuantumNous/new-api/) 面向多租户运营场景，功能繁重、bug 多，个人自用体验不佳。Polyglot 是一个**面向个人**的 AI API 转发器（relay/proxy），只做少数几件事、做扎实，刻意不做多租户、令牌分组、充值系统等让 New API 变复杂的东西。

两个 New API 没有、而我们作为核心特色的功能：

1. **传入/传出格式解耦**：客户端可用任意主流格式请求（如 OpenAI `messages`），转发器可用另一种格式（如 OpenAI `responses`）打给上游，响应再转回客户端要的格式。
2. **以模型为中心的 provider fallback 链**：为每个「逻辑模型」配置一条**有序的 provider 降级链**，而不是像 New API 那样以 provider（channel）为中心。请求打到逻辑模型，按链顺序尝试，失败降级到下一个。

设计基调：**用得舒服是王道。** 复用 TS 生态现成的成熟组件，避免重造轮子，尤其避开 New API 的 bug 泥潭。

## 2. 技术栈

- **语言/运行时**：TypeScript / Node.js
- **HTTP 层**：Hono（轻量、编译后单进程部署友好）
- **格式适配核心**：复用 **Vercel AI SDK v5** 的 `LanguageModelV2` 规范作为内部 Canonical 表示，`@ai-sdk/openai`、`@ai-sdk/anthropic` 等 provider 包负责「出站序列化 + 响应/流式解析」——这是最容易出 bug 的部分，直接复用久经考验的实现。
- **存储**：SQLite 单文件（零外部依赖，一个文件带走全部数据）
- **模型价目数据**：[models.dev](https://models.dev/) 的 `api.json`（社区维护、持续更新，含各模型 input/output/cache_read/cache_write 官方单价）

## 3. 整体架构

所有格式转换都经过一个**中立的中间统一表示（Canonical）**，而非 N×N 两两写转换器。新增一种格式只需写它的 in/out 两个 adapter，就自动能和所有其他格式互转。这是避免 New API 转换逻辑一团乱的关键。

```
客户端请求(任意格式)
   │
   ▼
Inbound Adapter  ── 识别并解析传入格式(chat/responses/anthropic) → Canonical
   │
   ▼
Router  ── 逻辑模型 → 有序 provider fallback 链
   │
   ▼
对链上每个 provider 依次尝试:
   Outbound Adapter (Canonical → 该 provider 格式, 复用 AI SDK provider 包)
   → 发请求
   → 失败(硬失败/自定义状态码)则降级下一个 provider
   │
   ▼
Response Adapter  ── 上游响应/流 → Canonical → 转回客户端要的格式
   │
   ▼
记录 token 用量 / 成本 → 返回客户端
```

### 构建 vs 复用（决策 A）

| 部分 | 方案 |
|---|---|
| 出站序列化（Canonical → 各家格式）| 复用 AI SDK provider 包 |
| 响应 / 流式解析（各家格式 → Canonical）| 复用 AI SDK provider 包（最难的部分省了）|
| **入站解析**（客户端原始 HTTP 请求 → Canonical）| 自己写，三种格式各一个 |
| **出站再序列化成客户端要的格式** | 部分自己写（把 AI SDK 的输出结构转回客户端要的 wire 格式）|
| 模型为中心的 fallback 路由 | 自己写 |
| 成本 / 预算 | 自己写 |

说明：AI SDK 的 `LanguageModelV2` 是**客户端抽象**，假设「你的代码」是请求发起方，因此它提供出站 + 响应解析，但不提供「接收一个原始 OpenAI/Anthropic 格式 HTTP 请求」的入站解析器——入站那半必须自己写。

未来演进：若 AI SDK 表达不了某个格式/新特性，再演进到「混合」方案（出站能用 AI SDK 就用，表达不了的留手写逃生口）。第一版不做。

## 4. 数据模型（SQLite）

```
logical_models          逻辑模型（用户自起的名字）
  id, name (如 "my-sonnet"), created_at

providers               provider 链条目（一个逻辑模型下有序多条）
  id, logical_model_id, priority,      -- priority 用于排序
  upstream_format,                     -- 打给上游的格式: chat / responses / anthropic
  base_url,                            -- 如 https://api.anthropic.com
  api_key,
  upstream_model,                      -- 上游真实模型名, 如 claude-sonnet-4-20250514
  models_dev_id,                       -- 关联 models.dev 的 id, 用于按官方价算成本
  fallback_status_codes,               -- 可选 JSON, 额外触发 fallback 的状态码, 如 [402,403]
  enabled

request_logs            每次请求一条
  id, logical_model_id, hit_provider_id,   -- 最终命中的 provider
  client_format, upstream_format,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
  cost_usd, latency_ms, status, error, attempts,   -- attempts: 尝试了几个 provider
  created_at

budgets                 预算（成本控制）
  id, scope,                           -- global / logical_model
  target_id,                           -- scope=logical_model 时指向 logical_models.id
  limit_usd, period,                   -- month / day / total
  action                               -- warn / block

models_dev_cache        拉取的 models.dev 数据缓存
  data (JSON), fetched_at
```

要点：
- provider 链用 `priority` 排序；每条链条目自带格式、上游模型、密钥。
- **逻辑模型名不要求与 models.dev 的 slug 匹配**——每条 provider 条目通过 `models_dev_id` 显式关联。

## 5. 格式转换（Canonical + Adapter）

第一版支持三种主流格式**两两互转**：

- OpenAI Chat Completions（`/v1/chat/completions`，即 `messages` 格式）
- OpenAI Responses（`/v1/responses`）
- Anthropic Messages（`/v1/messages`）

Canonical 即 AI SDK v5 的 `LanguageModelV2` prompt/结果表示。围绕它：

```
入站（自己写）:  parseChat / parseResponses / parseAnthropic
                客户端请求 → Canonical

出站（复用 AI SDK provider 包）:
                Canonical → 上游各家格式请求, 发送, 解析响应/流 → Canonical 结果

出站→客户端（部分自己写）:
                serializeChatResponse / serializeResponsesResponse / serializeAnthropicResponse
                Canonical 结果 → 客户端要的 wire 格式
```

### 流式转换（决策 A）

**第一版完整支持流式跨格式转换**：三种格式的流两两互转都做，边收边转发，客户端始终拿到它要的格式的流。流式是 AI 转发器的刚需，个人几乎全程使用流式，不能退化成非流式（体验割裂 + 易踩上游超时）。

底层各家流式解析复用 AI SDK provider 包的 `doStream`，我们负责把 AI SDK 的 stream part 再序列化成客户端要格式的 SSE 事件。

## 6. Fallback 执行流程（决策 B）

请求打到逻辑模型后，按 `priority` 取出**启用的** provider 链，依次尝试：

**触发 fallback 的条件**：
- **默认硬失败**：连接错误、超时、5xx、429。
- **可自定义**：每条 provider 条目可通过 `fallback_status_codes` 把额外状态码（如 402 余额不足、403）也纳入 fallback 触发。
- 业务错误（如 400 参数错误）默认**不** fallback，直接返回给客户端。

**流式已开始后出错**：一旦已经向客户端吐出流内容，就**不再 fallback**，直接中断连接。因为客户端已收到部分内容，切换 provider 重发会导致内容错乱。

`request_logs.attempts` 记录本次请求实际尝试了几个 provider，`hit_provider_id` 记录最终命中的那个。

## 7. 成本控制（决策 B）

**成本 = Σ(各类 token 数 × 该类官方单价 / 1e6)**，直接对着**官方价**算美元，不搞 New API 那套 ratio × quota × group 的中间货币体系（那正是 New API 复杂到失控的根源）。

**单价来源**：直接取命中 provider 的 `models_dev_id` 在 models.dev 中的官方 `cost`。第一版**不做手填覆盖、不做 ratio**——目标是「对着官方价看这些 token 值多少钱」，作为成本的统一标尺。中转站的真实差价第一版不追求精确还原。

**Token 分类**（对齐 models.dev 的 `cost` 字段，也借鉴 New API 把 token 分类算细这一点）：
- `input`（普通输入）
- `output`（输出）
- `cache_read`（缓存命中，便宜）
- `cache_write`（缓存写入，较贵）
- image / audio / web_search 等第一版不做

**预算（budgets）**：
- 请求**前**检查：`block` 模式下超预算直接拒绝请求；`warn` 模式仅告警。
- 成本在请求**后**依据实际 token 用量记录进 `request_logs`。
- 预算作用域：全局 或 单个逻辑模型；周期：day / month / total。

**models.dev 缓存**：定期或手动刷新 `models_dev_cache`，价格自动更新，不维护死表。

## 8. 配置与管理界面（决策 C）

- **SQLite 单文件**存全部配置与日志。
- **可编辑的 Web 管理界面**，但**只做「增删改查逻辑模型与 provider 链」这一件事，做扎实**。这正是 New API bug 最多的地方，我们靠收窄范围来保证质量。
- 管理界面同时展示 `request_logs`（成本、命中的 provider、fallback 尝试次数、延迟）与预算状态。
- 不做多租户、令牌分组、充值系统。

### 安全提示

管理界面与转发端点默认应有访问控制（至少一个管理密码 / API key 保护 admin 面板，转发端点用配置的 key 鉴权）。面向个人也不能裸奔在公网。实现阶段需明确鉴权方案。

## 9. 系统单元划分

各单元单一职责、通过清晰接口通信、可独立测试：

- **inbound/**：三个入站解析器（chat / responses / anthropic）→ Canonical。
- **outbound/**：基于 AI SDK provider 包的出站封装 + 响应/流再序列化回客户端格式。
- **router/**：逻辑模型 → provider 链解析 + fallback 执行引擎。
- **cost/**：token 计价 + 预算检查 + models.dev 缓存拉取。
- **store/**：SQLite 数据访问层（logical_models / providers / request_logs / budgets / models_dev_cache）。
- **admin/**：Web 管理界面（CRUD + 日志/预算查看）。
- **server/**：Hono HTTP 入口，装配上述单元。

## 10. 明确不做（YAGNI）

- 多租户、用户系统、令牌分组、充值/支付
- ratio / quota 中间货币体系
- 手填单价覆盖（第一版；成本统一用 models.dev 官方价）
- 成本感知路由（按价格排序 provider，与可靠性优先的 fallback 顺序冲突）
- 缓冲式流式 fallback（一旦开流即中断）
- Gemini 等第三方格式（第一版只做 chat / responses / anthropic）
- image / audio / web_search 等特殊计费项

## 11. 待实现阶段明确的问题

- 管理面板与转发端点的具体鉴权方案（密码 / API key / 会话）。
- AI SDK v5 provider 包对 Responses 格式出站的覆盖程度核实（若不足，该格式出站可能需要手写逃生口）。
