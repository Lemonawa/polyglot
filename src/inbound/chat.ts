import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * Build an index of tool_call_id → tool_name from assistant tool_calls.
 */
function buildToolNameIndex(messages: ChatMessage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        if (typeof tc.id === 'string' && tc.id && tc.function?.name) {
          index.set(tc.id, tc.function.name);
        }
      }
    }
  }
  return index;
}

function safeJsonParse(s: string | undefined): unknown {
  if (s == null) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function parseChat(body: Record<string, unknown>): CanonicalRequest {
  const rawMessages = (body.messages as ChatMessage[] | undefined) ?? [];
  const toolNameIndex = buildToolNameIndex(rawMessages);

  const systemParts = rawMessages.filter((m) => m.role === 'system').map((m) => m.content);
  const messages: ModelMessage[] = [];

  for (const m of rawMessages) {
    if (m.role === 'system') continue;

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // Convert assistant tool_calls to ToolCallParts; include text if present
      const parts: Array<ToolCallPart | { type: 'text'; text: string }> = [];
      if (m.content) {
        parts.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        parts.push({
          type: 'tool-call',
          toolCallId: tc.id ?? '',
          toolName: tc.function?.name ?? tc.id ?? '',
          input: safeJsonParse(tc.function?.arguments),
        } satisfies ToolCallPart);
      }
      messages.push({ role: 'assistant', content: parts } as ModelMessage);
    } else if (m.role === 'tool') {
      // Convert tool result messages to ToolModelMessage
      const toolCallId = m.tool_call_id ?? '';
      const toolName = toolNameIndex.get(toolCallId) ?? (toolCallId || '');
      const parts: ToolResultPart[] = [
        {
          type: 'tool-result',
          toolCallId,
          toolName,
          output: {
            type: 'text',
            value: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
          },
        } satisfies ToolResultPart,
      ];
      messages.push({ role: 'tool', content: parts } as ModelMessage);
    } else {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content ?? '' } as ModelMessage);
    }
  }

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
