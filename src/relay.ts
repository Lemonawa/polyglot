import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { buildModel } from './outbound/model.js';
import { callProviderChat, type ChatBody, type ProviderReply } from './outbound/passthrough.js';
import { runChain } from './router/fallback.js';
import { resolveChain } from './router/resolve.js';
import { insertRequestLog } from './store/requestLogs.js';
import type { Provider } from './types.js';

export type ChatRunner = (provider: Provider, body: ChatBody) => Promise<ProviderReply>;

const defaultRunner: ChatRunner = (provider, body) => callProviderChat(buildModel(provider), body);

function toChatResponse(model: string, reply: ProviderReply): Response {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: reply.text }, finish_reason: 'stop' },
    ],
    usage: {
      prompt_tokens: reply.usage.input,
      completion_tokens: reply.usage.output,
      total_tokens: reply.usage.input + reply.usage.output,
    },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handleChat(
  db: Database.Database,
  body: ChatBody,
  runner: ChatRunner = defaultRunner,
): Promise<Response> {
  const chain = resolveChain(db, body.model);
  const modelRow = chain[0]?.logical_model_id;
  if (chain.length === 0) {
    return new Response(JSON.stringify({ error: { message: `unknown model: ${body.model}` } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const start = Date.now();
  const run = await runChain(chain, (provider) => runner(provider, body));
  const latency = Date.now() - start;
  const logicalModelId = modelRow as number;

  if (run.value) {
    insertRequestLog(db, {
      logical_model_id: logicalModelId,
      hit_provider_id: run.outcome.provider.id,
      client_format: 'chat',
      upstream_format: run.outcome.provider.upstream_format,
      input_tokens: run.value.usage.input,
      output_tokens: run.value.usage.output,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0, // 阶段3 补
      latency_ms: latency,
      status: 'success',
      error: null,
      attempts: run.attempts,
    });
    return toChatResponse(body.model, run.value);
  }

  insertRequestLog(db, {
    logical_model_id: logicalModelId,
    hit_provider_id: null,
    client_format: 'chat',
    upstream_format: run.outcome.provider?.upstream_format ?? null,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_usd: 0,
    latency_ms: latency,
    status: 'error',
    error: run.outcome.error?.message ?? 'all providers failed',
    attempts: run.attempts,
  });
  return new Response(
    JSON.stringify({ error: { message: run.outcome.error?.message ?? 'all providers failed' } }),
    { status: 502, headers: { 'content-type': 'application/json' } },
  );
}

export function createRelay(db: Database.Database): Hono {
  const app = new Hono();
  app.post('/v1/chat/completions', async (c) => {
    const body = (await c.req.json()) as ChatBody;
    return handleChat(db, body);
  });
  return app;
}
