import { expect, test } from 'vitest';
import { parseInbound, serializeJson, serializeSSE } from '../src/convert.js';
import type { CanonicalResult } from '../src/canonical/types.js';

// ---------------------------------------------------------------------------
// parseInbound dispatch
// ---------------------------------------------------------------------------

test('parseInbound dispatches by format (anthropic top-level system)', () => {
  const req = parseInbound('anthropic', {
    model: 'm', system: 'sys', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }],
  });
  expect(req.system).toBe('sys');
  expect(req.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

test('parseInbound dispatches chat format', () => {
  const req = parseInbound('chat', {
    model: 'gpt', messages: [{ role: 'user', content: 'hello' }],
  });
  expect(req.system).toBeUndefined();
  expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
});

test('parseInbound dispatches responses format', () => {
  const req = parseInbound('responses', {
    model: 'oai', input: 'hi',
  });
  expect(req.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

// ---------------------------------------------------------------------------
// serializeJson dispatch (cross-format)
// ---------------------------------------------------------------------------

const sampleResult: CanonicalResult = {
  text: 'hello world', tool_calls: [], finish_reason: 'stop',
  usage: { input_tokens: 5, output_tokens: 3, cache_read_tokens: 1, cache_write_tokens: 0 },
};

test('cross-format: chat in -> anthropic out JSON', () => {
  const j = serializeJson('anthropic', 'my-sonnet', sampleResult) as { type: string; content: { text: string }[] };
  expect(j.type).toBe('message');
  expect(j.content[0].text).toBe('hello world');
});

test('serializeJson dispatches chat format', () => {
  const j = serializeJson('chat', 'gpt-4', sampleResult) as { object: string; choices: { message: { content: string } }[] };
  expect(j.object).toBe('chat.completion');
  expect(j.choices[0].message.content).toBe('hello world');
});

test('serializeJson dispatches responses format', () => {
  const j = serializeJson('responses', 'o1', sampleResult) as { object: string; output_text: string };
  expect(j.object).toBe('response');
  expect(j.output_text).toBe('hello world');
});

// ---------------------------------------------------------------------------
// serializeSSE dispatch (smoke test — ReadableStream creation)
// ---------------------------------------------------------------------------

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const parts: string[] = [];
  let done: boolean | undefined;
  while (!done) {
    const { value, done: d } = await reader.read();
    done = d;
    if (value) parts.push(new TextDecoder().decode(value));
  }
  return parts.join('');
}

test('serializeSSE dispatches chat format', async () => {
  async function* gen() { yield 'hello'; yield ' world'; }
  const stream = serializeSSE('chat', 'gpt', gen());
  const text = await collectStream(stream);
  expect(text).toContain('data: [DONE]');
  expect(text).toContain('hello');
  expect(text).toContain('world');
});

test('serializeSSE dispatches anthropic format', async () => {
  async function* gen() { yield 'hi'; }
  const stream = serializeSSE('anthropic', 'claude', gen());
  const text = await collectStream(stream);
  expect(text).toContain('message_start');
  expect(text).toContain('hi');
});

test('serializeSSE dispatches responses format', async () => {
  async function* gen() { yield 'hello'; }
  const stream = serializeSSE('responses', 'o1', gen());
  const text = await collectStream(stream);
  expect(text).toContain('response.created');
  expect(text).toContain('hello');
});
