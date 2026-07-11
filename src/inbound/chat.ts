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
