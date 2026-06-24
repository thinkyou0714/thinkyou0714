# Contributing

## Setup

- Node.js **>= 22.9** (the source runs directly via `node --experimental-strip-types`).
- `npm install`

## Workflow

```bash
npm test            # unit + parser + timeout tests (offline, mocked fetch)
npm run coverage    # tests with coverage thresholds
npm run typecheck   # tsc --noEmit
npm run lint        # biome check
npm run build       # tsdown -> dist (ESM + .d.ts)
npm run check:exports  # build + publint + are-the-types-wrong
```

Add a changeset for any user-facing change:

```bash
npm run changeset
```

## Invariants (please preserve)

- **Zero runtime dependencies** (dev dependencies are fine). `openai` is an
  optional peer used only by the `./openai` adapter.
- **ESM-only**, Node >= 22.9.
- Source must use **erasable TypeScript only** (no enums, namespaces, parameter
  properties, `import =`) so `--experimental-strip-types` keeps working; relative
  imports use explicit `.ts` extensions.
- **Never** log or store the raw API key or raw response body — redact at the
  boundary.
- The public API is the curated `src/index.ts` barrel.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/).
