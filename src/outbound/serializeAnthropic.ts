import type { CanonicalResult } from '../canonical/types.js';
import type { StreamEvent } from './execute.js';

export function serializeAnthropicJson(
  model: string,
  result: CanonicalResult,
): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  const content: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }[] = [{ type: 'text', text: result.text }];
  for (const tc of result.tool_calls) {
    let input: unknown;
    try {
      input = JSON.parse(tc.args);
    } catch {
      input = {};
    }
    content.push({
      type: 'tool_use',
      id: tc.toolCallId,
      name: tc.toolName,
      input,
    });
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
  events: AsyncIterable<StreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `msg-${Date.now()}`;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          anthropicEvent('message_start', {
            message: {
              id,
              type: 'message',
              role: 'assistant',
              model,
              content: [],
            },
          }),
        ),
      );
      let blockIdx = 0;
      let textBlockOpen = false;
      for await (const ev of events) {
        if (ev.kind === 'text') {
          if (!textBlockOpen) {
            controller.enqueue(
              encoder.encode(
                anthropicEvent('content_block_start', {
                  index: blockIdx,
                  content_block: { type: 'text', text: '' },
                }),
              ),
            );
            textBlockOpen = true;
          }
          controller.enqueue(
            encoder.encode(
              anthropicEvent('content_block_delta', {
                index: blockIdx,
                delta: { type: 'text_delta', text: ev.text },
              }),
            ),
          );
        } else {
          if (textBlockOpen) {
            controller.enqueue(
              encoder.encode(
                anthropicEvent('content_block_stop', { index: blockIdx }),
              ),
            );
            blockIdx++;
            textBlockOpen = false;
          }
          controller.enqueue(
            encoder.encode(
              anthropicEvent('content_block_start', {
                index: blockIdx,
                content_block: {
                  type: 'tool_use',
                  id: ev.toolCall.toolCallId,
                  name: ev.toolCall.toolName,
                  input: {},
                },
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(
              anthropicEvent('content_block_delta', {
                index: blockIdx,
                delta: {
                  type: 'input_json_delta',
                  partial_json: ev.toolCall.args,
                },
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(
              anthropicEvent('content_block_stop', { index: blockIdx }),
            ),
          );
          blockIdx++;
        }
      }
      if (textBlockOpen) {
        controller.enqueue(
          encoder.encode(
            anthropicEvent('content_block_stop', { index: blockIdx }),
          ),
        );
      }
      controller.enqueue(encoder.encode(anthropicEvent('message_stop', {})));
      controller.close();
    },
  });
}
