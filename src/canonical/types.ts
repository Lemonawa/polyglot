import type { ModelMessage } from 'ai';
import type { TokenUsage } from '../types.js';

export interface CanonicalReasoning {
  effort?: string;
  budget_tokens?: number;
}

export interface CanonicalRequest {
  model: string; // 逻辑模型名
  system?: string; // 提取自各家 system, 执行时作为顶层 instructions
  messages: ModelMessage[];
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  reasoning?: CanonicalReasoning;
  extra?: Record<string, unknown>; // 无法映射的字段原样透传
}

export interface CanonicalResult {
  text: string;
  tool_calls: unknown[];
  finish_reason: string;
  usage: TokenUsage;
  raw_provider_metadata?: unknown;
}

export function emptyResult(): CanonicalResult {
  return {
    text: '',
    tool_calls: [],
    finish_reason: 'stop',
    usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
  };
}
