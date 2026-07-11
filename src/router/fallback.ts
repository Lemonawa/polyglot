import type { Provider } from '../types.js';

export interface AttemptOutcome {
  provider: Provider;
  ok: boolean;
  status?: number;
  error?: Error;
}

export interface RunResult<T> {
  value?: T;
  outcome: AttemptOutcome;
  attempts: number;
}

export function shouldFallback(outcome: AttemptOutcome): boolean {
  if (outcome.ok) return false;
  const { status, provider } = outcome;
  if (status === undefined) return true; // 连接/超时等无状态码的硬失败
  if (status >= 500) return true;
  if (status === 429) return true;
  if (provider.fallback_status_codes.includes(status)) return true;
  return false; // 普通 4xx（如 400）不降级
}

export async function runChain<T>(
  chain: Provider[],
  attempt: (p: Provider) => Promise<T>,
): Promise<RunResult<T>> {
  let attempts = 0;
  let lastOutcome: AttemptOutcome = {
    provider: chain[0] as Provider,
    ok: false,
    error: new Error('empty chain'),
  };

  for (const provider of chain) {
    attempts++;
    try {
      const value = await attempt(provider);
      return { value, outcome: { provider, ok: true }, attempts };
    } catch (err) {
      const e = err as Error & { status?: number };
      lastOutcome = { provider, ok: false, status: e.status, error: e };
      if (!shouldFallback(lastOutcome)) break;
    }
  }

  return { outcome: lastOutcome, attempts };
}
