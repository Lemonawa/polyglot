# 阶段 2：格式转换（核心特色 1）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让转发器支持传入/传出格式解耦：客户端用任意主流格式（OpenAI Chat / OpenAI Responses / Anthropic Messages）请求，转发器可用另一种格式打给上游，响应再转回客户端要的格式，含跨格式流式转换。

**Architecture:** 所有格式经一个中立的 Canonical 中间表示（基于 AI SDK 7 的 `ModelMessage[]`）。入站解析器把各家 wire 格式 → CanonicalRequest；outbound 用 AI SDK 执行得到统一结果；serialize 层把结果转回客户端要的 wire 格式（含 SSE，AI SDK 不原生输出这些格式的 SSE，需自写）。

**Tech Stack:** TypeScript 7.0（strict）、AI SDK 7（`ai` / `@ai-sdk/openai` / `@ai-sdk/anthropic`）、Hono、vitest。依赖阶段 1 已完成。

## Global Constraints

- 依赖阶段 1 交付：`src/types.ts`、`store/*`、`router/*`、`outbound/model.ts`、`relay.ts`、`server.ts` 已存在且测试通过。
- AI SDK 7：`system` 已被 `instructions` 取代（优先用 `instructions`）；**默认拒绝 `messages` 里的 `system` role**——各家 system 提示必须提取到 `CanonicalRequest.system`，不塞进 messages。
- 顶层 `reasoning` 参数：执行时把 `CanonicalRequest.reasoning` 传给 `streamText`/`generateText` 的顶层 `reasoning`。
- 流式用 `streamText` 结果的 `.stream`（`fullStream` 已弃用）。
- **开流后出错不再 fallback**：一旦已向客户端写出流内容，出错直接中断连接（阶段 1 的 fallback 仅在非流式或未开流前生效）。
- TDD、DRY、YAGNI、Conventional Commits。
- 严格遵守 `00-shared-contract.md` 的类型名与目录结构，不得改名。

---

### Task 1: Canonical 类型定义

**Files:**
- Create: `src/canonical/types.ts`
- Test: `tests/canonical/types.test.ts`

**Interfaces:**
- Consumes: `TokenUsage`（`src/types.ts`）、`ModelMessage`（`ai`）
- Produces:
  - `CanonicalRequest`（`model`、`system?`、`messages: ModelMessage[]`、`tools?`、`tool_choice?`、`max_tokens?`、`temperature?`、`top_p?`、`stop?`、`stream`、`reasoning?`、`extra?`）
  - `CanonicalResult`（`text`、`tool_calls`、`finish_reason`、`usage: TokenUsage`、`raw_provider_metadata?`）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/canonical/types.test.ts
import { expect, test } from 'vitest';
import { emptyResult, type CanonicalRequest } from '../../src/canonical/types.js';

test('CanonicalRequest holds normalized fields', () => {
  const req: CanonicalRequest = {
    model: 'my-sonnet',
    system: 'be brief',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    reasoning: { effort: 'high' },
  };
  expect(req.system).toBe('be brief');
  expect(req.stream).toBe(true);
  expect(req.reasoning?.effort).toBe('high');
});

test('emptyResult provides a zeroed CanonicalResult', () => {
  const r = emptyResult();
  expect(r.text).toBe('');
  expect(r.finish_reason).toBe('stop');
  expect(r.usage.input_tokens).toBe(0);
  expect(r.tool_calls).toEqual([]);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/canonical/types.test.ts`
Expected: FAIL —— 找不到模块 `../../src/canonical/types.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/canonical/types.ts
import type { ModelMessage } from 'ai';
import type { TokenUsage } from '../types.js';

export interface CanonicalReasoning {
  effort?: string;
  budget_tokens?: number;
}

export interface CanonicalRequest {
  model: string; // 逻辑模型名
  system?: string; // 提取自各家 system, 执行时作为顶层 instructions
  messages: ModelMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  reasoning?: CanonicalReasoning;
  extra?: Record<string, unknown>; // 无法映射的字段原样透传
}

export interface CanonicalResult {
  text: string;
  tool_calls: unknown[];
  finish_reason: string;
  usage: TokenUsage;
  raw_provider_metadata?: unknown;
}

export function emptyResult(): CanonicalResult {
  return {
    text: '',
    tool_calls: [],
    finish_reason: 'stop',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/canonical/types.test.ts && npm run typecheck`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/canonical/types.ts tests/canonical/types.test.ts
git commit -m "feat: define canonical request/result types"
```

---

### Task 2: 入站格式识别

**Files:**
- Create: `src/inbound/detect.ts`
- Test: `tests/inbound/detect.test.ts`

**Interfaces:**
- Consumes: `WireFormat`（`src/types.ts`）
- Produces: `detectFormat(path: string): WireFormat | null` —— 由请求路径判定：`/v1/chat/completions`→`chat`，`/v1/responses`→`responses`，`/v1/messages`→`anthropic`，其它→`null`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/inbound/detect.test.ts
import { expect, test } from 'vitest';
import { detectFormat } from '../../src/inbound/detect.js';

test('maps known paths to formats', () => {
  expect(detectFormat('/v1/chat/completions')).toBe('chat');
  expect(detectFormat('/v1/responses')).toBe('responses');
  expect(detectFormat('/v1/messages')).toBe('anthropic');
});

test('unknown path returns null', () => {
  expect(detectFormat('/v1/embeddings')).toBeNull();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/inbound/detect.test.ts`
Expected: FAIL —— 找不到模块 `../../src/inbound/detect.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/inbound/detect.ts
import type { WireFormat } from '../types.js';

export function detectFormat(path: string): WireFormat | null {
  if (path.endsWith('/v1/chat/completions')) return 'chat';
  if (path.endsWith('/v1/responses')) return 'responses';
  if (path.endsWith('/v1/messages')) return 'anthropic';
  return null;
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/inbound/detect.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/inbound/detect.ts tests/inbound/detect.test.ts
git commit -m "feat: detect client wire format from request path"
```

---

### Task 3: 入站解析 —— OpenAI Chat

**Files:**
- Create: `src/inbound/chat.ts`
- Test: `tests/inbound/chat.test.ts`

**Interfaces:**
- Consumes: `CanonicalRequest`（Task 1）
- Produces: `parseChat(body: Record<string, unknown>): CanonicalRequest` —— 解析 OpenAI Chat Completions 请求体。**system role 消息提取到 `system`**（多条 system 用换行拼接），其余转成 `messages`；映射 `max_tokens`/`temperature`/`top_p`/`stop`/`stream`/`tools`/`tool_choice`；未识别字段进 `extra`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/inbound/chat.test.ts
import { expect, test } from 'vitest';
import { parseChat } from '../../src/inbound/chat.js';

test('extracts system to top-level and keeps user/assistant messages', () => {
  const req = parseChat({
    model: 'my-gpt',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ],
    temperature: 0.5,
    max_tokens: 100,
    stream: true,
  });
  expect(req.model).toBe('my-gpt');
  expect(req.system).toBe('be brief');
  expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(req.temperature).toBe(0.5);
  expect(req.max_tokens).toBe(100);
  expect(req.stream).toBe(true);
});

test('joins multiple system messages and defaults stream false', () => {
  const req = parseChat({
    model: 'm',
    messages: [
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'user', content: 'q' },
    ],
  });
  expect(req.system).toBe('a\nb');
  expect(req.stream).toBe(false);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/inbound/chat.test.ts`
Expected: FAIL —— 找不到模块 `../../src/inbound/chat.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/inbound/chat.ts
import type { ModelMessage } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface ChatMessage {
  role: string;
  content: string;
}

export function parseChat(body: Record<string, unknown>): CanonicalRequest {
  const rawMessages = (body.messages as ChatMessage[] | undefined) ?? [];
  const systemParts = rawMessages.filter((m) => m.role === 'system').map((m) => m.content);
  const messages = rawMessages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })) as ModelMessage[];

  const known = new Set([
    'model', 'messages', 'temperature', 'max_tokens', 'top_p', 'stop', 'stream', 'tools', 'tool_choice',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!known.has(k)) extra[k] = v;

  return {
    model: String(body.model ?? ''),
    system: systemParts.length ? systemParts.join('\n') : undefined,
    messages,
    tools: body.tools as unknown[] | undefined,
    tool_choice: body.tool_choice,
    max_tokens: body.max_tokens as number | undefined,
    temperature: body.temperature as number | undefined,
    top_p: body.top_p as number | undefined,
    stop: body.stop as string[] | undefined,
    stream: Boolean(body.stream),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/inbound/chat.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/inbound/chat.ts tests/inbound/chat.test.ts
git commit -m "feat: parse OpenAI chat requests into canonical form"
```

---

### Task 4: 入站解析 —— Anthropic Messages

**Files:**
- Create: `src/inbound/anthropic.ts`
- Test: `tests/inbound/anthropic.test.ts`

**Interfaces:**
- Consumes: `CanonicalRequest`（Task 1）
- Produces: `parseAnthropic(body: Record<string, unknown>): CanonicalRequest` —— Anthropic Messages 格式：`system` 是顶层字段（可能是字符串或 content-block 数组），`max_tokens` 必填，`messages` 的 content 可为字符串或块数组（本阶段把纯文本块合并为字符串，非文本块原样进 `extra._unmapped`）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/inbound/anthropic.test.ts
import { expect, test } from 'vitest';
import { parseAnthropic } from '../../src/inbound/anthropic.js';

test('reads top-level system string and messages', () => {
  const req = parseAnthropic({
    model: 'my-sonnet',
    system: 'be kind',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
  expect(req.system).toBe('be kind');
  expect(req.max_tokens).toBe(256);
  expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(req.stream).toBe(true);
});

test('flattens system content-block array and text content blocks', () => {
  const req = parseAnthropic({
    model: 'm',
    system: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
    max_tokens: 10,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  });
  expect(req.system).toBe('line1\nline2');
  expect(req.messages).toEqual([{ role: 'user', content: 'hi' }]);
  expect(req.stream).toBe(false);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/inbound/anthropic.test.ts`
Expected: FAIL —— 找不到模块 `../../src/inbound/anthropic.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/inbound/anthropic.ts
import type { ModelMessage } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface TextBlock {
  type: string;
  text?: string;
}
interface AnthropicMessage {
  role: string;
  content: string | TextBlock[];
}

function flattenText(content: string | TextBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

export function parseAnthropic(body: Record<string, unknown>): CanonicalRequest {
  const rawSystem = body.system;
  const system =
    typeof rawSystem === 'string'
      ? rawSystem
      : Array.isArray(rawSystem)
        ? flattenText(rawSystem as TextBlock[])
        : undefined;

  const rawMessages = (body.messages as AnthropicMessage[] | undefined) ?? [];
  const messages = rawMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: flattenText(m.content),
  })) as ModelMessage[];

  const known = new Set(['model', 'system', 'messages', 'max_tokens', 'temperature', 'top_p', 'stop_sequences', 'stream', 'tools', 'tool_choice']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!known.has(k)) extra[k] = v;

  return {
    model: String(body.model ?? ''),
    system: system && system.length ? system : undefined,
    messages,
    tools: body.tools as unknown[] | undefined,
    tool_choice: body.tool_choice,
    max_tokens: body.max_tokens as number | undefined,
    temperature: body.temperature as number | undefined,
    top_p: body.top_p as number | undefined,
    stop: body.stop_sequences as string[] | undefined,
    stream: Boolean(body.stream),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/inbound/anthropic.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/inbound/anthropic.ts tests/inbound/anthropic.test.ts
git commit -m "feat: parse Anthropic messages requests into canonical form"
```

---

### Task 5: 入站解析 —— OpenAI Responses

**Files:**
- Create: `src/inbound/responses.ts`
- Test: `tests/inbound/responses.test.ts`

**Interfaces:**
- Consumes: `CanonicalRequest`（Task 1）
- Produces: `parseResponses(body: Record<string, unknown>): CanonicalRequest` —— OpenAI Responses API 格式：`instructions` 顶层字段 → `system`；`input` 可为字符串（单条 user 消息）或消息数组（每条含 `role` + `content`，content 可为字符串或 `{type:'input_text'|'output_text', text}` 块数组）；`max_output_tokens` → `max_tokens`；`reasoning.effort` → `reasoning`。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/inbound/responses.test.ts
import { expect, test } from 'vitest';
import { parseResponses } from '../../src/inbound/responses.js';

test('string input becomes a single user message; instructions -> system', () => {
  const req = parseResponses({
    model: 'my-gpt',
    instructions: 'be terse',
    input: 'what is 2+2?',
    max_output_tokens: 64,
    stream: true,
  });
  expect(req.system).toBe('be terse');
  expect(req.messages).toEqual([{ role: 'user', content: 'what is 2+2?' }]);
  expect(req.max_tokens).toBe(64);
  expect(req.stream).toBe(true);
});

test('array input with content blocks and reasoning effort', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
    ],
    reasoning: { effort: 'high' },
  });
  expect(req.messages).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  expect(req.reasoning?.effort).toBe('high');
  expect(req.stream).toBe(false);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/inbound/responses.test.ts`
Expected: FAIL —— 找不到模块 `../../src/inbound/responses.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/inbound/responses.ts
import type { ModelMessage } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface ContentBlock {
  type: string;
  text?: string;
}
interface InputMessage {
  role: string;
  content: string | ContentBlock[];
}

function flatten(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => (b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

export function parseResponses(body: Record<string, unknown>): CanonicalRequest {
  const rawInput = body.input;
  let messages: ModelMessage[];
  if (typeof rawInput === 'string') {
    messages = [{ role: 'user', content: rawInput }] as ModelMessage[];
  } else if (Array.isArray(rawInput)) {
    messages = (rawInput as InputMessage[]).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: flatten(m.content),
    })) as ModelMessage[];
  } else {
    messages = [];
  }

  const reasoningRaw = body.reasoning as { effort?: string } | undefined;
  const known = new Set(['model', 'instructions', 'input', 'max_output_tokens', 'temperature', 'top_p', 'stream', 'tools', 'tool_choice', 'reasoning']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (!known.has(k)) extra[k] = v;

  return {
    model: String(body.model ?? ''),
    system: typeof body.instructions === 'string' ? body.instructions : undefined,
    messages,
    tools: body.tools as unknown[] | undefined,
    tool_choice: body.tool_choice,
    max_tokens: body.max_output_tokens as number | undefined,
    temperature: body.temperature as number | undefined,
    top_p: body.top_p as number | undefined,
    stream: Boolean(body.stream),
    reasoning: reasoningRaw?.effort ? { effort: reasoningRaw.effort } : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/inbound/responses.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/inbound/responses.ts tests/inbound/responses.test.ts
git commit -m "feat: parse OpenAI responses requests into canonical form"
```

---

### Task 6: 出站执行（Canonical → AI SDK → CanonicalResult）

**Files:**
- Create: `src/outbound/execute.ts`
- Test: `tests/outbound/execute.test.ts`

**Interfaces:**
- Consumes: `CanonicalRequest`/`CanonicalResult`（Task 1）、AI SDK 7 `generateText`/`streamText`（`ai`）、`LanguageModel`（`ai`）
- Produces:
  - `buildCallOptions(model, req): { model; instructions?; messages; maxOutputTokens?; temperature?; topP?; stopSequences?; reasoning? }` —— 把 CanonicalRequest 映射到 AI SDK 调用参数（`system`→`instructions`，`max_tokens`→`maxOutputTokens`，`top_p`→`topP`，`stop`→`stopSequences`，`reasoning` 顶层透传）。
  - `execute(model, req): Promise<CanonicalResult>` —— 非流式，用 `generateText`，提取四类 token（`inputTokens`/`outputTokens`/`cachedInputTokens` + `providerMetadata.openai?.usage?.cacheWriteTokens`）。
  - `streamExecute(model, req): { stream, resultPromise }` —— 流式，返回 `streamText` 的 `.textStream` 与最终 `CanonicalResult` 的 promise。

- [ ] **Step 1: 写失败测试**

`buildCallOptions` 是纯映射，用它做主要断言，避免真实网络：

```typescript
// tests/outbound/execute.test.ts
import { expect, test } from 'vitest';
import { buildCallOptions } from '../../src/outbound/execute.js';
import type { CanonicalRequest } from '../../src/canonical/types.js';

const fakeModel = { modelId: 'x', provider: 'openai.chat' } as never;

test('maps canonical fields to AI SDK call options', () => {
  const req: CanonicalRequest = {
    model: 'm',
    system: 'be brief',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 128,
    temperature: 0.3,
    top_p: 0.9,
    stop: ['END'],
    stream: false,
    reasoning: { effort: 'high' },
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBe('be brief');
  expect(opts.maxOutputTokens).toBe(128);
  expect(opts.topP).toBe(0.9);
  expect(opts.stopSequences).toEqual(['END']);
  expect(opts.reasoning).toEqual({ effort: 'high' });
  expect(opts.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

test('omits undefined optional fields', () => {
  const req: CanonicalRequest = { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: false };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBeUndefined();
  expect(opts.maxOutputTokens).toBeUndefined();
  expect(opts.reasoning).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/outbound/execute.test.ts`
Expected: FAIL —— 找不到模块 `../../src/outbound/execute.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/outbound/execute.ts
import { generateText, streamText, type LanguageModel, type ModelMessage } from 'ai';
import type { CanonicalRequest, CanonicalResult } from '../canonical/types.js';
import type { TokenUsage } from '../types.js';

export interface CallOptions {
  model: LanguageModel;
  instructions?: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  reasoning?: { effort?: string; budget_tokens?: number };
}

export function buildCallOptions(model: LanguageModel, req: CanonicalRequest): CallOptions {
  return {
    model,
    instructions: req.system,
    messages: req.messages,
    maxOutputTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stopSequences: req.stop,
    reasoning: req.reasoning,
  };
}

interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

function toUsage(usage: AiUsage, meta: unknown): TokenUsage {
  const cacheWrite =
    (meta as { openai?: { usage?: { cacheWriteTokens?: number } } } | undefined)?.openai?.usage
      ?.cacheWriteTokens ?? 0;
  const cacheRead = usage.cachedInputTokens ?? 0;
  return {
    input_tokens: (usage.inputTokens ?? 0) - cacheRead,
    output_tokens: usage.outputTokens ?? 0,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  };
}

export async function execute(model: LanguageModel, req: CanonicalRequest): Promise<CanonicalResult> {
  const result = await generateText(buildCallOptions(model, req));
  return {
    text: result.text,
    tool_calls: result.toolCalls ?? [],
    finish_reason: result.finishReason ?? 'stop',
    usage: toUsage(result.usage as AiUsage, result.providerMetadata),
    raw_provider_metadata: result.providerMetadata,
  };
}

export interface StreamHandle {
  stream: AsyncIterable<string>;
  resultPromise: Promise<CanonicalResult>;
}

export function streamExecute(model: LanguageModel, req: CanonicalRequest): StreamHandle {
  const result = streamText(buildCallOptions(model, req));
  const resultPromise = (async (): Promise<CanonicalResult> => {
    const [text, usage, finishReason, meta] = await Promise.all([
      result.text,
      result.usage,
      result.finishReason,
      result.providerMetadata,
    ]);
    return {
      text,
      tool_calls: (await result.toolCalls) ?? [],
      finish_reason: finishReason ?? 'stop',
      usage: toUsage(usage as AiUsage, meta),
      raw_provider_metadata: meta,
    };
  })();
  return { stream: result.textStream, resultPromise };
}
```

> 注：`result.usage` 的 `inputTokens` 是否已含 cached 因 provider 而异；本实现假定 `inputTokens` 含 cached，故 `input_tokens = inputTokens - cachedInputTokens`。实现阶段用真实 provider 校验后按需调整此一行，不改对外类型。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/outbound/execute.test.ts`
Expected: PASS —— 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/outbound/execute.ts tests/outbound/execute.test.ts
git commit -m "feat: execute canonical request via AI SDK (stream + non-stream)"
```

---

### Task 7: 出站序列化（非流式 JSON）—— 三格式

**Files:**
- Create: `src/outbound/serializeChat.ts`
- Create: `src/outbound/serializeResponses.ts`
- Create: `src/outbound/serializeAnthropic.ts`
- Test: `tests/outbound/serialize.test.ts`

**Interfaces:**
- Consumes: `CanonicalResult`（Task 1）
- Produces（各文件导出一个 JSON 序列化函数，返回普通对象供 `Response` 包装）：
  - `serializeChatJson(model: string, result: CanonicalResult): object` —— OpenAI chat.completion 形。
  - `serializeResponsesJson(model: string, result: CanonicalResult): object` —— OpenAI Responses 形（`output` 数组 + `output_text`）。
  - `serializeAnthropicJson(model: string, result: CanonicalResult): object` —— Anthropic messages 形（`content: [{type:'text',text}]` + `usage.input_tokens/output_tokens`）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/outbound/serialize.test.ts
import { expect, test } from 'vitest';
import { serializeChatJson } from '../../src/outbound/serializeChat.js';
import { serializeResponsesJson } from '../../src/outbound/serializeResponses.js';
import { serializeAnthropicJson } from '../../src/outbound/serializeAnthropic.js';
import type { CanonicalResult } from '../../src/canonical/types.js';

const result: CanonicalResult = {
  text: 'hello world',
  tool_calls: [],
  finish_reason: 'stop',
  usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 2, cache_write_tokens: 0 },
};

test('chat JSON shape', () => {
  const j = serializeChatJson('my-gpt', result) as {
    object: string; model: string; choices: { message: { content: string }; finish_reason: string }[]; usage: { prompt_tokens: number; completion_tokens: number };
  };
  expect(j.object).toBe('chat.completion');
  expect(j.model).toBe('my-gpt');
  expect(j.choices[0].message.content).toBe('hello world');
  expect(j.choices[0].finish_reason).toBe('stop');
  expect(j.usage.prompt_tokens).toBe(12); // input + cache_read
  expect(j.usage.completion_tokens).toBe(5);
});

test('responses JSON shape', () => {
  const j = serializeResponsesJson('my-gpt', result) as {
    object: string; output_text: string; output: { content: { type: string; text: string }[] }[];
  };
  expect(j.object).toBe('response');
  expect(j.output_text).toBe('hello world');
  expect(j.output[0].content[0].type).toBe('output_text');
  expect(j.output[0].content[0].text).toBe('hello world');
});

test('anthropic JSON shape', () => {
  const j = serializeAnthropicJson('my-sonnet', result) as {
    type: string; role: string; content: { type: string; text: string }[]; usage: { input_tokens: number; output_tokens: number };
  };
  expect(j.type).toBe('message');
  expect(j.role).toBe('assistant');
  expect(j.content[0].text).toBe('hello world');
  expect(j.usage.input_tokens).toBe(12);
  expect(j.usage.output_tokens).toBe(5);
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/outbound/serialize.test.ts`
Expected: FAIL —— 找不到三个 serialize 模块。

- [ ] **Step 3: 写实现**

```typescript
// src/outbound/serializeChat.ts
import type { CanonicalResult } from '../canonical/types.js';

export function serializeChatJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.finish_reason },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}
```

```typescript
// src/outbound/serializeResponses.ts
import type { CanonicalResult } from '../canonical/types.js';

export function serializeResponsesJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `resp-${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    output_text: result.text,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: result.text }],
      },
    ],
    usage: {
      input_tokens: prompt,
      output_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}
```

```typescript
// src/outbound/serializeAnthropic.ts
import type { CanonicalResult } from '../canonical/types.js';

export function serializeAnthropicJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `msg-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: result.text }],
    stop_reason: result.finish_reason === 'stop' ? 'end_turn' : result.finish_reason,
    usage: { input_tokens: prompt, output_tokens: result.usage.output_tokens },
  };
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/outbound/serialize.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/outbound/serializeChat.ts src/outbound/serializeResponses.ts src/outbound/serializeAnthropic.ts tests/outbound/serialize.test.ts
git commit -m "feat: serialize canonical result to chat/responses/anthropic JSON"
```

---

### Task 8: 流式 SSE 序列化 —— 三格式

**Files:**
- Modify: `src/outbound/serializeChat.ts`
- Modify: `src/outbound/serializeResponses.ts`
- Modify: `src/outbound/serializeAnthropic.ts`
- Test: `tests/outbound/serialize-stream.test.ts`

**Interfaces:**
- Consumes: 上一任务的三个文件、`AsyncIterable<string>`（Task 6 的 `streamExecute().stream`）
- Produces（每个文件追加一个 SSE 流生成器，把文本增量 async 迭代器转成对应格式的 SSE 字节流 `ReadableStream<Uint8Array>`）：
  - `serializeChatSSE(model: string, deltas: AsyncIterable<string>): ReadableStream<Uint8Array>` —— OpenAI `chat.completion.chunk` + `data: [DONE]`。
  - `serializeResponsesSSE(model: string, deltas: AsyncIterable<string>): ReadableStream<Uint8Array>` —— `event: response.output_text.delta` 序列 + `event: response.completed`。
  - `serializeAnthropicSSE(model: string, deltas: AsyncIterable<string>): ReadableStream<Uint8Array>` —— `event: message_start` → `content_block_delta`* → `message_stop`。

- [ ] **Step 1: 写失败测试**

用一个辅助函数把 ReadableStream 读成字符串再断言关键片段：

```typescript
// tests/outbound/serialize-stream.test.ts
import { expect, test } from 'vitest';
import { serializeChatSSE } from '../../src/outbound/serializeChat.js';
import { serializeResponsesSSE } from '../../src/outbound/serializeResponses.js';
import { serializeAnthropicSSE } from '../../src/outbound/serializeAnthropic.js';

async function* deltas() {
  yield 'Hel';
  yield 'lo';
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test('chat SSE contains chunks and DONE', async () => {
  const text = await drain(serializeChatSSE('my-gpt', deltas()));
  expect(text).toContain('chat.completion.chunk');
  expect(text).toContain('"content":"Hel"');
  expect(text).toContain('"content":"lo"');
  expect(text).toContain('data: [DONE]');
});

test('responses SSE emits delta and completed events', async () => {
  const text = await drain(serializeResponsesSSE('my-gpt', deltas()));
  expect(text).toContain('event: response.output_text.delta');
  expect(text).toContain('"delta":"Hel"');
  expect(text).toContain('event: response.completed');
});

test('anthropic SSE emits message_start, deltas, message_stop', async () => {
  const text = await drain(serializeAnthropicSSE('my-sonnet', deltas()));
  expect(text).toContain('event: message_start');
  expect(text).toContain('event: content_block_delta');
  expect(text).toContain('"text":"Hel"');
  expect(text).toContain('event: message_stop');
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/outbound/serialize-stream.test.ts`
Expected: FAIL —— 三个 SSE 函数未导出。

- [ ] **Step 3: 写实现（各文件追加）**

在 `serializeChat.ts` 末尾追加：

```typescript
// src/outbound/serializeChat.ts (追加)
function sse(data: string): string {
  return `data: ${data}\n\n`;
}

export function serializeChatSSE(
  model: string,
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return new ReadableStream({
    async start(controller) {
      for await (const delta of deltas) {
        const chunk = {
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(sse(JSON.stringify(chunk))));
      }
      const final = {
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      controller.enqueue(encoder.encode(sse(JSON.stringify(final))));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
```

在 `serializeResponses.ts` 末尾追加：

```typescript
// src/outbound/serializeResponses.ts (追加)
function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function serializeResponsesSSE(
  model: string,
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `resp-${Date.now()}`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(sseEvent('response.created', { type: 'response.created', response: { id, model, status: 'in_progress' } })),
      );
      let full = '';
      for await (const delta of deltas) {
        full += delta;
        controller.enqueue(
          encoder.encode(sseEvent('response.output_text.delta', { type: 'response.output_text.delta', delta })),
        );
      }
      controller.enqueue(
        encoder.encode(sseEvent('response.completed', {
          type: 'response.completed',
          response: { id, model, status: 'completed', output_text: full },
        })),
      );
      controller.close();
    },
  });
}
```

在 `serializeAnthropic.ts` 末尾追加：

```typescript
// src/outbound/serializeAnthropic.ts (追加)
function anthropicEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

export function serializeAnthropicSSE(
  model: string,
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `msg-${Date.now()}`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(anthropicEvent('message_start', {
          message: { id, type: 'message', role: 'assistant', model, content: [] },
        })),
      );
      controller.enqueue(
        encoder.encode(anthropicEvent('content_block_start', {
          index: 0, content_block: { type: 'text', text: '' },
        })),
      );
      for await (const delta of deltas) {
        controller.enqueue(
          encoder.encode(anthropicEvent('content_block_delta', {
            index: 0, delta: { type: 'text_delta', text: delta },
          })),
        );
      }
      controller.enqueue(encoder.encode(anthropicEvent('content_block_stop', { index: 0 })));
      controller.enqueue(encoder.encode(anthropicEvent('message_stop', {})));
      controller.close();
    },
  });
}
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run tests/outbound/serialize-stream.test.ts`
Expected: PASS —— 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src/outbound/serializeChat.ts src/outbound/serializeResponses.ts src/outbound/serializeAnthropic.ts tests/outbound/serialize-stream.test.ts
git commit -m "feat: add SSE stream serializers for chat/responses/anthropic"
```

---

### Task 9: 跨格式转发编排与 server 端点集成

**Files:**
- Create: `src/convert.ts`
- Modify: `src/relay.ts`
- Modify: `src/server.ts`
- Test: `tests/convert.test.ts`

**Interfaces:**
- Consumes: `parseChat`/`parseResponses`/`parseAnthropic`（Task 3-5）、`detectFormat`（Task 2）、`execute`/`streamExecute`（Task 6）、三个 `serialize*Json` / `serialize*SSE`（Task 7-8）、`resolveChain`（阶段1）、`runChain`（阶段1）、`buildModel`（阶段1）、`insertRequestLog`（阶段1）
- Produces:
  - `parseInbound(format: WireFormat, body): CanonicalRequest` —— 按格式派发到对应解析器。
  - `serializeJson(format: WireFormat, model: string, result: CanonicalResult): object`
  - `serializeSSE(format: WireFormat, model: string, deltas: AsyncIterable<string>): ReadableStream<Uint8Array>`
  - `handleRequest(db, clientFormat: WireFormat, body): Promise<Response>` —— 完整编排：解析入站 → resolveChain → runChain（非流式用 execute；流式：**首个 provider 成功开流后不再 fallback**，直接把 `streamExecute().stream` 经 `serializeSSE` 转发）→ 写 request_logs（成本 0，阶段3 补）。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/convert.test.ts
import { expect, test } from 'vitest';
import { parseInbound, serializeJson } from '../src/convert.js';
import type { CanonicalResult } from '../src/canonical/types.js';

test('parseInbound dispatches by format (anthropic top-level system)', () => {
  const req = parseInbound('anthropic', {
    model: 'm', system: 'sys', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(req.system).toBe('sys');
  expect(req.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

test('cross-format: chat in -> anthropic out JSON', () => {
  const result: CanonicalResult = {
    text: 'hi', tool_calls: [], finish_reason: 'stop',
    usage: { input_tokens: 4, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 },
  };
  const j = serializeJson('anthropic', 'my-sonnet', result) as { type: string; content: { text: string }[] };
  expect(j.type).toBe('message');
  expect(j.content[0].text).toBe('hi');
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `npx vitest run tests/convert.test.ts`
Expected: FAIL —— 找不到模块 `../src/convert.js`。

- [ ] **Step 3: 写实现**

```typescript
// src/convert.ts
import type Database from 'better-sqlite3';
import type { CanonicalRequest, CanonicalResult } from './canonical/types.js';
import { parseAnthropic } from './inbound/anthropic.js';
import { parseChat } from './inbound/chat.js';
import { parseResponses } from './inbound/responses.js';
import { buildModel } from './outbound/model.js';
import { execute, streamExecute } from './outbound/execute.js';
import { serializeAnthropicJson, serializeAnthropicSSE } from './outbound/serializeAnthropic.js';
import { serializeChatJson, serializeChatSSE } from './outbound/serializeChat.js';
import { serializeResponsesJson, serializeResponsesSSE } from './outbound/serializeResponses.js';
import { runChain } from './router/fallback.js';
import { resolveChain } from './router/resolve.js';
import { insertRequestLog } from './store/requestLogs.js';
import type { WireFormat } from './types.js';

export function parseInbound(format: WireFormat, body: Record<string, unknown>): CanonicalRequest {
  if (format === 'chat') return parseChat(body);
  if (format === 'responses') return parseResponses(body);
  return parseAnthropic(body);
}

export function serializeJson(format: WireFormat, model: string, result: CanonicalResult): object {
  if (format === 'chat') return serializeChatJson(model, result);
  if (format === 'responses') return serializeResponsesJson(model, result);
  return serializeAnthropicJson(model, result);
}

export function serializeSSE(
  format: WireFormat,
  model: string,
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  if (format === 'chat') return serializeChatSSE(model, deltas);
  if (format === 'responses') return serializeResponsesSSE(model, deltas);
  return serializeAnthropicSSE(model, deltas);
}

export async function handleRequest(
  db: Database.Database,
  clientFormat: WireFormat,
  body: Record<string, unknown>,
): Promise<Response> {
  const req = parseInbound(clientFormat, body);
  const chain = resolveChain(db, req.model);
  if (chain.length === 0) {
    return new Response(JSON.stringify({ error: { message: `unknown model: ${req.model}` } }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  const logicalModelId = chain[0].logical_model_id;
  const start = Date.now();

  // 流式：仅尝试首个 provider 开流；开流后出错不再 fallback（直接中断）。
  if (req.stream) {
    const provider = chain[0];
    const handle = streamExecute(buildModel(provider), req);
    const sse = serializeSSE(clientFormat, req.model, handle.stream);
    handle.resultPromise
      .then((result) => {
        insertRequestLog(db, {
          logical_model_id: logicalModelId, hit_provider_id: provider.id,
          client_format: clientFormat, upstream_format: provider.upstream_format,
          input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
          cache_read_tokens: result.usage.cache_read_tokens, cache_write_tokens: result.usage.cache_write_tokens,
          cost_usd: 0, latency_ms: Date.now() - start, status: 'success', error: null, attempts: 1,
        });
      })
      .catch((err: Error) => {
        insertRequestLog(db, {
          logical_model_id: logicalModelId, hit_provider_id: provider.id,
          client_format: clientFormat, upstream_format: provider.upstream_format,
          input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          cost_usd: 0, latency_ms: Date.now() - start, status: 'error', error: err.message, attempts: 1,
        });
      });
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
    });
  }

  // 非流式：走 fallback 链。
  const run = await runChain(chain, (provider) => execute(buildModel(provider), req));
  const latency = Date.now() - start;

  if (run.value) {
    insertRequestLog(db, {
      logical_model_id: logicalModelId, hit_provider_id: run.outcome.provider.id,
      client_format: clientFormat, upstream_format: run.outcome.provider.upstream_format,
      input_tokens: run.value.usage.input_tokens, output_tokens: run.value.usage.output_tokens,
      cache_read_tokens: run.value.usage.cache_read_tokens, cache_write_tokens: run.value.usage.cache_write_tokens,
      cost_usd: 0, latency_ms: latency, status: 'success', error: null, attempts: run.attempts,
    });
    return new Response(JSON.stringify(serializeJson(clientFormat, req.model, run.value)), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }

  insertRequestLog(db, {
    logical_model_id: logicalModelId, hit_provider_id: null,
    client_format: clientFormat, upstream_format: run.outcome.provider?.upstream_format ?? null,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0, latency_ms: latency, status: 'error',
    error: run.outcome.error?.message ?? 'all providers failed', attempts: run.attempts,
  });
  return new Response(
    JSON.stringify({ error: { message: run.outcome.error?.message ?? 'all providers failed' } }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}
```

替换 `src/relay.ts` 的 `createRelay`，改为用 `handleRequest` 挂三个端点（保留 `handleChat` 供阶段1测试不破坏，但新端点走 `handleRequest`）：

```typescript
// src/relay.ts (修改 createRelay，其余保留)
import { handleRequest } from './convert.js';
// ...existing imports & handleChat 保留...

export function createRelay(db: Database.Database): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', async (c) => handleRequest(db, 'chat', await c.req.json()));
  app.post('/v1/responses', async (c) => handleRequest(db, 'responses', await c.req.json()));
  app.post('/v1/messages', async (c) => handleRequest(db, 'anthropic', await c.req.json()));
  return app;
}
```

`src/server.ts` 无需改动（仍调用 `createRelay`）。

- [ ] **Step 4: 跑测试验证通过**

Run: `npx vitest run && npm run typecheck`
Expected: PASS —— 全部测试通过（含阶段1）；typecheck 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/convert.ts src/relay.ts tests/convert.test.ts
git commit -m "feat: wire cross-format conversion into relay endpoints"
```

---

## 阶段 2 完成标准

- `npm test` 全绿；`npm run typecheck` 无错误。
- 三个端点 `/v1/chat/completions`、`/v1/responses`、`/v1/messages` 均可用；客户端格式与上游 `upstream_format` 不同也能正确转换。
- 流式跨格式转换可用；流式仅尝试首个 provider，开流后出错直接中断不 fallback。
- 为阶段 3 保留稳定的 usage/日志写入点（`handleRequest` 内的 `insertRequestLog`，成本待接入）。
