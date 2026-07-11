import { expect, test } from 'vitest';
import { parseAnthropic } from '../../src/inbound/anthropic.js';

test('reads top-level system string and messages', () => {
  const req = parseAnthropic({
    model: 'my-sonnet',
    system: 'be kind',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
  expect(req.system).toBe('be kind');
  expect(req.max_tokens).toBe(256);
  expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(req.stream).toBe(true);
});

test('flattens system content-block array and text content blocks', () => {
  const req = parseAnthropic({
    model: 'm',
    system: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }],
    max_tokens: 10,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  });
  expect(req.system).toBe('line1\nline2');
  expect(req.messages).toEqual([{ role: 'user', content: 'hi' }]);
  expect(req.stream).toBe(false);
});

test('maps stop_sequences to stop', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    stop_sequences: ['END', 'STOP'],
  });
  expect(req.stop).toEqual(['END', 'STOP']);
});

test('maps temperature and top_p', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.7,
    top_p: 0.9,
  });
  expect(req.temperature).toBe(0.7);
  expect(req.top_p).toBe(0.9);
});

test('maps tools and tool_choice', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'get_weather' }],
    tool_choice: { type: 'auto' },
  });
  expect(req.tools).toEqual([{ name: 'get_weather' }]);
  expect(req.tool_choice).toEqual({ type: 'auto' });
});

test('unknown fields go to extra', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    custom_field: 'custom_val',
    another: 42,
  });
  expect(req.extra).toEqual({ custom_field: 'custom_val', another: 42 });
});

test('extra is undefined when no unknown fields', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });
  expect(req.extra).toBeUndefined();
});

test('stream defaults to false', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });
  expect(req.stream).toBe(false);
});

test('system is undefined when not provided', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
  });
  expect(req.system).toBeUndefined();
});

test('non-text content blocks in messages are ignored', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', source: { type: 'base64', data: 'abc' } },
        { type: 'text', text: 'world' },
      ],
    }],
  });
  expect(req.messages).toEqual([{ role: 'user', content: 'hello\nworld' }]);
});

test('non-text system blocks are filtered out', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hi' }],
    system: [
      { type: 'text', text: 'be' },
      { type: 'image', source: {} },
      { type: 'text', text: 'kind' },
    ],
  });
  expect(req.system).toBe('be\nkind');
});
