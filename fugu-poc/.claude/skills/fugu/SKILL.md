---
name: fugu
description: Get a second opinion from Sakana Fugu's frontier-model pool. Use to adversarially review a plan or diff, crack a hard reasoning problem, or hedge vendor risk by cross-checking an answer against a different model family. Requires the Fugu MCP server.
---

# /fugu — delegate a second opinion to Sakana Fugu

Use this to escalate work to **Sakana Fugu** (a single endpoint that orchestrates a pool of
frontier models) for an independent cross-check. Good fits: adversarial review of a plan or
diff, a genuinely hard reasoning problem, or hedging against a single-vendor blind spot.

## How to run it

1. **Prefer the subagent.** Spawn the `fugu` subagent (`.claude/agents/fugu.md`) so the
   delegation runs in its own context and returns only the verdict:

   > Use the **fugu** subagent to adversarially review `<plan / the current diff>`.

2. **Or call the MCP tools directly** when you just need a one-shot answer:
   - `mcp__fugu__fugu_respond` — `input`, `model` (`fugu` fast / `fugu-ultra` max quality),
     `effort` (`high` / `xhigh` / `max`).
   - `mcp__fugu__fugu_chat` — multi-turn (`messages`).
   - `mcp__fugu__fugu_list_models`.

## Guidance

- **Right-size the call.** Default to `fugu`; reach for `fugu-ultra` + higher `effort` only
  for genuinely hard or high-stakes work — Fugu bills hidden orchestration tokens, so a
  tight prompt with just the relevant context is both cheaper and sharper than dumping files.
- **Frame reviews to refute.** Ask Fugu to find concrete bugs / missed cases / risks with
  specifics (file, line, scenario), and to say so plainly if it's sound.
- **Treat the reply as one opinion.** Surface where Fugu and the main agent disagree instead
  of deferring automatically; the value is the independent perspective.

## Setup

```bash
claude mcp add fugu -- node integrations/mcp/src/bin.ts   # SAKANA_API_KEY must be set
```

If the `mcp__fugu__*` tools aren't available, say the server isn't configured rather than
guessing an answer.
