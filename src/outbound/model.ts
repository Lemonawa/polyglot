import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import type { Provider } from '../types.js';

export function buildModel(provider: Provider): LanguageModel {
  switch (provider.upstream_format) {
    case 'chat': {
      const openai = createOpenAI({ baseURL: provider.base_url, apiKey: provider.api_key });
      return openai.chat(provider.upstream_model);
    }
    case 'responses': {
      const openai = createOpenAI({ baseURL: provider.base_url, apiKey: provider.api_key });
      return openai.responses(provider.upstream_model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ baseURL: provider.base_url, apiKey: provider.api_key });
      return anthropic(provider.upstream_model);
    }
  }
}
