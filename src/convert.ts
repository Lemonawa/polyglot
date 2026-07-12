import type Database from 'better-sqlite3';
import type { CanonicalRequest, CanonicalResult } from './canonical/types.js';
import { parseAnthropic } from './inbound/anthropic.js';
import { parseChat } from './inbound/chat.js';
import { parseResponses } from './inbound/responses.js';
import { buildModel } from './outbound/model.js';
import { execute, streamExecute, type StreamHandle, type StreamEvent } from './outbound/execute.js';
import { serializeAnthropicJson, serializeAnthropicSSE } from './outbound/serializeAnthropic.js';
import { serializeChatJson, serializeChatSSE } from './outbound/serializeChat.js';
import { serializeResponsesJson, serializeResponsesSSE } from './outbound/serializeResponses.js';
import { runChain } from './router/fallback.js';
import { resolveChain } from './router/resolve.js';
import { insertRequestLog } from './store/requestLogs.js';
import { checkBudgets } from './cost/budget.js';
import { blockingBudget, costForProvider } from './cost/apply.js';
import type { Provider, WireFormat } from './types.js';

// ---------------------------------------------------------------------------
// ProviderRunner injection seam (mirrors handleChat's pattern)
// ---------------------------------------------------------------------------

export interface ProviderRunner {
  execute(provider: Provider, req: CanonicalRequest): Promise<CanonicalResult>;
  stream(provider: Provider, req: CanonicalRequest): StreamHandle;
}

const defaultRunner: ProviderRunner = {
  execute: (provider, req) => execute(buildModel(provider), req),
  stream: (provider, req) => streamExecute(buildModel(provider), req),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  events: AsyncIterable<StreamEvent>,
): ReadableStream<Uint8Array> {
  if (format === 'chat') return serializeChatSSE(model, events);
  if (format === 'responses') return serializeResponsesSSE(model, events);
  return serializeAnthropicSSE(model, events);
}

export async function handleRequest(
  db: Database.Database,
  clientFormat: WireFormat,
  body: Record<string, unknown>,
  runner: ProviderRunner = defaultRunner,
): Promise<Response> {
  const req = parseInbound(clientFormat, body);
  const chain = resolveChain(db, req.model);
  if (chain.length === 0) {
    return new Response(JSON.stringify({ error: { message: `unknown model: ${req.model}` } }), {
      status: 404, headers: { 'content-type': 'application/json' },
    });
  }
  const logicalModelId = chain[0].logical_model_id;

  const budgetStatuses = checkBudgets(db, logicalModelId);
  const blocking = blockingBudget(budgetStatuses);
  if (blocking) {
    return new Response(
      JSON.stringify({
        error: {
          message: `budget exceeded: spent $${blocking.spent_usd.toFixed(4)} >= limit $${blocking.limit_usd.toFixed(4)}`,
          type: 'budget_exceeded',
        },
      }),
      { status: 402, headers: { 'content-type': 'application/json' } },
    );
  }

  const start = Date.now();

  // Streaming: only first provider; no fallback after stream starts.
  if (req.stream) {
    const provider = chain[0];
    const handle = runner.stream(provider, req);
    const sse = serializeSSE(clientFormat, req.model, handle.stream);
    handle.resultPromise
      .then((result) => {
        try {
          insertRequestLog(db, {
            logical_model_id: logicalModelId, hit_provider_id: provider.id,
            client_format: clientFormat, upstream_format: provider.upstream_format,
            input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens,
            cache_read_tokens: result.usage.cache_read_tokens, cache_write_tokens: result.usage.cache_write_tokens,
            cost_usd: costForProvider(db, provider, result.usage), latency_ms: Date.now() - start, status: 'success', error: null, attempts: 1,
          });
        } catch (logErr) {
          console.error('stream success-log write failed', logErr);
        }
      })
      .catch((err: Error) => {
        try {
          insertRequestLog(db, {
            logical_model_id: logicalModelId, hit_provider_id: provider.id,
            client_format: clientFormat, upstream_format: provider.upstream_format,
            input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            cost_usd: 0, latency_ms: Date.now() - start, status: 'error', error: err.message, attempts: 1,
          });
        } catch (logErr) {
          console.error('stream error-log write failed', logErr, err);
        }
      });
    return new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
    });
  }

  // Non-streaming: runChain with fallback.
  const run = await runChain(chain, (provider) => runner.execute(provider, req));
  const latency = Date.now() - start;

  if (run.outcome.ok && run.value) {
    insertRequestLog(db, {
      logical_model_id: logicalModelId, hit_provider_id: run.outcome.provider.id,
      client_format: clientFormat, upstream_format: run.outcome.provider.upstream_format,
      input_tokens: run.value.usage.input_tokens, output_tokens: run.value.usage.output_tokens,
      cache_read_tokens: run.value.usage.cache_read_tokens, cache_write_tokens: run.value.usage.cache_write_tokens,
      cost_usd: costForProvider(db, run.outcome.provider, run.value.usage), latency_ms: latency, status: 'success', error: null, attempts: run.attempts,
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
