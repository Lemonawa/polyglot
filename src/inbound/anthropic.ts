import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface TextBlock {
  type: string;
  text?: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | TextBlock[];
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

interface AnthropicMessage {
  role: string;
  content: string | ContentBlock[];
}

/**
 * Build an index of tool_use_id → tool_name from assistant tool_use blocks.
 */
function buildToolNameIndex(messages: AnthropicMessage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'tool_use') {
          const tb = block as ToolUseBlock;
          if (tb.id && tb.name) {
            index.set(tb.id, tb.name);
          }
        }
      }
    }
  }
  return index;
}

function flattenText(content: string | TextBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function flattenToolContent(content: string | TextBlock[]): string {
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
  const toolNameIndex = buildToolNameIndex(rawMessages);

  const messages: ModelMessage[] = [];

  for (const m of rawMessages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      // Check for tool_use blocks
      const hasToolUse = m.content.some((b) => b.type === 'tool_use');
      if (hasToolUse) {
        const parts: Array<ToolCallPart | { type: 'text'; text: string }> = [];
        for (const block of m.content) {
          if (block.type === 'text') {
            const tb = block as TextBlock;
            if (tb.text) {
              parts.push({ type: 'text', text: tb.text });
            }
          } else if (block.type === 'tool_use') {
            const tb = block as ToolUseBlock;
            parts.push({
              type: 'tool-call',
              toolCallId: tb.id ?? '',
              toolName: tb.name ?? '',
              input: tb.input ?? {},
            } satisfies ToolCallPart);
          }
        }
        messages.push({ role: 'assistant', content: parts } as ModelMessage);
      } else {
        // No tool_use: flatten as before
        messages.push({ role: 'assistant', content: flattenText(m.content) } as ModelMessage);
      }
    } else if (m.role === 'user' && Array.isArray(m.content)) {
      // Check for tool_result blocks
      const hasToolResult = m.content.some((b) => b.type === 'tool_result');
      if (hasToolResult) {
        for (const block of m.content) {
          if (block.type === 'tool_result') {
            const tb = block as ToolResultBlock;
            const toolCallId = tb.tool_use_id ?? '';
            const toolName = toolNameIndex.get(toolCallId) ?? (toolCallId || '');
            const outputContent = flattenToolContent(tb.content ?? '');
            const parts: ToolResultPart[] = [
              {
                type: 'tool-result',
                toolCallId,
                toolName,
                output: {
                  type: 'text',
                  value: outputContent,
                },
              } satisfies ToolResultPart,
            ];
            messages.push({ role: 'tool', content: parts } as ModelMessage);
          }
          // Non-tool_result blocks in user messages with tool results are skipped
          // to match Anthropic's approach of tool results being separate messages
        }
      } else {
        messages.push({ role: 'user', content: flattenText(m.content) } as ModelMessage);
      }
    } else {
      messages.push({ role: m.role as 'user' | 'assistant', content: flattenText(m.content) } as ModelMessage);
    }
  }

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
