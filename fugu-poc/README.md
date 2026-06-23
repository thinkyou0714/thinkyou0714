# fugu-poc

Zero-dependency TypeScript **client + CLI** for the **Sakana Fugu** OpenAI-compatible API.

Fugu is Sakana AI's multi-agent orchestration system exposed as a *single* model behind
one OpenAI-compatible endpoint: you send one request and Fugu decides internally whether
to answer directly or to delegate to and synthesize a team of expert frontier models.

> **Status:** unit-tested offline (mocked `fetch`) + e2e against a local socket stub. A
> live call against `api.sakana.ai` needs a real `SAKANA_API_KEY` — supply one and run the
> CLI to confirm end-to-end.

## Highlights

- **Zero runtime dependencies.** Built-in `fetch`; ESM-only; Node **>= 22.9**.
- **Typed error hierarchy** (`FuguAuthError`, `FuguRateLimitError`, `FuguTimeoutError`, …)
  with `code` / `status` / `requestId` / `retryAfterMs` / `isRetryable`.
- **Secret-safe:** the raw response body is never stored on errors or logged; messages and
  `--json` output are redacted (`Bearer …` / `sk-…` / deny-listed keys).
- **Typed usage + cost**, including Fugu's hidden, billed **orchestration tokens**.
- **Effort-scaled timeouts** (`reasoning.effort` ∈ `high | xhigh | max`) and
  `status` / `incomplete` / `finishReason` surfaced (no silent empty strings).

## Install

```bash
npm install fugu-poc        # core (zero deps)
npm install fugu-poc openai # optional: the ./openai adapter
```

## CLI

```bash
export SAKANA_API_KEY=...    # from https://console.sakana.ai/get-started
npx fugu "Explain Sakana Fugu in one sentence." --usage
npx fugu "Refactor this..." --model fugu-ultra --effort high
echo "summarize this" | npx fugu --chat
npx fugu --help
```

`--usage` prints token usage (incl. orchestration) + estimated cost to stderr; `--json`
prints the (redacted) raw response.

## Programmatic

```ts
import { createClient, loadConfig, FuguRateLimitError } from "fugu-poc";

const client = createClient(loadConfig());
try {
  const r = await client.respond("Give me a haiku about pufferfish.", { reasoningEffort: "high" });
  console.log(r.text);
  console.log(r.usage, r.costUsd); // typed usage + estimated cost
} catch (e) {
  if (e instanceof FuguRateLimitError) await sleep(e.retryAfterMs ?? 1000);
}
```

### Optional OpenAI-SDK adapter

```ts
import { createFuguOpenAI } from "fugu-poc/openai"; // requires `openai` installed
const openai = await createFuguOpenAI();
const res = await openai.responses.create({ model: "fugu-ultra", input: "hi" });
```

## Develop

Source runs directly via `node --experimental-strip-types` — no build needed for dev/tests.

```bash
npm test            # 35 tests, offline (mocked fetch) + real timeout wiring
npm run coverage    # tests + coverage thresholds
npm run typecheck   # tsc --noEmit (erasableSyntaxOnly)
npm run lint        # biome
npm run build       # tsdown -> dist (ESM + .d.ts)
npm run check:exports  # build + publint + are-the-types-wrong (esm-only)
```

## Layout

```
fugu-poc/
├── src/
│   ├── index.ts        # public API barrel (the supported entry point)
│   ├── config.ts       # env loading, defaults, effort-scaled timeout
│   ├── errors.ts       # typed FuguError hierarchy + HTTP→error mapping
│   ├── redact.ts       # secret redaction
│   ├── types.ts        # FuguResult / FuguUsage + tolerant parsers
│   ├── pricing.ts      # price table + cost estimation
│   ├── fugu-client.ts  # FuguClient: respond() / chat()
│   ├── cli.ts          # CLI (bin: fugu)
│   └── openai.ts       # optional ./openai adapter
├── test/               # fugu-client.test.ts, timeout.test.ts
├── .github/workflows/  # ci / release (changesets + npm OIDC) / codeql (templates)
└── tsdown.config.ts · biome.json · .changeset · tsconfig.json
```

## Publishing

Releases use [Changesets](https://github.com/changesets/changesets) + npm **Trusted
Publishing** (OIDC, no long-lived token, automatic provenance). Add a changeset per
user-facing change with `npm run changeset`. See `.github/workflows/release.yml`.

## Move into its own repository

This folder is self-contained (intended home: `thinkyou0714/fugu`). The CI workflows under
`.github/` activate once it is a repository root.

```bash
cd fugu-poc && git init && git add -A && git commit -m "init: fugu"
git remote add origin git@github.com:thinkyou0714/fugu.git && git push -u origin main
```

## API reference (as of 2026-06)

> Compiled from Sakana's site/console and public guides (see Sources); **not** verified
> against a live call in this repo — confirm against your console dashboard.

| Item      | Value                                                              |
|-----------|-------------------------------------------------------------------|
| Base URL  | `https://api.sakana.ai/v1` (copy the exact value from your console) |
| Models    | `fugu` (fast), `fugu-ultra` (max quality)                         |
| Auth      | `Authorization: Bearer $SAKANA_API_KEY`                           |
| Endpoints | `/responses` (recommended), `/chat/completions`, `/models`       |
| Effort    | `reasoning.effort` ∈ `high` / `xhigh` / `max`                    |

Sources: [Sakana Fugu](https://sakana.ai/fugu/) ·
[console](https://console.sakana.ai/get-started) ·
[Apidog guide](https://apidog.com/blog/how-to-use-sakana-fugu-api/)
