import { describe, expect, test } from 'vitest';
import { toToolSet, toToolChoice } from '../../src/inbound/tools.js';

describe('toToolSet', () => {
  test('converts OpenAI-shaped tools array to ToolSet', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather for a city',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_time',
          description: 'Get current time for a timezone',
          parameters: {
            type: 'object',
            properties: {
              tz: { type: 'string' },
            },
            required: ['tz'],
          },
        },
      },
    ];

    const result = toToolSet(tools);

    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(['get_weather', 'get_time']);

    // Each tool has description and inputSchema (jsonSchema-wrapped), no execute
    const weather = result!['get_weather'];
    expect(weather.description).toBe('Get current weather for a city');
    expect(weather.inputSchema).toBeDefined();
    // jsonSchema wraps the schema
    const weatherSchema = weather.inputSchema as { jsonSchema: Record<string, unknown> };
    expect(weatherSchema).toHaveProperty('jsonSchema');
    expect(weatherSchema.jsonSchema).toMatchObject({
      type: 'object',
      properties: { city: { type: 'string' } },
    });
    // No execute on the tool
    expect(weather).not.toHaveProperty('execute');

    const time = result!['get_time'];
    expect(time.description).toBe('Get current time for a timezone');
    expect(time.inputSchema).toBeDefined();
    const timeSchema = time.inputSchema as { jsonSchema: Record<string, unknown> };
    expect(timeSchema).toHaveProperty('jsonSchema');
    expect(timeSchema.jsonSchema).toMatchObject({
      type: 'object',
      properties: { tz: { type: 'string' } },
    });
  });

  test('returns undefined for null/undefined input', () => {
    expect(toToolSet(null)).toBeUndefined();
    expect(toToolSet(undefined)).toBeUndefined();
  });

  test('returns undefined for non-array input', () => {
    expect(toToolSet('hello')).toBeUndefined();
    expect(toToolSet(42)).toBeUndefined();
    expect(toToolSet({})).toBeUndefined();
  });

  test('skips malformed tools (missing name)', () => {
    const tools = [
      { type: 'function', function: { name: 'valid_tool', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { description: 'no name here' } },
      { type: 'function' },
      {},
      null,
    ];

    const result = toToolSet(tools);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toEqual(['valid_tool']);
    expect(result!['valid_tool'].description).toBeUndefined();
  });

  test('handles tools without description', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'bare_tool',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const result = toToolSet(tools);
    expect(result).toBeDefined();
    expect(result!['bare_tool'].description).toBeUndefined();
  });

  test('handles empty tools array', () => {
    expect(toToolSet([])).toBeUndefined();
  });
});

describe('toToolChoice', () => {
  test('maps "auto"', () => {
    expect(toToolChoice('auto')).toBe('auto');
  });

  test('maps "none"', () => {
    expect(toToolChoice('none')).toBe('none');
  });

  test('maps "required"', () => {
    expect(toToolChoice('required')).toBe('required');
  });

  test('maps named tool from OpenAI shape', () => {
    const result = toToolChoice({ type: 'function', function: { name: 'get_weather' } });
    expect(result).toEqual({ type: 'tool', toolName: 'get_weather' });
  });

  test('returns undefined for null/undefined', () => {
    expect(toToolChoice(null)).toBeUndefined();
    expect(toToolChoice(undefined)).toBeUndefined();
  });

  test('returns undefined for unrecognized shapes', () => {
    expect(toToolChoice(42)).toBeUndefined();
    expect(toToolChoice({ type: 'function' })).toBeUndefined(); // missing function.name
    expect(toToolChoice({})).toBeUndefined();
  });
});
