import type { CanonicalResult } from '../canonical/types.js';

export function serializeChatJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.finish_reason },
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
  deltas: AsyncIterable<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  return new ReadableStream({
    async start(controller) {
      for await (const delta of deltas) {
        const chunk = {
          id, object: 'chat.completion.chunk', created, model,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(sse(JSON.stringify(chunk))));
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
