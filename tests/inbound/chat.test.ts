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
