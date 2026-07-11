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
