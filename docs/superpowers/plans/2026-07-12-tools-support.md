# Tool 调用支持 实现计划（补完 spec §5 遗留）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** 让转发器完整支持 tool/function calling——客户端传入工具定义和 tool_call/tool_result 消息,转发器透传给上游模型,并把模型返回的 tool_calls 按客户端格式返回。转发器不执行工具（执行在客户端,这是 relay 的正确语义）。

**Architecture:** 三层补全,均经 Canonical：
- 入站：三个解析器把各家的工具定义 + tool-call/tool-result 消息转成 AI SDK 7 的 `ToolSet` / `ToolCallPart` / `ToolResultPart`。
- 执行：`buildCallOptions` 把 `ToolSet`（`jsonSchema(parameters)`、无 `execute`）和 `toolChoice` 转发给 `generateText`/`streamText`。
- 出站：序列化器把 `CanonicalResult.tool_calls` 发成各家 wire 格式；流式按 part 流转发 text-delta + tool-call。

**Tech Stack:** TypeScript 7.0、AI SDK 7（`jsonSchema`、`ToolCallPart`/`ToolResultPart`、`result.stream` 全 part 流）、vitest。

## Global Constraints

- AI SDK 7 的 `tools` 是 `ToolSet`（对象,key=工具名,value=`tool({inputSchema, description})`），不是数组。wire 格式的数组必须转换。转发器定义工具时**不带 `execute`**（模型可产出 tool_calls,但转发器不执行——结果由客户端下一轮回传）。
- `toolChoice`：wire（`'auto'|'none'|'required'|{type:'function',function:{name}}`）→ AI SDK（`'auto'|'none'|'required'|{type:'tool',toolName}`）。
- 消息：assistant 的 tool_call、user/tool 的 tool_result 必须转成 AI SDK 的 `ToolCallPart`/`ToolResultPart` 放进 messages,否则多轮工具对话会丢。
- `CanonicalResult.tool_calls` 已是 `unknown[]`（Phase 2）——本计划把它的元素定为统一的 `{ toolCallId, toolName, args(string) }` 形态（args 是 JSON 字符串,序列化时按格式处理）。
- 流式：`streamExecute` 改为暴露 AI SDK 的**全 part 流**（`result.stream`）而非 `textStream`；SSE 序列化器消费 text-delta + tool-call part。
- 遵守 `00-shared-contract.md` 类型与目录结构。TDD、DRY、YAGNI、Conventional Commits。

---

## 文件改动总览

- Modify: `src/canonical/types.ts` — `CanonicalResult.tool_calls` 元素类型明确化（`CanonicalToolCall`）。
- Modify: `src/inbound/chat.ts`、`anthropic.ts`、`responses.ts` — 解析工具定义 + tool-call/tool-result 消息。
- Create: `src/inbound/tools.ts` — 共享的 wire→AI SDK `ToolSet` 转换（三家复用）。
- Modify: `src/outbound/execute.ts` — `buildCallOptions` 转发 tools/toolChoice；`execute`/`streamExecute` 提取 tool_calls；`streamExecute` 改用全 part 流。
- Modify: `src/outbound/serializeChat.ts`、`serializeResponses.ts`、`serializeAnthropic.ts` — 非流式 + SSE 发 tool_calls。
- Tests: 各自新增 tool 用例。

## 任务拆分（5 任务）

### Task 1: Canonical tool 类型 + 入站 tools 转换
- `CanonicalToolCall = { toolCallId: string; toolName: string; args: string }`（args JSON 字符串）
- `src/inbound/tools.ts`: `toToolSet(tools: unknown): ToolSet | undefined` —— OpenAI 形 `{type:'function',function:{name,description,parameters}}` → AI SDK `tool({inputSchema: jsonSchema(parameters), description})`（无 execute）；`toToolChoice(choice): toolChoice`。
- 测试：tools 数组转 ToolSet、tool_choice 各形态。

### Task 2: 入站 tool-call/tool-result 消息解析（三格式）
- chat：assistant 的 `tool_calls` → `ToolCallPart`；`role:'tool'` + `tool_call_id` → `ToolResultPart`。
- anthropic：content blocks `{type:'tool_use'}` / `{type:'tool_result'}`。
- responses：output 项 `{type:'function_call'}` / `{type:'function_call_output'}`。
- 测试：多轮工具对话消息正确转成 ModelMessage[]。

### Task 3: buildCallOptions 转发 + execute 提取 tool_calls
- `buildCallOptions`：`req.tools` 经 `toToolSet` → `tools`；`req.tool_choice` → `toolChoice`。
- `execute`：`result.toolCalls` → `CanonicalToolCall[]`（`{toolCallId, toolName, args: JSON.stringify(input)}`）。
- `streamExecute`：改用 `result.stream`（全 part 流），返回 `{ stream: AsyncIterable<part>, resultPromise }`；resultPromise 同样提取 tool_calls。
- 测试：buildCallOptions 含 tools/toolChoice；execute tool_calls 提取（注入假 model）。

### Task 4: 非流式序列化 tool_calls（三格式）
- chat：`choices[0].message.tool_calls = [{id, type:'function', function:{name, arguments:args}}]`；finish_reason 'tool_calls'。
- anthropic：`content` 含 `{type:'tool_use', id, name, input: JSON.parse(args)}`；stop_reason 'tool_use'。
- responses：`output` 含 `{type:'function_call', id, name, arguments:args}`。
- 测试：tool_calls 各格式 shape。

### Task 5: SSE 流式 tool_calls（三格式）
- `streamExecute` 返回全 part 流后,`serializeSSE` 改为消费 part：text-delta → 现有文本增量；tool-call → 各格式 tool 事件。
- chat SSE：`delta.tool_calls` 片段（按 part 一次性发完整 tool_call chunk）。
- anthropic SSE：`content_block_start`(tool_use) + `input_json_delta` + `content_block_stop`。
- responses SSE：`response.output_item.added`(function_call) + `response.function_call_arguments.delta`。
- 测试：流式 tool 产出片段断言。
- 注：本版按 part 发完整 tool_call（非字符级 arg 增量）,保证客户端能还原完整调用——增量 arg 分片留待后续。
