import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import type { CanonicalRequest } from '../canonical/types.js';

interface ContentBlock {
  type: string;
  text?: string;
}

interface FunctionCallBlock {
  type: 'function_call';
  id: string;
  name: string;
  arguments: string;
}

interface FunctionCallOutputBlock {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

interface InputMessage {
  role: string;
  content: string | ContentBlock[];
  type?: undefined;
}

type InputItem = InputMessage | FunctionCallBlock | FunctionCallOutputBlock;

function flatten(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => (b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

/**
 * Build an index of function_call id → function name from standalone
 * function_call items in the input array.
 */
function buildToolNameIndex(items: InputItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'function_call') {
      const fc = item as FunctionCallBlock;
      if (fc.id && fc.name) {
        index.set(fc.id, fc.name);
      }
    }
    // Also check within message content arrays
    if ('role' in item && 'content' in item && Array.isArray((item as InputMessage).content)) {
      for (const block of (item as InputMessage).content) {
        if (typeof block !== 'string' && block.type === 'function_call') {
          const fc = block as unknown as FunctionCallBlock;
          if (fc.id && fc.name) {
            index.set(fc.id, fc.name);
          }
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

export function parseResponses(body: Record<string, unknown>): CanonicalRequest {
  const rawInput = body.input;
  let messages: ModelMessage[];

  if (typeof rawInput === 'string') {
    messages = [{ role: 'user', content: rawInput }] as ModelMessage[];
  } else if (Array.isArray(rawInput)) {
    const items = rawInput as InputItem[];
    const toolNameIndex = buildToolNameIndex(items);
    messages = [];

    for (const item of items) {
      // Standalone function_call item → assistant ToolCallPart
      if (item.type === 'function_call') {
        const fc = item as FunctionCallBlock;
        const parts: ToolCallPart[] = [
          {
            type: 'tool-call',
            toolCallId: fc.id ?? '',
            toolName: fc.name ?? '',
            input: safeJsonParse(fc.arguments),
          } satisfies ToolCallPart,
        ];
        messages.push({ role: 'assistant', content: parts } as ModelMessage);
        continue;
      }

      // Standalone function_call_output item → tool ToolResultPart
      if (item.type === 'function_call_output') {
        const fco = item as FunctionCallOutputBlock;
        const callId = fco.call_id ?? '';
        const toolName = toolNameIndex.get(callId) ?? (callId || '');
        const parts: ToolResultPart[] = [
          {
            type: 'tool-result',
            toolCallId: callId,
            toolName,
            output: {
              type: 'text',
              value: typeof fco.output === 'string' ? fco.output : String(fco.output ?? ''),
            },
          } satisfies ToolResultPart,
        ];
        messages.push({ role: 'tool', content: parts } as ModelMessage);
        continue;
      }

      // Regular message with role
      const msg = item as InputMessage;

      // Check for function_call inside message content array
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        const hasFunctionCall = msg.content.some(
          (b): b is ContentBlock & { type: 'function_call' } =>
            typeof b !== 'string' && b.type === 'function_call',
        );
        if (hasFunctionCall) {
          const parts: Array<ToolCallPart | { type: 'text'; text: string }> = [];
          for (const block of msg.content) {
            if (typeof block !== 'string' && block.type === 'function_call') {
              const fc = block as unknown as FunctionCallBlock;
              parts.push({
                type: 'tool-call',
                toolCallId: fc.id ?? '',
                toolName: fc.name ?? '',
                input: safeJsonParse(fc.arguments),
              } satisfies ToolCallPart);
            } else if (typeof block !== 'string' && (block.type === 'input_text' || block.type === 'output_text') && block.text) {
              parts.push({ type: 'text', text: block.text });
            }
          }
          messages.push({ role: 'assistant', content: parts } as ModelMessage);
          continue;
        }
      }

      // Check for function_call_output inside message content array
      if (Array.isArray(msg.content)) {
        const hasFunctionCallOutput = msg.content.some(
          (b): b is ContentBlock & { type: 'function_call_output' } =>
            typeof b !== 'string' && b.type === 'function_call_output',
        );
        if (hasFunctionCallOutput) {
          for (const block of msg.content) {
            if (typeof block !== 'string' && block.type === 'function_call_output') {
              const fco = block as unknown as FunctionCallOutputBlock;
              const callId = fco.call_id ?? '';
              const toolName = toolNameIndex.get(callId) ?? (callId || '');
              const parts: ToolResultPart[] = [
                {
                  type: 'tool-result',
                  toolCallId: callId,
                  toolName,
                  output: {
                    type: 'text',
                    value: typeof fco.output === 'string' ? fco.output : String(fco.output ?? ''),
                  },
                } satisfies ToolResultPart,
              ];
              messages.push({ role: 'tool', content: parts } as ModelMessage);
            }
          }
          continue;
        }
      }

      // Default: flatten text as before
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: flatten(msg.content),
      } as ModelMessage);
    }
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
