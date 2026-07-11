import type { CanonicalResult } from '../canonical/types.js';

export function serializeAnthropicJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `msg-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: result.text }],
    stop_reason: result.finish_reason === 'stop' ? 'end_turn' : result.finish_reason,
    usage: { input_tokens: prompt, output_tokens: result.usage.output_tokens },
  };
}
