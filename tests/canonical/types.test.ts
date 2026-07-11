import { expect, test } from 'vitest';
import { emptyResult, type CanonicalRequest } from '../../src/canonical/types.js';

test('CanonicalRequest holds normalized fields', () => {
  const req: CanonicalRequest = {
    model: 'my-sonnet',
    system: 'be brief',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    reasoning: { effort: 'high' },
  };
  expect(req.system).toBe('be brief');
  expect(req.stream).toBe(true);
  expect(req.reasoning?.effort).toBe('high');
});

test('emptyResult provides a zeroed CanonicalResult', () => {
  const r = emptyResult();
  expect(r.text).toBe('');
  expect(r.finish_reason).toBe('stop');
  expect(r.usage.input_tokens).toBe(0);
  expect(r.tool_calls).toEqual([]);
});
