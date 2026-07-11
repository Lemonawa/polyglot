import { expect, test } from 'vitest';
import { detectFormat } from '../../src/inbound/detect.js';

test('maps known paths to formats', () => {
  expect(detectFormat('/v1/chat/completions')).toBe('chat');
  expect(detectFormat('/v1/responses')).toBe('responses');
  expect(detectFormat('/v1/messages')).toBe('anthropic');
});

test('unknown path returns null', () => {
  expect(detectFormat('/v1/embeddings')).toBeNull();
});
