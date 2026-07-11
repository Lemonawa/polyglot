import type { WireFormat } from '../types.js';

export function detectFormat(path: string): WireFormat | null {
  if (path.endsWith('/v1/chat/completions')) return 'chat';
  if (path.endsWith('/v1/responses')) return 'responses';
  if (path.endsWith('/v1/messages')) return 'anthropic';
  return null;
}
