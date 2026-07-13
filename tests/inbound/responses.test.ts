import { expect, test } from 'vitest';
import { parseResponses } from '../../src/inbound/responses.js';

test('string input becomes a single user message; instructions -> system', () => {
  const req = parseResponses({
    model: 'my-gpt',
    instructions: 'be terse',
    input: 'what is 2+2?',
    max_output_tokens: 64,
    stream: true,
  });
  expect(req.system).toBe('be terse');
  expect(req.messages).toEqual([{ role: 'user', content: 'what is 2+2?' }]);
  expect(req.max_tokens).toBe(64);
  expect(req.stream).toBe(true);
});

test('array input with content blocks and reasoning effort', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
    ],
    reasoning: { effort: 'high' },
  });
  expect(req.messages).toEqual([
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  expect(req.reasoning?.effort).toBe('high');
  expect(req.stream).toBe(false);
});

test('function_call in assistant content becomes ToolCallPart', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'Sure.' },
          {
            type: 'function_call',
            id: 'fc_1',
            name: 'get_weather',
            arguments: '{"loc":"NYC"}',
          },
        ],
      },
    ],
  });

  expect(req.messages).toHaveLength(2);
  const assistantMsg = req.messages[1];
  expect(assistantMsg.role).toBe('assistant');
  expect(Array.isArray(assistantMsg.content)).toBe(true);
  const parts = assistantMsg.content as Array<Record<string, unknown>>;
  expect(parts).toHaveLength(2);
  expect(parts[0]).toMatchObject({ type: 'text', text: 'Sure.' });
  expect(parts[1]).toMatchObject({
    type: 'tool-call',
    toolCallId: 'fc_1',
    toolName: 'get_weather',
    input: { loc: 'NYC' },
  });
});

test('standalone function_call item becomes ToolCallPart in assistant message', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        id: 'fc_1',
        name: 'get_weather',
        arguments: '{"loc":"NYC"}',
      },
    ],
  });

  expect(req.messages).toHaveLength(2);
  const assistantMsg = req.messages[1];
  expect(assistantMsg.role).toBe('assistant');
  const parts = assistantMsg.content as Array<Record<string, unknown>>;
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({
    type: 'tool-call',
    toolCallId: 'fc_1',
    toolName: 'get_weather',
    input: { loc: 'NYC' },
  });
});

test('function_call_output becomes ToolModelMessage with ToolResultPart', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        id: 'fc_1',
        name: 'get_weather',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'fc_1', output: '72°F' },
    ],
  });

  expect(req.messages).toHaveLength(3);
  const toolMsg = req.messages[2];
  expect(toolMsg.role).toBe('tool');
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts).toHaveLength(1);
  expect(parts[0]).toMatchObject({
    type: 'tool-result',
    toolCallId: 'fc_1',
    toolName: 'get_weather',
    output: { type: 'text', value: '72°F' },
  });
});

test('function_call_output with unknown call_id falls back', () => {
  const req = parseResponses({
    model: 'm',
    input: [
      { type: 'function_call_output', call_id: 'unknown_id', output: 'result' },
    ],
  });

  const toolMsg = req.messages[0];
  expect(toolMsg.role).toBe('tool');
  const parts = toolMsg.content as Array<Record<string, unknown>>;
  expect(parts[0].toolCallId).toBe('unknown_id');
  expect(typeof parts[0].toolName).toBe('string');
});
