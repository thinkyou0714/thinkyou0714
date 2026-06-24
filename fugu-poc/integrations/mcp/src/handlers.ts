/**
 * Pure tool-handler logic for the Fugu MCP server — NO MCP SDK import, so it is unit
 * tested from the core test suite. Returns MCP CallToolResult-shaped objects.
 */

import type { FuguClient, ChatMessage, ReasoningEffort, FuguResult } from "../../../src/index.ts";

/**
 * A structural subset of the MCP SDK's `CallToolResult`. The `[key: string]: unknown`
 * index signature is required, not laxity: the SDK result type is `z.core.$loose` (it has
 * its own string index signature), and TypeScript does NOT grant a *named* interface an
 * implicit index signature, so without this line `ToolResult` is not assignable to the
 * SDK's `ToolCallback` return type (`tsc` fails with "Index signature ... is missing").
 * The named optional fields below document the SDK keys we actually set/extend.
 */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Map a FuguResult to a tool result, surfacing truncation/empty answers instead of
 * silently returning "". A `status:"incomplete"` (e.g. hit `max_output_tokens` or a
 * content filter) is annotated in-band so the calling agent can see the answer was cut
 * off; a response with no usable text becomes an explicit `isError` rather than an empty
 * success the caller could mistake for "Fugu returned nothing".
 */
function fromResult(result: FuguResult): ToolResult {
  const note =
    result.status === "incomplete"
      ? `[Fugu response incomplete: ${result.incompleteReason ?? result.finishReason ?? "unknown reason"}]`
      : "";
  if (!result.text) {
    return fail(note || "Fugu returned an empty response.");
  }
  return note ? ok(`${result.text}\n\n${note}`) : ok(result.text);
}

export interface RespondArgs {
  input: string;
  model?: string;
  effort?: ReasoningEffort;
}

export async function fuguRespond(client: FuguClient, args: RespondArgs): Promise<ToolResult> {
  try {
    const result = await client.respond(args.input, { model: args.model, reasoningEffort: args.effort });
    return fromResult(result);
  } catch (err) {
    return fail(`Fugu error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface ChatArgs {
  messages: ChatMessage[];
  model?: string;
}

export async function fuguChat(client: FuguClient, args: ChatArgs): Promise<ToolResult> {
  try {
    const result = await client.chat(args.messages, { model: args.model });
    return fromResult(result);
  } catch (err) {
    return fail(`Fugu error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function fuguListModels(models: string[]): ToolResult {
  return ok(JSON.stringify(models));
}
