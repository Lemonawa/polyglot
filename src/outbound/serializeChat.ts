import type { CanonicalResult } from '../canonical/types.js';
import type { StreamEvent } from './execute.js';

export function serializeChatJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  const message: { role: string; content: string; tool_calls?: unknown[] } = {
    role: 'assistant',
    content: result.text,
  };
  const finish_reason = result.tool_calls.length > 0 ? 'tool_calls' : result.finish_reason;
  if (result.tool_calls.length > 0) {
    message.tool_calls = result.tool_calls.map(tc => ({
      id: tc.toolCallId,
      type: 'function',
      function: { name: tc.toolName, arguments: tc.args },
    }));
  }
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message, finish_reason },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}

function sse(data: string): string {
  return `data: ${data}\n\n`;
}

export function serializeChatSSE(
  model: string,
  events: AsyncIterable<StreamEvent>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let toolIndex = 0;
  return new ReadableStream({
    async start(controller) {
      for await (const ev of events) {
        if (ev.kind === 'text') {
          const chunk = {
            id, object: 'chat.completion.chunk', created, model,
            choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(sse(JSON.stringify(chunk))));
        } else {
          const chunk = {
            id, object: 'chat.completion.chunk', created, model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: toolIndex++,
                  id: ev.toolCall.toolCallId,
                  type: 'function',
                  function: { name: ev.toolCall.toolName, arguments: ev.toolCall.args },
                }],
              },
              finish_reason: null,
            }],
          };
          controller.enqueue(encoder.encode(sse(JSON.stringify(chunk))));
        }
      }
      const final = {
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      controller.enqueue(encoder.encode(sse(JSON.stringify(final))));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}
