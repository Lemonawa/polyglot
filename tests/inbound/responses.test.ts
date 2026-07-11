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
