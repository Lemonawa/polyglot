import { expect, test } from 'vitest';
import { serializeChatSSE } from '../../src/outbound/serializeChat.js';
import { serializeResponsesSSE } from '../../src/outbound/serializeResponses.js';
import { serializeAnthropicSSE } from '../../src/outbound/serializeAnthropic.js';
import type { StreamEvent } from '../../src/outbound/execute.js';

async function* textDeltas(): AsyncIterable<StreamEvent> {
  yield { kind: 'text', text: 'Hel' };
  yield { kind: 'text', text: 'lo' };
}

async function* withTool(): AsyncIterable<StreamEvent> {
  yield { kind: 'text', text: 'Let me check.' };
  yield {
    kind: 'tool-call',
    toolCall: { toolCallId: 'call_1', toolName: 'get_weather', args: '{"location":"NYC"}' },
  };
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
  const text = await drain(serializeChatSSE('my-gpt', textDeltas()));
  expect(text).toContain('chat.completion.chunk');
  expect(text).toContain('"content":"Hel"');
  expect(text).toContain('"content":"lo"');
  expect(text).toContain('data: [DONE]');
});

test('chat SSE emits tool_calls chunk', async () => {
  const text = await drain(serializeChatSSE('my-gpt', withTool()));
  expect(text).toContain('"tool_calls"');
  expect(text).toContain('"name":"get_weather"');
  expect(text).toContain('"arguments":"{\\"location\\":\\"NYC\\"}"');
});

test('responses SSE emits delta and completed events', async () => {
  const text = await drain(serializeResponsesSSE('my-gpt', textDeltas()));
  expect(text).toContain('event: response.output_text.delta');
  expect(text).toContain('"delta":"Hel"');
  expect(text).toContain('event: response.completed');
});

test('responses SSE emits function_call events', async () => {
  const text = await drain(serializeResponsesSSE('my-gpt', withTool()));
  expect(text).toContain('event: response.output_item.added');
  expect(text).toContain('response.function_call_arguments.delta');
  expect(text).toContain('event: response.output_item.done');
  expect(text).toContain('"name":"get_weather"');
});

test('anthropic SSE emits message_start, deltas, message_stop', async () => {
  const text = await drain(serializeAnthropicSSE('my-sonnet', textDeltas()));
  expect(text).toContain('event: message_start');
  expect(text).toContain('event: content_block_delta');
  expect(text).toContain('"text":"Hel"');
  expect(text).toContain('event: message_stop');
});

test('anthropic SSE emits tool_use content block', async () => {
  const text = await drain(serializeAnthropicSSE('my-sonnet', withTool()));
  expect(text).toContain('"type":"tool_use"');
  expect(text).toContain('input_json_delta');
  expect(text).toContain('"partial_json":"{\\"location\\":\\"NYC\\"}"');
  expect(text).toContain('event: content_block_stop');
});
