import { expect, test } from 'vitest';
import { serializeChatSSE } from '../../src/outbound/serializeChat.js';
import { serializeResponsesSSE } from '../../src/outbound/serializeResponses.js';
import { serializeAnthropicSSE } from '../../src/outbound/serializeAnthropic.js';

async function* deltas() {
  yield 'Hel';
  yield 'lo';
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

test('chat SSE contains chunks and DONE', async () => {
  const text = await drain(serializeChatSSE('my-gpt', deltas()));
  expect(text).toContain('chat.completion.chunk');
  expect(text).toContain('"content":"Hel"');
  expect(text).toContain('"content":"lo"');
  expect(text).toContain('data: [DONE]');
});

test('responses SSE emits delta and completed events', async () => {
  const text = await drain(serializeResponsesSSE('my-gpt', deltas()));
  expect(text).toContain('event: response.output_text.delta');
  expect(text).toContain('"delta":"Hel"');
  expect(text).toContain('event: response.completed');
});

test('anthropic SSE emits message_start, deltas, message_stop', async () => {
  const text = await drain(serializeAnthropicSSE('my-sonnet', deltas()));
  expect(text).toContain('event: message_start');
  expect(text).toContain('event: content_block_delta');
  expect(text).toContain('"text":"Hel"');
  expect(text).toContain('event: message_stop');
});
