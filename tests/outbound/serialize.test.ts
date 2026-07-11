import { expect, test } from 'vitest';
import { serializeChatJson } from '../../src/outbound/serializeChat.js';
import { serializeResponsesJson } from '../../src/outbound/serializeResponses.js';
import { serializeAnthropicJson } from '../../src/outbound/serializeAnthropic.js';
import type { CanonicalResult } from '../../src/canonical/types.js';

const result: CanonicalResult = {
  text: 'hello world',
  tool_calls: [],
  finish_reason: 'stop',
  usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 2, cache_write_tokens: 0 },
};

test('chat JSON shape', () => {
  const j = serializeChatJson('my-gpt', result) as {
    object: string; model: string; choices: { message: { content: string }; finish_reason: string }[]; usage: { prompt_tokens: number; completion_tokens: number };
  };
  expect(j.object).toBe('chat.completion');
  expect(j.model).toBe('my-gpt');
  expect(j.choices[0].message.content).toBe('hello world');
  expect(j.choices[0].finish_reason).toBe('stop');
  expect(j.usage.prompt_tokens).toBe(12); // input + cache_read
  expect(j.usage.completion_tokens).toBe(5);
});

test('responses JSON shape', () => {
  const j = serializeResponsesJson('my-gpt', result) as {
    object: string; output_text: string; output: { content: { type: string; text: string }[] }[];
  };
  expect(j.object).toBe('response');
  expect(j.output_text).toBe('hello world');
  expect(j.output[0].content[0].type).toBe('output_text');
  expect(j.output[0].content[0].text).toBe('hello world');
});

test('anthropic JSON shape', () => {
  const j = serializeAnthropicJson('my-sonnet', result) as {
    type: string; role: string; content: { type: string; text: string }[]; usage: { input_tokens: number; output_tokens: number };
  };
  expect(j.type).toBe('message');
  expect(j.role).toBe('assistant');
  expect(j.content[0].text).toBe('hello world');
  expect(j.usage.input_tokens).toBe(12);
  expect(j.usage.output_tokens).toBe(5);
});
