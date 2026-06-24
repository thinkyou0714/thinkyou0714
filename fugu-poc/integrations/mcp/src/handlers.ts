/**
 * Pure tool-handler logic for the Fugu MCP server — NO MCP SDK import, so it is unit
 * tested from the core test suite. Returns MCP CallToolResult-shaped objects.
 */

import type { FuguClient, ChatMessage, ReasoningEffort } from "../../../src/index.ts";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  // Structural compatibility with the MCP SDK's CallToolResult (passthrough index signature).
  [key: string]: unknown;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function fail(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

export interface RespondArgs {
  input: string;
  model?: string;
  effort?: ReasoningEffort;
}

export async function fuguRespond(client: FuguClient, args: RespondArgs): Promise<ToolResult> {
  try {
    const result = await client.respond(args.input, { model: args.model, reasoningEffort: args.effort });
    return ok(result.text);
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
    return ok(result.text);
  } catch (err) {
    return fail(`Fugu error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function fuguListModels(models: string[]): ToolResult {
  return ok(JSON.stringify(models));
}
