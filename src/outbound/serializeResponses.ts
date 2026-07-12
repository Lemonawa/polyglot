import type { CanonicalResult } from '../canonical/types.js';
import type { StreamEvent } from './execute.js';

export function serializeResponsesJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  const output: unknown[] = [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: result.text }],
    },
  ];
  for (const tc of result.tool_calls) {
    output.push({
      type: 'function_call',
      id: tc.toolCallId,
      name: tc.toolName,
      arguments: tc.args,
      status: 'completed',
    });
  }
  return {
    id: `resp-${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    output_text: result.text,
    output,
    usage: {
      input_tokens: prompt,
      output_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}

function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function serializeResponsesSSE(
  model: string,
  events: AsyncIterable<StreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `resp-${Date.now()}`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(sseEvent('response.created', { type: 'response.created', response: { id, model, status: 'in_progress' } })),
      );
      let full = '';
      let outputIndex = 0;
      for await (const ev of events) {
        if (ev.kind === 'text') {
          full += ev.text;
          controller.enqueue(
            encoder.encode(sseEvent('response.output_text.delta', { type: 'response.output_text.delta', delta: ev.text })),
          );
        } else {
          const itemId = ev.toolCall.toolCallId;
          controller.enqueue(
            encoder.encode(sseEvent('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: outputIndex,
              item: { type: 'function_call', id: itemId, name: ev.toolCall.toolName, arguments: '', status: 'in_progress' },
            })),
          );
          controller.enqueue(
            encoder.encode(sseEvent('response.function_call_arguments.delta', {
              type: 'response.function_call_arguments.delta',
              item_id: itemId, output_index: outputIndex, delta: ev.toolCall.args,
            })),
          );
          controller.enqueue(
            encoder.encode(sseEvent('response.output_item.done', {
              type: 'response.output_item.done',
              output_index: outputIndex,
              item: { type: 'function_call', id: itemId, name: ev.toolCall.toolName, arguments: ev.toolCall.args, status: 'completed' },
            })),
          );
          outputIndex++;
        }
      }
      controller.enqueue(
        encoder.encode(sseEvent('response.completed', {
          type: 'response.completed',
          response: { id, model, status: 'completed', output_text: full },
        })),
      );
      controller.close();
    },
  });
}
