import type { CanonicalResult } from '../canonical/types.js';

export function serializeAnthropicJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  const content: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] = [
    { type: 'text', text: result.text },
  ];
  for (const tc of result.tool_calls) {
    let input: unknown;
    try {
      input = JSON.parse(tc.args);
    } catch {
      input = {};
    }
    content.push({ type: 'tool_use', id: tc.toolCallId, name: tc.toolName, input });
  }
  const stop_reason =
    result.tool_calls.length > 0
      ? 'tool_use'
      : result.finish_reason === 'stop'
        ? 'end_turn'
        : result.finish_reason;
  return {
    id: `msg-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason,
    usage: { input_tokens: prompt, output_tokens: result.usage.output_tokens },
  };
}

function anthropicEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

export function serializeAnthropicSSE(
  model: string,
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `msg-${Date.now()}`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(anthropicEvent('message_start', {
          message: { id, type: 'message', role: 'assistant', model, content: [] },
        })),
      );
      controller.enqueue(
        encoder.encode(anthropicEvent('content_block_start', {
          index: 0, content_block: { type: 'text', text: '' },
        })),
      );
      for await (const delta of deltas) {
        controller.enqueue(
          encoder.encode(anthropicEvent('content_block_delta', {
            index: 0, delta: { type: 'text_delta', text: delta },
          })),
        );
      }
      controller.enqueue(encoder.encode(anthropicEvent('content_block_stop', { index: 0 })));
      controller.enqueue(encoder.encode(anthropicEvent('message_stop', {})));
      controller.close();
    },
  });
}
