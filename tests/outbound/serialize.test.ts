import { expect, test } from 'vitest';
import type { CanonicalResult } from '../../src/canonical/types.js';
import { serializeAnthropicJson } from '../../src/outbound/serializeAnthropic.js';
import { serializeChatJson } from '../../src/outbound/serializeChat.js';
import { serializeResponsesJson } from '../../src/outbound/serializeResponses.js';

const result: CanonicalResult = {
  text: 'hello world',
  tool_calls: [],
  finish_reason: 'stop',
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 2,
    cache_write_tokens: 0,
  },
};

const toolCallsResult: CanonicalResult = {
  text: '',
  tool_calls: [
    { toolCallId: 'call_1', toolName: 'get_weather', args: '{"city":"Paris"}' },
    { toolCallId: 'call_2', toolName: 'get_time', args: 'invalid json' },
  ],
  finish_reason: 'tool_calls',
  usage: {
    input_tokens: 20,
    output_tokens: 8,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  },
};

test('chat JSON shape', () => {
  const j = serializeChatJson('my-gpt', result) as {
    object: string;
    model: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  expect(j.object).toBe('chat.completion');
  expect(j.model).toBe('my-gpt');
  expect(j.choices[0].message.content).toBe('hello world');
  expect(j.choices[0].finish_reason).toBe('stop');
  expect(j.usage.prompt_tokens).toBe(12); // input + cache_read
  expect(j.usage.completion_tokens).toBe(5);
});

test('chat JSON tool_calls', () => {
  const j = serializeChatJson('my-gpt', toolCallsResult) as {
    choices: {
      message: {
        content: string;
        tool_calls: {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }[];
      };
      finish_reason: string;
    }[];
  };
  expect(j.choices[0].message.content).toBe('');
  expect(j.choices[0].finish_reason).toBe('tool_calls');
  expect(j.choices[0].message.tool_calls).toHaveLength(2);
  expect(j.choices[0].message.tool_calls[0].id).toBe('call_1');
  expect(j.choices[0].message.tool_calls[0].type).toBe('function');
  expect(j.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
  expect(j.choices[0].message.tool_calls[0].function.arguments).toBe(
    '{"city":"Paris"}',
  );
  expect(j.choices[0].message.tool_calls[1].function.name).toBe('get_time');
  expect(j.choices[0].message.tool_calls[1].function.arguments).toBe(
    'invalid json',
  );
});

test('responses JSON shape', () => {
  const j = serializeResponsesJson('my-gpt', result) as {
    object: string;
    output_text: string;
    output: { content: { type: string; text: string }[] }[];
  };
  expect(j.object).toBe('response');
  expect(j.output_text).toBe('hello world');
  expect(j.output[0].content[0].type).toBe('output_text');
  expect(j.output[0].content[0].text).toBe('hello world');
});

test('responses JSON tool_calls', () => {
  const j = serializeResponsesJson('my-gpt', toolCallsResult) as {
    output_text: string;
    output: (
      | { content: { type: string; text: string }[] }
      | {
          type: string;
          id: string;
          name: string;
          arguments: string;
          status: string;
        }
    )[];
  };
  expect(j.output_text).toBe('');
  const fc = j.output[1] as {
    type: string;
    id: string;
    name: string;
    arguments: string;
    status: string;
  };
  expect(fc.type).toBe('function_call');
  expect(fc.id).toBe('call_1');
  expect(fc.name).toBe('get_weather');
  expect(fc.arguments).toBe('{"city":"Paris"}');
  expect(fc.status).toBe('completed');
  const fc2 = j.output[2] as {
    type: string;
    id: string;
    name: string;
    arguments: string;
    status: string;
  };
  expect(fc2.type).toBe('function_call');
  expect(fc2.id).toBe('call_2');
  expect(fc2.name).toBe('get_time');
  expect(fc2.arguments).toBe('invalid json');
  expect(fc2.status).toBe('completed');
});

test('anthropic JSON shape', () => {
  const j = serializeAnthropicJson('my-sonnet', result) as {
    type: string;
    role: string;
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };
  expect(j.type).toBe('message');
  expect(j.role).toBe('assistant');
  expect(j.content[0].text).toBe('hello world');
  expect(j.usage.input_tokens).toBe(12);
  expect(j.usage.output_tokens).toBe(5);
});

test('anthropic JSON tool_calls', () => {
  const j = serializeAnthropicJson('my-sonnet', toolCallsResult) as {
    content: (
      | { type: string; text: string }
      | {
          type: string;
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
    )[];
    stop_reason: string;
  };
  expect(j.content[0]).toEqual({ type: 'text', text: '' });
  const tu = j.content[1] as {
    type: string;
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  expect(tu.type).toBe('tool_use');
  expect(tu.id).toBe('call_1');
  expect(tu.name).toBe('get_weather');
  expect(tu.input).toEqual({ city: 'Paris' });
  const tu2 = j.content[2] as {
    type: string;
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  expect(tu2.type).toBe('tool_use');
  expect(tu2.id).toBe('call_2');
  expect(tu2.name).toBe('get_time');
  expect(tu2.input).toEqual({}); // parse fail fallback
  expect(j.stop_reason).toBe('tool_use');
});
