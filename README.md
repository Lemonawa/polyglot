# Polyglot

> 面向个人的 AI API 转发器（relay / proxy）。传入传出格式解耦 + 以模型为中心的 provider fallback 链 + 官方价成本控制。

Polyglot 是为「一个人用」设计的 AI 网关,刻意不堆多租户、令牌分组、充值系统等让 [New API](https://github.com/QuantumNous/new-api/) 变重的东西。两个核心特色:

1. **传入/传出格式解耦** —— 客户端用任意主流格式请求(`/v1/chat/completions`、`/v1/responses`、`/v1/messages`),转发器可用另一种格式打给上游,响应再转回客户端要的格式。例:客户端发 OpenAI Chat,上游走 Anthropic Messages。
2. **以模型为中心的 provider fallback 链** —— 每个「逻辑模型」挂一条有序 provider 链,按优先级依次尝试,失败降级。不是 New API 那种以 provider(channel)为中心。

外加:按 [models.dev](https://models.dev) 官方价计算每次请求成本、预算上限(到顶 402 拦截或告警)、token 保护的 Web 管理台。

## 状态

可用。OpenAI Chat / OpenAI Responses / Anthropic Messages 三格式两两互转(含流式 SSE 与 tool calling);SQLite 持久化;admin UI 可视化配置模型链 / provider / 预算。TypeScript 7 + AI SDK 7。

---

## 快速开始

### 1. 安装

```bash
git clone <repo> polyglot && cd polyglot
npm install        # Node ≥ 22
```

### 2. 启动

```bash
# 开发(热重载)
npm run dev

# 生产
npm run build && npm start
```

默认监听 `:8787`,数据库文件 `polyglot.sqlite`。环境变量:

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `DB_PATH` | `polyglot.sqlite` | SQLite 文件路径 |
| `ADMIN_TOKEN` | _(空)_ | 管理台 token。**为空则不挂载 admin 面板**(fail-closed) |

### 3. 配置一条链(二选一)

**A. Web 管理台**(推荐):设 `ADMIN_TOKEN` 启动后访问 `/admin`,填 token 连接,即可在网页上增删改查模型链、provider、预算。

```bash
ADMIN_TOKEN=your-secret npm run dev
# 浏览器打开 http://localhost:8787/admin
```

**B. REST API**(脚本/自动化):所有 `/admin/api/*` 需 `Authorization: Bearer <ADMIN_TOKEN>`。

```bash
T=$ADMIN_TOKEN

# 1) 建逻辑模型
curl -sX POST localhost:8787/admin/api/models -H "Authorization: Bearer $T" \
  -H "content-type: application/json" -d '{"name":"my-sonnet"}'
# → {"model":{"id":1,"name":"my-sonnet",...}}

# 2) 给它挂 provider 链(优先级 0 先试、1 降级)
curl -sX POST localhost:8787/admin/api/models/1/providers -H "Authorization: Bearer $T" \
  -H "content-type: application/json" -d '{
    "priority": 0,
    "upstream_format": "anthropic",
    "base_url": "https://api.anthropic.com",
    "api_key": "sk-ant-...",
    "upstream_model": "claude-sonnet-4-20250514",
    "models_dev_id": "anthropic/claude-sonnet-4",
    "fallback_status_codes": [429, 529],
    "enabled": true
  }'

# 3) 拉取官方价目(成本计算依赖它)
curl -sX POST localhost:8787/admin/api/models-dev/refresh -H "Authorization: Bearer $T"
```

### 4. 发请求(任意客户端格式)

```bash
# 用 OpenAI Chat 格式请求,上游走 Anthropic —— 格式自动转换
curl -sX POST localhost:8787/v1/chat/completions -d '{
  "model": "my-sonnet",
  "messages": [{"role":"user","content":"你好"}],
  "stream": true
}'
```

把任何兼容 OpenAI / Anthropic / Responses 的客户端的 `base_url` 指向 `http://localhost:8787` 即可。

---

## 两大特色详解

### 特色 1:格式解耦

客户端格式(请求进来的端点)与上游格式(打到 provider 的格式)**互相独立**。转换经一个中立的 Canonical 中间表示(基于 AI SDK 7 的 `ModelMessage[]`):

```
客户端请求 (chat/responses/anthropic)
  → 入站解析 → CanonicalRequest
  → 按 provider.upstream_format 选 AI SDK 模型执行
  → CanonicalResult
  → 按客户端格式序列化 → 返回
```

支持:
- 三格式两两互转(9 种组合)
- 流式 SSE 跨格式转换(边收边转)
- tool / function calling(工具定义 + tool-call/tool-result 消息透传,转发器不执行工具)
- system 提示自动提到顶层(AI SDK 7 要求)
- prompt cache 计量(OpenAI cacheWriteTokens + Anthropic cacheCreationInputTokens 都正确读)

### 特色 2:模型为中心的 fallback 链

每个逻辑模型(如 `my-sonnet`)配置一条**有序 provider 链**:

```
my-sonnet:
  优先级 0: Anthropic 官方     (anthropic / claude-sonnet-4)
  优先级 1: AWS Bedrock        (anthropic / claude-sonnet-4)
  优先级 2: 某中转站           (chat / claude-sonnet-4)
```

请求按顺序尝试,失败降级:

- **默认降级触发**:连接错误、超时、5xx、429。
- **可自定义**:每条 provider 可设 `fallback_status_codes`(如 402 余额不足、403)也触发降级。
- **不降级**:普通 4xx(如 400 参数错误)直接返回,不浪费配额。
- **开流后不降级**:一旦响应流已经开始向客户端输出,出错直接中断(避免内容错乱);仅非流式请求走完整 fallback。

成本按**实际命中的 provider**的 `models_dev_id` 查 models.dev 官方价计算。

---

## 成本控制

- **成本 = Σ(token × 官方单价 / 1,000,000)**,四类 token:input / output / cache_read / cache_write。
- 直接用 models.dev 官方价,**不搞 ratio / quota 中间货币体系**。
- 单价由 `models_dev_id`(如 `anthropic/claude-sonnet-4`)关联;手动刷新缓存。
- **预算**:全局或单模型,周期 day / month / total,动作 block(到顶新请求返回 402)或 warn。
- 已知限制:models.dev 的 tiered pricing(如 Gemini >200K context 翻倍)未处理,高端上下文请求会低估成本(`src/cost/pricing.ts` 有注释)。

---

## 安全

- `/v1/*` 转发端点:开放(上游 provider 的 key 在服务端配置,客户端不接触)。
- `/admin/api/*`:需 `Authorization: Bearer <ADMIN_TOKEN>`。
- `/admin`(HTML 页面):无 token 即可加载(纯静态,token 在浏览器端输入存 localStorage)。
- **`ADMIN_TOKEN` 为空时不挂载 admin 面板**(fail-closed)。
- provider 的 `api_key` 不会从 admin REST 返回(已剥离)。
- ⚠️ **不要裸奔公网**。个人自用请放内网或加反代鉴权。

---

## 项目结构

```
src/
  types.ts                 全局共享类型
  server.ts                Hono 入口,装配转发 + admin
  relay.ts                 /v1/* 路由(转发到 handleRequest)
  convert.ts               请求编排:入站→预算→链→执行→成本→日志→出站
  canonical/types.ts       Canonical 中间表示
  inbound/                 三格式入站解析 → Canonical
  outbound/                AI SDK 执行 + 三格式序列化(JSON + SSE)
  router/                  resolveChain(逻辑模型→链) + fallback(降级引擎)
  cost/                    modelsDev 拉取、pricing、budget、apply
  store/                   SQLite 数据层
  admin/                   auth、routes(REST)、mount、ui(单页)
docs/
  superpowers/specs/       设计文档
  superpowers/plans/       分阶段实现计划 + 工具调用计划
  architecture.md          架构详解
  api-reference.md         REST / 转发端点 API 参考
```

更多见 [docs/architecture.md](docs/architecture.md) 和 [docs/api-reference.md](docs/api-reference.md)。

## 开发

```bash
npm test           # vitest,全量
npm run typecheck  # tsc --noEmit
npm run build      # tsc + 拷贝 admin UI
npm run lint       # biome
```

## 技术栈

- TypeScript 7(原生 Go 编译器)、Node ≥ 22、ESM
- [Hono](https://hono.dev/) HTTP 层
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 存储
- [Vercel AI SDK 7](https://ai-sdk.dev/) (LanguageModelV2) 做格式适配 + 流式解析
- [models.dev](https://models.dev) 官方价目
- vitest 测试、biome lint

## 许可

MIT
