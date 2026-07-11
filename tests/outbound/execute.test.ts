import { expect, test, vi } from 'vitest';
import { buildCallOptions } from '../../src/outbound/execute.js';
import type { CanonicalRequest } from '../../src/canonical/types.js';

// ---------------------------------------------------------------------------
// buildCallOptions – pure mapping, no network
// ---------------------------------------------------------------------------

const fakeModel = { modelId: 'x', provider: 'openai.chat' } as never;

test('maps canonical fields to AI SDK call options', () => {
  const req: CanonicalRequest = {
    model: 'm',
    system: 'be brief',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 128,
    temperature: 0.3,
    top_p: 0.9,
    stop: ['END'],
    stream: false,
    reasoning: { effort: 'high' },
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBe('be brief');
  expect(opts.maxOutputTokens).toBe(128);
  expect(opts.topP).toBe(0.9);
  expect(opts.stopSequences).toEqual(['END']);
  expect(opts.reasoning).toBe('high');
  expect(opts.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

test('omits undefined optional fields', () => {
  const req: CanonicalRequest = {
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    stream: false,
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBeUndefined();
  expect(opts.maxOutputTokens).toBeUndefined();
  expect(opts.temperature).toBeUndefined();
  expect(opts.topP).toBeUndefined();
  expect(opts.stopSequences).toBeUndefined();
  expect(opts.reasoning).toBeUndefined();
});
