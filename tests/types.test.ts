import { expect, test } from 'vitest';
import type { Budget, Provider, TokenUsage } from '../src/types.js';
import { isWireFormat } from '../src/types.js';

test('Provider shape compiles and holds expected fields', () => {
  const p: Provider = {
    id: 1,
    logical_model_id: 1,
    priority: 0,
    upstream_format: 'chat',
    base_url: 'https://api.openai.com/v1',
    api_key: 'sk-x',
    upstream_model: 'gpt-4o',
    models_dev_id: null,
    fallback_status_codes: [402, 403],
    enabled: true,
  };
  expect(p.fallback_status_codes).toEqual([402, 403]);
});

test('Budget scope/period/action are constrained', () => {
  const b: Budget = {
    id: 1,
    scope: 'global',
    target_id: null,
    limit_usd: 50,
    period: 'month',
    action: 'block',
  };
  expect(b.period).toBe('month');
});

test('TokenUsage has four token buckets', () => {
  const u: TokenUsage = {
    input_tokens: 1,
    output_tokens: 2,
    cache_read_tokens: 3,
    cache_write_tokens: 4,
  };
  expect(
    u.input_tokens +
      u.output_tokens +
      u.cache_read_tokens +
      u.cache_write_tokens,
  ).toBe(10);
});

test('isWireFormat guards valid formats', () => {
  expect(isWireFormat('chat')).toBe(true);
  expect(isWireFormat('responses')).toBe(true);
  expect(isWireFormat('anthropic')).toBe(true);
  expect(isWireFormat('grpc')).toBe(false);
});
