/**
 * Tool / function-calling types and per-API mapping. Zero dependencies.
 *
 * The Responses and Chat Completions APIs format tools differently:
 *   - Responses: `{ type:"function", name, description, parameters, strict }`
 *   - Chat:      `{ type:"function", function:{ name, description, parameters } }`
 * plus the built-in `{ type:"web_search" }` tool.
 */

import type { FuguToolCall } from "./types.ts";

export type FuguTool =
  | {
      type: "function";
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
      strict?: boolean;
    }
  | { type: "web_search" };

/** Common across both APIs. (Forcing a specific function is intentionally omitted.) */
export type ToolChoice = "auto" | "none" | "required";

export function functionTool(
  name: string,
  opts: { description?: string; parameters?: Record<string, unknown>; strict?: boolean } = {},
): FuguTool {
  return { type: "function", name, ...opts };
}

export function webSearchTool(): FuguTool {
  return { type: "web_search" };
}

const EMPTY_SCHEMA = { type: "object", properties: {} } as const;

export function mapToolsForResponses(tools: FuguTool[]): unknown[] {
  return tools.map((t) =>
    t.type === "function"
      ? {
          type: "function",
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? EMPTY_SCHEMA,
          strict: t.strict ?? false,
        }
      : { type: "web_search" },
  );
}

export function mapToolsForChat(tools: FuguTool[]): unknown[] {
  return tools.map((t) =>
    t.type === "function"
      ? {
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters ?? EMPTY_SCHEMA },
        }
      : { type: "web_search" },
  );
}

function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Parse tool/function calls from a Responses (`function_call`) or Chat (`tool_calls`) payload. */
export function parseToolCalls(raw: unknown): FuguToolCall[] {
  const calls: FuguToolCall[] = [];

  const output = getProp(raw, "output");
  if (Array.isArray(output)) {
    for (const item of output) {
      if (getProp(item, "type") === "function_call") {
        const name = str(getProp(item, "name"));
        if (name) {
          calls.push({
            id: str(getProp(item, "call_id")) ?? str(getProp(item, "id")) ?? "",
            name,
            arguments: str(getProp(item, "arguments")) ?? "",
          });
        }
      }
    }
  }
  // A real response is only ever one API shape; if Responses tool calls were found,
  // don't also scan the Chat shape (avoids double-counting a forward-compat dual payload).
  if (calls.length > 0) return calls;

  const choices = getProp(raw, "choices");
  if (Array.isArray(choices) && choices[0]) {
    const toolCalls = getProp(getProp(choices[0], "message"), "tool_calls");
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls) {
        const fn = getProp(call, "function");
        const name = str(getProp(fn, "name"));
        if (name) {
          calls.push({
            id: str(getProp(call, "id")) ?? "",
            name,
            arguments: str(getProp(fn, "arguments")) ?? "",
          });
        }
      }
    }
  }

  return calls;
}
