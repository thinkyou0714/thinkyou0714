/**
 * Fugu MCP server: exposes Sakana Fugu as MCP tools so Claude Code / Cursor / Codex can
 * call it as a sub-agent (a "second opinion" from the frontier-model pool).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FuguClient } from "../../../src/index.ts";
import { fuguRespond, fuguChat, fuguListModels } from "./handlers.ts";

const MODEL_ENUM = z.enum(["fugu", "fugu-ultra"]);
const EFFORT_ENUM = z.enum(["high", "xhigh", "max"]);

export function createFuguMcpServer(client: FuguClient, models: string[] = ["fugu", "fugu-ultra"]): McpServer {
  const server = new McpServer({ name: "fugu", version: "0.1.0" });

  server.registerTool(
    "fugu_respond",
    {
      title: "Ask Fugu",
      description:
        "Ask Sakana Fugu (Responses API) — a single endpoint that orchestrates a pool of frontier models. " +
        "Use for hard reasoning, adversarial review, or a second opinion. `fugu` is fast; `fugu-ultra` is max quality.",
      inputSchema: { input: z.string(), model: MODEL_ENUM.optional(), effort: EFFORT_ENUM.optional() },
    },
    async (args) => fuguRespond(client, args),
  );

  server.registerTool(
    "fugu_chat",
    {
      title: "Fugu chat",
      description: "Multi-turn chat with Fugu (Chat Completions API).",
      inputSchema: {
        messages: z.array(z.object({ role: z.enum(["system", "developer", "user", "assistant"]), content: z.string() })),
        model: MODEL_ENUM.optional(),
      },
    },
    async (args) => fuguChat(client, args),
  );

  server.registerTool(
    "fugu_list_models",
    { title: "List Fugu models", description: "List the available Fugu model ids.", inputSchema: {} },
    async () => fuguListModels(models),
  );

  return server;
}
