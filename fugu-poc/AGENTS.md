# AGENTS.md

See [`CLAUDE.md`](./CLAUDE.md) for the full guide. Key points:

- Zero **runtime** dependencies; ESM-only; Node >= 22.9.
- Source runs via `node --experimental-strip-types` → **erasable TypeScript only**
  (no enums/namespaces/parameter-properties/`import =`); relative imports use `.ts`
  extensions.
- **Never** log/store the raw API key or raw response body — redact at the boundary
  (`src/redact.ts`).
- Public API is `src/index.ts`. Bin `fugu` → `dist/cli.mjs`.
- Before done: `npm test` · `npm run typecheck` · `npm run build`.
- Models `fugu` / `fugu-ultra`; `reasoning.effort` ∈ {high, xhigh, max}.
