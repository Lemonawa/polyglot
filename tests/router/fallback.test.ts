import { expect, test } from 'vitest';
import { runChain, shouldFallback, type AttemptOutcome } from '../../src/router/fallback.js';
import type { Provider } from '../../src/types.js';

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: 1, logical_model_id: 1, priority: 0, upstream_format: 'chat', base_url: 'x',
    api_key: 'k', upstream_model: 'm', models_dev_id: null, fallback_status_codes: [],
    enabled: true, ...over,
  };
}

test('shouldFallback: hard failures trigger, plain 4xx does not', () => {
  const p = provider();
  expect(shouldFallback({ provider: p, ok: true })).toBe(false);
  expect(shouldFallback({ provider: p, ok: false, error: new Error('ECONNREFUSED') })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 500 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 429 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 400 })).toBe(false);
});

test('shouldFallback: custom fallback_status_codes trigger', () => {
  const p = provider({ fallback_status_codes: [402, 403] });
  expect(shouldFallback({ provider: p, ok: false, status: 402 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 403 })).toBe(true);
  expect(shouldFallback({ provider: p, ok: false, status: 404 })).toBe(false);
});

test('runChain: falls through to second provider on hard failure', async () => {
  const a = provider({ id: 1, upstream_model: 'a' });
  const b = provider({ id: 2, upstream_model: 'b' });
  const res = await runChain([a, b], async (p) => {
    if (p.id === 1) {
      const e = new Error('boom') as Error & { status?: number };
      e.status = 500;
      throw e;
    }
    return `ok-${p.upstream_model}`;
  });
  expect(res.value).toBe('ok-b');
  expect(res.outcome.ok).toBe(true);
  expect(res.attempts).toBe(2);
});

test('runChain: stops on non-fallback error (plain 400)', async () => {
  const a = provider({ id: 1 });
  const b = provider({ id: 2 });
  let bCalled = false;
  const res = await runChain([a, b], async (p) => {
    if (p.id === 1) {
      const e = new Error('bad') as Error & { status?: number };
      e.status = 400;
      throw e;
    }
    bCalled = true;
    return 'ok';
  });
  expect(res.value).toBeUndefined();
  expect(res.outcome.status).toBe(400);
  expect(res.attempts).toBe(1);
  expect(bCalled).toBe(false);
});

test('runChain: exhaust all providers, all fail with fallback errors', async () => {
  const a = provider({ id: 1, upstream_model: 'a' });
  const b = provider({ id: 2, upstream_model: 'b' });
  const c = provider({ id: 3, upstream_model: 'c' });
  const res = await runChain([a, b, c], async (p) => {
    const e = new Error(`fail-${p.upstream_model}`) as Error & { status?: number };
    e.status = 500;
    throw e;
  });
  expect(res.attempts).toBe(3);
  expect(res.outcome.ok).toBe(false);
  expect(res.outcome.status).toBe(500);
  expect(res.value).toBeUndefined();
});

test('runChain: empty chain returns zero attempts', async () => {
  const res = await runChain([], async () => 'x');
  expect(res.attempts).toBe(0);
  expect(res.value).toBeUndefined();
});
