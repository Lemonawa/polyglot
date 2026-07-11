import { APICallError } from '@ai-sdk/provider';

// Extract an HTTP status code from an AI SDK (or other) thrown error.
// AI SDK throws APICallError with `statusCode`; some callers (e.g. tests, custom
// wrappers) may attach `status`. Prefer statusCode, fall back to status.
export function extractStatus(err: unknown): number | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const e = err as { statusCode?: number; status?: number };
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.status === 'number') return e.status;
  if (APICallError.isInstance(err)) return err.statusCode;
  return undefined;
}
