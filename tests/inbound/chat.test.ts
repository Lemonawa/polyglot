import { expect, test } from 'vitest';
import { parseChat } from '../../src/inbound/chat.js';

test('extracts system to top-level and keeps user/assistant messages', () => {
  const req = parseChat({
    model: 'my-gpt',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ],
    temperature: 0.5,
    max_tokens: 100,
    stream: true,
  });
  expect(req.model).toBe('my-gpt');
  expect(req.system).toBe('be brief');
  expect(req.messages).toEqual([{ role: 'user', content: 'hello' }]);
  expect(req.temperature).toBe(0.5);
  expect(req.max_tokens).toBe(100);
  expect(req.stream).toBe(true);
});

test('joins multiple system messages and defaults stream false', () => {
  const req = parseChat({
    model: 'm',
    messages: [
      { role: 'system', content: 'a' },
      { role: 'system', content: 'b' },
      { role: 'user', content: 'q' },
    ],
  });
  expect(req.system).toBe('a\nb');
  expect(req.stream).toBe(false);
});

test('assistant tool_calls become ToolCallParts', () => {
  const req = parseChat({
    model: 'm',
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"loc":"NYC"}' },
          },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'get_time', arguments: '{"tz":"EST"}' },
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
  expect(parts[0]).toMatchObject({
    type: 'tool-call',
    toolCallId: 'call_1',
    toolName: 'get_weather',
    input: { loc: 'NYC' },
  });
  expect(parts[1]).toMatchObject({
    type: 'tool-call',
    toolCallId: 'call_2',
    toolName: 'get_time',
    input: { tz: 'EST' },
  });
});

test('tool role messages become ToolModelMessage with ToolResultParts', () => {
  const req = parseChat({
    model: 'm',
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '72°F' },
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
    toolCallId: 'call_1',
    toolName: 'get_weather',
    output: { type: 'text', value: '72°F' },
  });
});

test('tool message with unknown tool_call_id falls back', () => {
  const req = parseChat({
    model: 'm',
    messages: [{ role: 'tool', tool_call_id: 'unknown_id', content: 'result' }],
  });

  const toolMsg = req.messages[0];
  expect(toolMsg.role).toBe('tool');
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts[0].toolCallId).toBe('unknown_id');
  // toolName falls back to tool_call_id or empty string
  expect(typeof parts[0].toolName).toBe('string');
});
