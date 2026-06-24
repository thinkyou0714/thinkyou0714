#!/usr/bin/env node
/**
 * `fugu-mcp` — start the Fugu MCP server over stdio (for Claude Code / Cursor / Codex).
 *
 *   SAKANA_API_KEY=... fugu-mcp
 *   claude mcp add fugu -- fugu-mcp        # (or node integrations/mcp/src/bin.ts)
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, FuguClient } from "../../../src/index.ts";
import { createFuguMcpServer } from "./server.ts";

async function main(): Promise<void> {
  const client = new FuguClient(loadConfig());
  const server = createFuguMcpServer(client);
  await server.connect(new StdioServerTransport());
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
