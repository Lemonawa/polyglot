import type { ToolChoice, ToolSet } from 'ai';
import { jsonSchema, tool } from 'ai';

/**
 * Convert an OpenAI-shaped tools array to an AI SDK 7 ToolSet.
 *
 * Each tool entry should follow the OpenAI format:
 *   { type: 'function', function: { name, description?, parameters } }
 *
 * The result is a Record<string, Tool> keyed by tool name, with the schema
 * wrapped via jsonSchema() and NO execute property (the relay does not
 * execute tools itself).
 *
 * Returns undefined for nullish, non-array, or empty input.
 */
export function toToolSet(tools: unknown): ToolSet | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;

  const entries: Array<[string, ReturnType<typeof tool>]> = [];

  for (const t of tools) {
    if (t == null || typeof t !== 'object') continue;
    const entry = t as Record<string, unknown>;
    if (entry.type !== 'function') continue;

    const fn = entry.function as Record<string, unknown> | undefined;
    if (fn == null || typeof fn !== 'object') continue;

    const name = fn.name;
    if (typeof name !== 'string' || !name) continue;

    const description =
      typeof fn.description === 'string' ? fn.description : undefined;
    const parameters = fn.parameters as Record<string, unknown> | undefined;

    // The AI SDK 7 Tool type requires inputSchema (a FlexibleSchema), not
    // a raw parameters object.  jsonSchema() wraps a JSON Schema into a
    // Schema object that satisfies FlexibleSchema.
    entries.push([
      name,
      tool({
        description,
        inputSchema: parameters
          ? jsonSchema(parameters)
          : jsonSchema({ type: 'object', properties: {} }),
      }),
    ]);
  }

  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as unknown as ToolSet;
}

/**
 * Convert an OpenAI-shaped tool_choice to an AI SDK 7 ToolChoice.
 *
 * Accepts:
 *   - 'auto', 'none', 'required' (passed through)
 *   - { type: 'function', function: { name } }  →  { type: 'tool', toolName: name }
 *
 * Returns undefined for unrecognised or nullish input.
 */
export function toToolChoice(
  choice: unknown,
): ToolChoice<Record<string, unknown>> | undefined {
  if (choice == null) return undefined;

  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }

  if (typeof choice === 'object') {
    const obj = choice as Record<string, unknown>;
    if (obj.type === 'function') {
      const fn = obj.function as Record<string, unknown> | undefined;
      if (fn != null && typeof fn.name === 'string' && fn.name) {
        return { type: 'tool', toolName: fn.name } as ToolChoice<
          Record<string, unknown>
        >;
      }
    }
  }

  return undefined;
}
