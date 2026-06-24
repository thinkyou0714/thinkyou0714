# fugu-mcp

MCP server exposing **Sakana Fugu** as tools for Claude Code / Cursor / Codex — call
Fugu's frontier-model pool as a sub-agent (a "second opinion" / hard-reasoning escalation).

## Tools

- `fugu_respond` — ask Fugu (Responses API); args `input`, `model` (`fugu`/`fugu-ultra`), `effort` (`high`/`xhigh`/`max`).
- `fugu_chat` — multi-turn chat (Chat Completions).
- `fugu_list_models` — list model ids.

## Run

```bash
npm install                                  # @modelcontextprotocol/sdk + zod
SAKANA_API_KEY=... npm start                 # stdio server (Node >= 22.18)
```

## Register with Claude Code

```bash
claude mcp add fugu -- node /abs/path/integrations/mcp/src/bin.ts
# or, once published/built:  claude mcp add fugu -- fugu-mcp
```

…or add to `.mcp.json`:

```json
{ "mcpServers": { "fugu": { "command": "node", "args": ["integrations/mcp/src/bin.ts"], "env": { "SAKANA_API_KEY": "..." } } } }
```

The tool **logic** lives in `src/handlers.ts` (no SDK import) and is unit-tested from the
core test suite (`fugu-poc/test/mcp.test.ts`); `src/server.ts` is the thin SDK wiring.
