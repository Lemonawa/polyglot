import {
  generateText,
  streamText,
  type LanguageModel,
  type LanguageModelCallOptions,
  type ModelMessage,
} from 'ai';
import type { CanonicalRequest, CanonicalResult } from '../canonical/types.js';
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
    opts.reasoning = req.reasoning.effort as LanguageModelCallOptions['reasoning'];
  }

  return opts;
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
function toUsage(usage: AiUsage, meta: unknown): TokenUsage {
  const cacheRead =
    usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite =
    usage.inputTokenDetails?.cacheWriteTokens ??
    (
      meta as
        | { openai?: { usage?: { cacheWriteTokens?: number } } }
        | undefined
    )?.openai?.usage?.cacheWriteTokens ??
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
    tool_calls: result.toolCalls ?? [],
    finish_reason: result.finishReason ?? 'stop',
    usage: toUsage(result.usage as AiUsage, result.providerMetadata),
    raw_provider_metadata: result.providerMetadata,
  };
}

// ---------------------------------------------------------------------------
// streamExecute
// ---------------------------------------------------------------------------

export interface StreamHandle {
  stream: AsyncIterable<string>;
  resultPromise: Promise<CanonicalResult>;
}

export function streamExecute(
  model: LanguageModel,
  req: CanonicalRequest,
): StreamHandle {
  const result = streamText(buildCallOptions(model, req));

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
      tool_calls: toolCalls ?? [],
      finish_reason: finishReason ?? 'stop',
      usage: toUsage(usage as AiUsage, meta),
      raw_provider_metadata: meta,
    };
  })();

  return { stream: result.textStream, resultPromise };
}
