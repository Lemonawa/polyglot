import { expect, test } from 'vitest';
import { buildCallOptions, toUsage, extractToolCalls } from '../../src/outbound/execute.js';
import type { CanonicalRequest } from '../../src/canonical/types.js';

// ---------------------------------------------------------------------------
// buildCallOptions – pure mapping, no network
// ---------------------------------------------------------------------------

const fakeModel = { modelId: 'x', provider: 'openai.chat' } as never;

test('maps canonical fields to AI SDK call options', () => {
  const req: CanonicalRequest = {
    model: 'm',
    system: 'be brief',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 128,
    temperature: 0.3,
    top_p: 0.9,
    stop: ['END'],
    stream: false,
    reasoning: { effort: 'high' },
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBe('be brief');
  expect(opts.maxOutputTokens).toBe(128);
  expect(opts.topP).toBe(0.9);
  expect(opts.stopSequences).toEqual(['END']);
  expect(opts.reasoning).toBe('high');
  expect(opts.messages).toEqual([{ role: 'user', content: 'hi' }]);
});

test('omits undefined optional fields', () => {
  const req: CanonicalRequest = {
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    stream: false,
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.instructions).toBeUndefined();
  expect(opts.maxOutputTokens).toBeUndefined();
  expect(opts.temperature).toBeUndefined();
  expect(opts.topP).toBeUndefined();
  expect(opts.stopSequences).toBeUndefined();
  expect(opts.reasoning).toBeUndefined();
  // tools/toolChoice should also be undefined when not provided
  expect(opts.tools).toBeUndefined();
  expect(opts.toolChoice).toBeUndefined();
});

test('buildCallOptions forwards tools and toolChoice', () => {
  const req: CanonicalRequest = {
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
    stream: false,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: { type: 'object', properties: { location: { type: 'string' } } },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'get_weather' } },
  };
  const opts = buildCallOptions(fakeModel, req);
  expect(opts.tools).toBeDefined();
  expect(opts.tools!.get_weather).toBeDefined();
  expect(opts.toolChoice).toEqual({ type: 'tool', toolName: 'get_weather' });
});

// ---------------------------------------------------------------------------
// extractToolCalls – unit test pure function
// ---------------------------------------------------------------------------

test('extractToolCalls maps AI SDK shape to CanonicalToolCall[]', () => {
  // AI SDK v7 toolCalls elements: { toolCallId, toolName, input }
  // where input is a parsed object
  const input = [
    { toolCallId: 'c1', toolName: 'get_weather', input: { location: 'NYC' } },
    { toolCallId: 'c2', toolName: 'search', input: 'query text' },
  ];
  const result = extractToolCalls(input);
  expect(result).toEqual([
    { toolCallId: 'c1', toolName: 'get_weather', args: '{"location":"NYC"}' },
    { toolCallId: 'c2', toolName: 'search', args: '"query text"' },
  ]);
});

test('extractToolCalls returns empty array for null/undefined/empty', () => {
  expect(extractToolCalls(null)).toEqual([]);
  expect(extractToolCalls(undefined)).toEqual([]);
  expect(extractToolCalls([])).toEqual([]);
});

// ---------------------------------------------------------------------------
// toUsage – token-usage helper
// ---------------------------------------------------------------------------

test('toUsage reads anthropic cacheCreationInputTokens from providerMetadata', () => {
  const usage = { inputTokens: 1000, outputTokens: 200 };
  const meta = { anthropic: { cacheCreationInputTokens: 500 } };
  const result = toUsage(usage, meta);
  expect(result.cache_write_tokens).toBe(500);
});

test('toUsage falls back to anthropic usage.cache_creation_input_tokens', () => {
  const usage = { inputTokens: 1000, outputTokens: 200 };
  const meta = { anthropic: { usage: { cache_creation_input_tokens: 300 } } };
  const result = toUsage(usage, meta);
  expect(result.cache_write_tokens).toBe(300);
});

test('toUsage prefers inputTokenDetails.cacheWriteTokens over all metadata', () => {
  const usage = { inputTokens: 1000, outputTokens: 200, inputTokenDetails: { cacheWriteTokens: 999 } };
  const meta = { anthropic: { cacheCreationInputTokens: 500 } };
  const result = toUsage(usage, meta);
  expect(result.cache_write_tokens).toBe(999);
});

test('toUsage defaults cache_write_tokens to 0 when no source exists', () => {
  const usage = { inputTokens: 1000, outputTokens: 200 };
  const result = toUsage(usage, undefined);
  expect(result.cache_write_tokens).toBe(0);
});
