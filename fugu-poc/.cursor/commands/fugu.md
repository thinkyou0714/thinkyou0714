# Fugu: second opinion

Delegate the current task — adversarial review of a plan/diff, a hard reasoning problem, or
a cross-model sanity check — to **Sakana Fugu** via the Fugu MCP server, then summarize the
verdict.

Steps:

1. Gather only the relevant context (the plan text, or the specific files / diff). Keep it
   tight — Fugu bills hidden orchestration tokens, so don't paste the whole repo.
2. Call the Fugu MCP tool:
   - `fugu_respond` with `input` = the framed request, `model` = `fugu` (fast) or
     `fugu-ultra` (max quality), `effort` = `high` / `xhigh` / `max`.
   - For a review, frame it to **refute**: "Find concrete bugs, missed cases, and risks
     (file/line/scenario). If it's sound, say so." Ask for a short, prioritized list.
3. Return a concise synthesis: the verdict, the findings that matter, a recommendation —
   attributed as Fugu's opinion. Surface any disagreement with your own analysis rather than
   deferring automatically.

Requires the Fugu MCP server configured with `SAKANA_API_KEY`
(`claude mcp add fugu -- node integrations/mcp/src/bin.ts`, or the equivalent in Cursor's
MCP settings). If it isn't available, say so instead of guessing.
