import type { CanonicalResult } from '../canonical/types.js';

export function serializeChatJson(model: string, result: CanonicalResult): object {
  const prompt = result.usage.input_tokens + result.usage.cache_read_tokens;
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      { index: 0, message: { role: 'assistant', content: result.text }, finish_reason: result.finish_reason },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: result.usage.output_tokens,
      total_tokens: prompt + result.usage.output_tokens,
    },
  };
}
