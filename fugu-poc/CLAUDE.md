# CLAUDE.md — guide for AI coding agents

Zero-dependency TypeScript **client + CLI** for the **Sakana Fugu** OpenAI-compatible
API. Keep changes consistent with these invariants.

## Run / verify

```bash
npm test            # node:test, mocked fetch, fully offline
npm run typecheck   # tsc --noEmit
npm run build       # tsdown -> dist (ESM + .d.ts)
npm run check:exports  # publint + are-the-types-wrong (esm-only profile)
```

Run `npm test`, `npm run typecheck`, and `npm run build` before declaring a change done.

## Hard invariants

- **Zero runtime dependencies.** Dev deps OK. `openai` is an *optional peer* used
  only by `src/openai.ts` (loaded via a non-literal dynamic import).
- **ESM-only**, **Node >= 22.9**.
- **Erasable TypeScript only** — the source runs via `node --experimental-strip-types`,
  so NO enums, namespaces, parameter properties, or `import =`. Relative imports use
  explicit `.ts` extensions. `tsconfig` enforces `erasableSyntaxOnly`.
- **Secrets:** never log or store the raw API key or the raw HTTP response body.
  Redact through `redact` / `redactString` (`src/redact.ts`). Errors keep only
  whitelisted, redacted fields — never the raw body.
- Public API = the curated **`src/index.ts`** barrel. The bin is `fugu` → `dist/cli.mjs`.

## Domain notes

- Models: `fugu` (fast) and `fugu-ultra` (max quality). `reasoning.effort` ∈
  `{ high, xhigh, max }`, which also scales the default request timeout.
- Fugu bills **hidden orchestration tokens** (`usage.*_details.orchestration_*`),
  surfaced on `FuguUsage` and included in `computeCost`.
- Prefer the **Responses** API (`respond`) over Chat Completions for generation.

## Layout

`src/`: `config.ts` · `errors.ts` · `redact.ts` · `types.ts` · `pricing.ts` ·
`fugu-client.ts` · `retry.ts` · `budget.ts` · `routing.ts` · `stream.ts` · `tools.ts` ·
`json.ts` · `observe.ts` · `conversation.ts` · `cache.ts` · `pool.ts` · `cascade.ts` ·
`evals.ts` · `router.ts` · `proxy.ts` · `cli.ts` · `openai.ts` (adapter) ·
`index.ts` (public barrel).
`test/`: `fugu-client` · `timeout` · `p2`–`p5` · `mcp` · `obsidian` · `strategy`.
`integrations/`: `mcp/` · `obsidian/` · `n8n/` (each its own package). `.claude/` + `.cursor/`
hold the `/fugu` skill + subagent.
