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
