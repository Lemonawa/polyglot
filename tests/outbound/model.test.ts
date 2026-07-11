import { expect, test } from 'vitest';
import { buildModel } from '../../src/outbound/model.js';
import type { Provider } from '../../src/types.js';

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: 1, logical_model_id: 1, priority: 0, upstream_format: 'chat',
    base_url: 'https://proxy.example/v1', api_key: 'sk-test', upstream_model: 'gpt-4o',
    models_dev_id: null, fallback_status_codes: [], enabled: true, ...over,
  };
}

test('chat format builds an openai chat model with the upstream model id', () => {
  const m = buildModel(provider({ upstream_format: 'chat', upstream_model: 'gpt-4o' }));
  expect(m.modelId).toBe('gpt-4o');
  expect(m.provider).toContain('openai');
});

test('anthropic format builds an anthropic model', () => {
  const m = buildModel(
    provider({ upstream_format: 'anthropic', base_url: 'https://api.anthropic.com', upstream_model: 'claude-sonnet-4' }),
  );
  expect(m.modelId).toBe('claude-sonnet-4');
  expect(m.provider).toContain('anthropic');
});

test('responses format builds an openai responses model', () => {
  const m = buildModel(provider({ upstream_format: 'responses', upstream_model: 'gpt-5' }));
  expect(m.modelId).toBe('gpt-5');
  expect(m.provider).toContain('openai');
});
