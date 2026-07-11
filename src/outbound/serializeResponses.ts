import type { CanonicalResult } from '../canonical/types.js';

export function serializeResponsesJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `resp-${Date.now()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: 'completed',
    output_text: result.text,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: result.text }],
      },
    ],
    usage: {
      input_tokens: prompt,
      output_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}
