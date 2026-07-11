import { streamText } from 'ai';
import type { LanguageModel } from 'ai';

export interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  stream?: boolean;
  [k: string]: unknown;
}

export interface ProviderReply {
  text: string;
  usage: { input: number; output: number };
}

// 用 AI SDK 消费上游, 聚合成完整文本。system 提取到 instructions(AI SDK 7 默认拒绝 messages 中 system role)。
export async function callProviderChat(model: LanguageModel, body: ChatBody): Promise<ProviderReply> {
  const system = body.messages.find((m) => m.role === 'system')?.content;
  const messages = body.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const result = streamText({ model, instructions: system, messages });
  let text = '';
  for await (const delta of result.textStream) text += delta;
  const usage = await result.usage;
  return {
    text,
    usage: { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 },
  };
}
