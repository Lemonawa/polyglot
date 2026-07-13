# API 参考

Polyglot 暴露三类端点:**转发端点**(兼容 OpenAI / Anthropic / Responses 客户端)、**admin REST**(配置管理)、**admin 页面**。

所有转发端点 path 参数里的 `model` 是你在 admin 里配的**逻辑模型名**(如 `my-sonnet`),不是上游真实模型名。

---

## 一、转发端点(`/v1/*`)

无需鉴权(上游 key 在服务端配)。三个端点对应三种客户端格式,任选其一。

### POST `/v1/chat/completions`(OpenAI Chat)

兼容 OpenAI Chat Completions。`model` = 逻辑模型名。

```json
{
  "model": "my-sonnet",
  "messages": [
    {"role": "system", "content": "你是个简洁的助手"},
    {"role": "user", "content": "你好"}
  ],
  "temperature": 0.5,
  "max_tokens": 100,
  "stream": false,
  "tools": [
    {"type": "function", "function": {"name": "get_weather", "description": "...", "parameters": {...}}}
  ],
  "tool_choice": "auto"
}
```

响应:标准 `chat.completion` 对象(含 `choices[0].message`、`usage`)。`stream:true` 时返回 SSE(`text/event-stream`),发 `chat.completion.chunk` + `data: [DONE]`。

### POST `/v1/messages`(Anthropic Messages)

兼容 Anthropic Messages API。`system` 是顶层字段,`max_tokens` 必填。

```json
{
  "model": "my-sonnet",
  "system": "你是个简洁的助手",
  "max_tokens": 100,
  "messages": [{"role": "user", "content": "你好"}],
  "stream": true
}
```

响应:`{type:'message', role:'assistant', content:[{type:'text',text}], usage:{input_tokens,output_tokens}}`。流式发 `message_start` → `content_block_*` → `message_stop`。含 `tool_use` content block(工具调用时)。

### POST `/v1/responses`(OpenAI Responses)

兼容 OpenAI Responses API。`instructions` → system,`input` 可为字符串或消息数组,`max_output_tokens` → max_tokens。

```json
{
  "model": "my-gpt",
  "instructions": "简洁回答",
  "input": "2+2等于几",
  "max_output_tokens": 64,
  "stream": false
}
```

响应:`{object:'response', output_text, output:[...], usage}`。流式发 `response.created` → `response.output_text.delta` → `response.completed`。含 `function_call` output 项(工具调用时)。

### 跨格式

**客户端格式(请求端点)与上游格式(provider 的 `upstream_format`)互相独立**,自动经 Canonical 转换。例:用 `/v1/chat/completions` 请求,但 provider 配的是 anthropic 上游 —— 照常工作。

### 错误响应

| 状态 | 含义 |
|---|---|
| 200 | 成功 |
| 402 | 预算超限(block 动作),不打上游。body `{error:{type:'budget_exceeded'}}` |
| 404 | 未知逻辑模型名 |
| 502 | 链上所有 provider 都失败(或单个不降级错误)。body 含 `error.message` |

### 流式行为

- 流式请求**只用链上第一个 provider**(开流后无法干净降级)。
- 上游中途出错:流直接中断(客户端收到的流被截断)。
- 非流式请求才走完整 fallback 链。

---

## 二、Admin REST(`/admin/api/*`)

全部需 `Authorization: Bearer <ADMIN_TOKEN>`(`ADMIN_TOKEN` 环境变量;为空则整个 admin 不挂载)。401 表示 token 错。

### 逻辑模型

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/models` | 列出全部 → `{models:[{id,name,created_at}]}` |
| POST | `/models` | 新增,body `{name}` → 201 `{model}` |
| DELETE | `/models/:id` | 删除模型(级联删其 provider)→ 204 |

### Provider 链

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/models/:id/providers` | 该模型的 provider 链(按 priority 升序)→ `{providers:[...]}`。**响应剥离 api_key** |
| POST | `/models/:id/providers` | 加 provider,body 是 ProviderInput(见下,不含 `logical_model_id`,用路径 id)→ 201 `{provider}` |
| PATCH | `/providers/:id` | 改 provider,body 是 Partial<ProviderInput> → `{ok:true}` |
| DELETE | `/providers/:id` | 删 → 204 |

**ProviderInput**:

```typescript
{
  priority: number,              // 升序 = 尝试顺序,0 最先
  upstream_format: 'chat' | 'responses' | 'anthropic',  // 打给上游用什么格式
  base_url: string,              // 如 https://api.anthropic.com
  api_key: string,               // 上游 key(写入用;读出不返回)
  upstream_model: string,        // 上游真实模型名,如 claude-sonnet-4-20250514
  models_dev_id: string | null,  // 关联 models.dev,如 anthropic/claude-sonnet-4(算成本用)
  fallback_status_codes: number[], // 额外触发降级的状态码,如 [402,403]
  enabled: boolean
}
```

### 预算

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/budgets` | 全部预算 → `{budgets:[...]}` |
| POST | `/budgets` | 新增,body `{scope, target_id, limit_usd, period, action}` → 201 `{budget}` |
| DELETE | `/budgets/:id` | 删 → 204 |

```typescript
{
  scope: 'global' | 'logical_model',
  target_id: number | null,      // logical_model 时指向模型 id;global 时 null
  limit_usd: number,
  period: 'day' | 'month' | 'total',  // day/month 按 UTC 重置,total 不重置
  action: 'warn' | 'block'       // block 到上限后新请求 402;warn 仅标记
}
```

### 日志与状态

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/logs?model=<id>&limit=&offset=` | 请求日志(newest first)。`model` 可选过滤 → `{logs:[RequestLog]}` |
| GET | `/models/:id/budget-status` | 该模型的预算状态 → `{statuses:[{budget, spent_usd, limit_usd, action, over}]}` |

**RequestLog**:`{id, logical_model_id, hit_provider_id, client_format, upstream_format, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, status, error, attempts, created_at}`。

### 价目

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/models-dev/refresh` | 拉取 models.dev 最新价目存缓存 → `{ok:true}`;失败 502 |

成本计算依赖此缓存。第一次部署后务必调一次。

---

## 三、Admin 页面

### GET `/admin`

返回管理台单页 HTML。**无需 token**(纯静态,token 在浏览器输入存 localStorage)。功能:连接(token)、模型链管理(增删 provider、编辑优先级/降级码/models_dev_id/启用)、预算管理(增删 + 实时状态)、请求日志、刷新价目。

只有 `ADMIN_TOKEN` 配置了才会挂载此页面与 `/admin/api`。

---

## 客户端接入示例

把任意兼容客户端的 `base_url` 指向 Polyglot,`model` 填逻辑模型名即可。

**OpenAI Python SDK**:
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8787/v1", api_key="unused")
client.chat.completions.create(model="my-sonnet", messages=[...], stream=True)
```

**Anthropic SDK**:
```python
import anthropic
client = anthropic.Anthropic(base_url="http://localhost:8787", api_key="unused")
client.messages.create(model="my-sonnet", max_tokens=100, messages=[...])
# Anthropic SDK 会请求 {base_url}/v1/messages
```

**curl(跨格式)**:
```bash
# 客户端用 Chat,上游 provider 配的是 anthropic —— 自动转换
curl localhost:8787/v1/chat/completions -d '{"model":"my-sonnet","messages":[{"role":"user","content":"hi"}]}'
```
