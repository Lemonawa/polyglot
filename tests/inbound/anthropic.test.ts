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
    system: [
      { type: 'text', text: 'line1' },
      { type: 'text', text: 'line2' },
    ],
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
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', source: { type: 'base64', data: 'abc' } },
          { type: 'text', text: 'world' },
        ],
      },
    ],
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

test('assistant tool_use blocks become ToolCallParts', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'get_weather',
            input: { loc: 'NYC' },
          },
        ],
      },
    ],
  });

  expect(req.messages).toHaveLength(2);
  // user message unchanged
  expect(req.messages[0]).toEqual({ role: 'user', content: 'weather?' });

  const assistantMsg = req.messages[1];
  expect(assistantMsg.role).toBe('assistant');
  expect(Array.isArray(assistantMsg.content)).toBe(true);
  const parts = assistantMsg.content as Array<Record<string, unknown>>;
  expect(parts).toHaveLength(2);
  // Text part
  expect(parts[0]).toMatchObject({ type: 'text', text: 'Let me check.' });
  // Tool call part
  expect(parts[1]).toMatchObject({
    type: 'tool-call',
    toolCallId: 'tu_1',
    toolName: 'get_weather',
    input: { loc: 'NYC' },
  });
});

test('user tool_result blocks become ToolModelMessage with ToolResultParts', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'get_weather',
            input: { loc: 'NYC' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '72°F' },
        ],
      },
    ],
  });

  expect(req.messages).toHaveLength(3);
  const toolMsg = req.messages[2];
  expect(toolMsg.role).toBe('tool');
  expect(Array.isArray(toolMsg.content)).toBe(true);
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({
    type: 'tool-result',
    toolCallId: 'tu_1',
    toolName: 'get_weather',
    output: { type: 'text', value: '72°F' },
  });
});

test('tool_result with unknown tool_use_id falls back', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'unknown_id', content: 'result' },
        ],
      },
    ],
  });

  const toolMsg = req.messages[0];
  expect(toolMsg.role).toBe('tool');
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts[0].toolCallId).toBe('unknown_id');
  expect(typeof parts[0].toolName).toBe('string');
});

test('tool_result with content block array joins text', () => {
  const req = parseAnthropic({
    model: 'm',
    max_tokens: 100,
    messages: [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'get_weather',
            input: { loc: 'NYC' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: [
              { type: 'text', text: '72' },
              { type: 'text', text: '°F' },
            ],
          },
        ],
      },
    ],
  });

  const toolMsg = req.messages[1];
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts[0]).toMatchObject({
    type: 'tool-result',
    toolCallId: 'tu_1',
    toolName: 'get_weather',
    output: { type: 'text', value: '72\n°F' },
  });
});
