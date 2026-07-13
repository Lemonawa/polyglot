import {
  generateText,
  type LanguageModel,
  type LanguageModelCallOptions,
  type ModelMessage,
  streamText,
  type ToolChoice,
  type ToolSet,
} from 'ai';
import type {
  CanonicalRequest,
  CanonicalResult,
  CanonicalToolCall,
} from '../canonical/types.js';
import { toToolChoice, toToolSet } from '../inbound/tools.js';
import type { TokenUsage } from '../types.js';

// ---------------------------------------------------------------------------
// CallOptions  –  AI SDK call options built from CanonicalRequest
// ---------------------------------------------------------------------------

export interface CallOptions {
  model: LanguageModel;
  instructions?: string;
  messages: ModelMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  reasoning?: LanguageModelCallOptions['reasoning'];
  tools?: ToolSet;
  toolChoice?: ToolChoice<ToolSet>;
}

export function buildCallOptions(
  model: LanguageModel,
  req: CanonicalRequest,
): CallOptions {
  const opts: CallOptions = {
    model,
    instructions: req.system,
    messages: req.messages,
    maxOutputTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stopSequences: req.stop,
  };

  // Map canonical reasoning.effort → AI SDK reasoning string
  if (req.reasoning?.effort) {
    opts.reasoning = req.reasoning
      .effort as LanguageModelCallOptions['reasoning'];
  }

  // Forward tool definitions and tool_choice (wire form → AI SDK ToolSet/ToolChoice)
  const tools = toToolSet(req.tools);
  if (tools) opts.tools = tools;
  const toolChoice = toToolChoice(req.tool_choice);
  if (toolChoice) opts.toolChoice = toolChoice as ToolChoice<ToolSet>;

  return opts;
}

// ---------------------------------------------------------------------------
// extractToolCalls – map AI SDK toolCalls to CanonicalToolCall[]
// ---------------------------------------------------------------------------

/**
 * Map AI SDK 7 tool call elements ({ toolCallId, toolName, input }) to our
 * CanonicalToolCall shape (args is a JSON string). `input` is a parsed object
 * (or already a string) from the SDK; we JSON.stringify it for a stable,
 * serializable args representation the serializers can re-parse per format.
 *
 * Robust on null/undefined/non-array input (returns []).
 */
export function extractToolCalls(toolCalls: unknown): CanonicalToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((tc): CanonicalToolCall | null => {
      if (tc == null || typeof tc !== 'object') return null;
      const t = tc as {
        toolCallId?: unknown;
        toolName?: unknown;
        input?: unknown;
      };
      if (typeof t.toolCallId !== 'string' || typeof t.toolName !== 'string')
        return null;
      // args is always a JSON string (uniform contract for serializers).
      // AI SDK returns `input` as a parsed object in practice; JSON.stringify
      // gives back the stable JSON args representation. Serializers re-parse
      // per wire format (e.g. Anthropic tool_use.input wants the object).
      const args = JSON.stringify(t.input ?? {});
      return { toolCallId: t.toolCallId, toolName: t.toolName, args };
    })
    .filter((x): x is CanonicalToolCall => x !== null);
}

// ---------------------------------------------------------------------------
// Token-usage helper
// ---------------------------------------------------------------------------

/** Minimal shape of AI SDK v7 LanguageModelUsage we rely on. */
interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/**
 * Extract our 4-field TokenUsage from AI SDK usage + provider metadata.
 *
 * Assumption: `inputTokens` already includes cached tokens (provider-dependent;
 * verified per-provider at integration time).  Cache-write tokens are read from
 * the SDK's `inputTokenDetails.cacheWriteTokens` first, falling back to
 * `providerMetadata.openai?.usage?.cacheWriteTokens` for providers that only
 * expose it there (e.g. some OpenAI-compatible endpoints).
 */
export function toUsage(usage: AiUsage, meta: unknown): TokenUsage {
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite =
    usage.inputTokenDetails?.cacheWriteTokens ??
    (
      meta as
        | {
            anthropic?: {
              cacheCreationInputTokens?: number;
              usage?: { cache_creation_input_tokens?: number };
            };
            openai?: { usage?: { cacheWriteTokens?: number } };
          }
        | undefined
    )?.anthropic?.cacheCreationInputTokens ??
    (
      meta as
        | { anthropic?: { usage?: { cache_creation_input_tokens?: number } } }
        | undefined
    )?.anthropic?.usage?.cache_creation_input_tokens ??
    (meta as { openai?: { usage?: { cacheWriteTokens?: number } } } | undefined)
      ?.openai?.usage?.cacheWriteTokens ??
    0;

  return {
    input_tokens: (usage.inputTokens ?? 0) - cacheRead,
    output_tokens: usage.outputTokens ?? 0,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
  };
}

// ---------------------------------------------------------------------------
// execute  –  non-streaming
// ---------------------------------------------------------------------------

export async function execute(
  model: LanguageModel,
  req: CanonicalRequest,
): Promise<CanonicalResult> {
  const result = await generateText(buildCallOptions(model, req));

  return {
    text: result.text,
    tool_calls: extractToolCalls(result.toolCalls),
    finish_reason: result.finishReason ?? 'stop',
    usage: toUsage(result.usage as AiUsage, result.providerMetadata),
    raw_provider_metadata: result.providerMetadata,
  };
}

// ---------------------------------------------------------------------------
// streamExecute
// ---------------------------------------------------------------------------

export interface StreamHandle {
  stream: AsyncIterable<StreamEvent>;
  resultPromise: Promise<CanonicalResult>;
}

/**
 * Normalized streaming event emitted by streamExecute, mapped from the AI SDK 7
 * full-part stream (`result.stream`). Text deltas become `{ kind: 'text' }`;
 * tool-call parts become `{ kind: 'tool-call' }` with args = JSON.stringify(input).
 * All other part types (reasoning, start/finish, raw, ...) are ignored here —
 * the SSE serializers only care about text + tool calls.
 */
export type StreamEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolCall: CanonicalToolCall };

export function streamExecute(
  model: LanguageModel,
  req: CanonicalRequest,
): StreamHandle {
  const result = streamText(buildCallOptions(model, req));

  const stream = (async function* (): AsyncIterable<StreamEvent> {
    for await (const part of result.stream) {
      const p = part as {
        type?: string;
        text?: unknown;
        toolCallId?: unknown;
        toolName?: unknown;
        input?: unknown;
      };
      if (p.type === 'text-delta' && typeof p.text === 'string') {
        yield { kind: 'text', text: p.text };
      } else if (
        p.type === 'tool-call' &&
        typeof p.toolCallId === 'string' &&
        typeof p.toolName === 'string'
      ) {
        yield {
          kind: 'tool-call',
          toolCall: {
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            args: JSON.stringify(p.input ?? {}),
          },
        };
      }
    }
  })();

  const resultPromise = (async (): Promise<CanonicalResult> => {
    const [text, usage, finishReason, meta, toolCalls] = await Promise.all([
      result.text,
      result.usage,
      result.finishReason,
      result.providerMetadata,
      result.toolCalls,
    ]);

    return {
      text,
      tool_calls: extractToolCalls(toolCalls),
      finish_reason: finishReason ?? 'stop',
      usage: toUsage(usage as AiUsage, meta),
      raw_provider_metadata: meta,
    };
  })();

  return { stream, resultPromise };
}
