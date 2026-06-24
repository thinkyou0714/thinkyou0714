# fugu-poc

Zero-dependency TypeScript **client + CLI** for the **Sakana Fugu** OpenAI-compatible API.

Fugu is Sakana AI's multi-agent orchestration system exposed as a *single* model behind
one OpenAI-compatible endpoint: you send one request and Fugu decides internally whether
to answer directly or to delegate to and synthesize a team of expert frontier models.

> **Status:** unit-tested offline (mocked `fetch`) + e2e against a local socket stub. A
> live call against `api.sakana.ai` needs a real `SAKANA_API_KEY` — supply one and run
> `npm run smoke` to confirm end-to-end.

## Highlights

- **Zero runtime dependencies.** Built-in `fetch`; ESM-only; Node **>= 22.9**.
- **Typed error hierarchy** (`FuguAuthError`, `FuguRateLimitError`, `FuguTimeoutError`, …)
  with `code` / `status` / `requestId` / `retryAfterMs` / `isRetryable`.
- **Secret-safe:** the raw response body is never stored on errors or logged; messages and
  `--json` output are redacted (`Bearer …` / `sk-…` / deny-listed keys).
- **Typed usage + cost**, including Fugu's hidden, billed **orchestration tokens**.
- **Effort-scaled timeouts** (`reasoning.effort` ∈ `high | xhigh | max`) and
  `status` / `incomplete` / `finishReason` surfaced (no silent empty strings).
- **Resilient transport:** retries with exponential backoff + jitter honoring
  `Retry-After`, a stable `Idempotency-Key` across retries, timeout/abort/network
  classification.
- **Streaming** (`respondStream` / `chatStream`) over SSE — zero-dep.
- **Cost controls:** a `BudgetGuard` spend circuit-breaker, output-token + input-size
  caps, `chooseModel()` routing (`fugu` ↔ `fugu-ultra`), and an opt-in request **cache**
  (`MemoryCache`, LRU+TTL) — identical calls skip the network *and* the budget charge.
- **Strategy patterns:** a confidence-gated **`Cascade`** (cheap model → judge → escalate),
  an **eval harness** (`runEval` + neutral `llmGrader`) to measure quality/cost/latency, and
  concurrency primitives (`WorkPool` with priority lanes, `SingleFlight` de-dup) for bulk runs.
- **Tool calling** (`tools` + `runTools` agentic loop, built-in `web_search`),
  **structured output** (`respondJson` with validate-and-repair), stateful
  **`Conversation`** chaining, and **observability hooks** (`onRequest` / `onResponse` /
  `logger` — wire pino/OpenTelemetry; the core stays dependency-free).
- **Ecosystem:** a multi-provider **`FuguRouter`** (failover) and an OpenAI-compatible
  **proxy** (`createProxyServer` / `fugu-proxy` bin) so Cursor / n8n / any OpenAI-SDK
  tool can target Fugu — with failover — at a `localhost` endpoint; a **Fugu MCP
  server** (`integrations/mcp/`, `fugu_respond` / `fugu_chat`) for Claude Code / Cursor / Codex;
  a zero-dep **`fugu-obsidian`** CLI (`integrations/obsidian/`) that answers questions
  about your Obsidian notes via the Local REST API; an **n8n community node**
  (`integrations/n8n/`) — a declarative `Fugu` node + `Fugu API` credential; and a
  Claude Code **`/fugu` skill + `fugu` subagent** (`.claude/`, mirrored as a Cursor command)
  that routes "second opinion" / adversarial-review asks to the MCP server.

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

## Verify your setup (live)

Once you have a key, confirm a real round-trip works:

```bash
export SAKANA_API_KEY=...    # or: cp .env.example .env && edit
npm run smoke                # one minimal call to api.sakana.ai
```

It prints a `PASS`/`FAIL` banner with latency + token usage. On failure it maps the error
to a concrete fix (401 → re-copy the key, 403 → plan/model access, 429 → wait,
connection/parse → check `SAKANA_BASE_URL`, timeout → raise/retry). Exit codes: `0` pass,
`1` reached the API but failed, `2` not configured (no key) — so CI can skip cleanly.

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

### Streaming + budget + routing

```ts
import { createClient, loadConfig, BudgetGuard, chooseModel } from "fugu-poc";

const client = createClient(loadConfig(), { budget: new BudgetGuard({ limitUsd: 5 }) });
const model = chooseModel({ chars: prompt.length, task: "code" }); // fugu ↔ fugu-ultra

for await (const ev of client.respondStream(prompt, { model })) {
  if (ev.type === "delta") process.stdout.write(ev.textDelta ?? "");
  else console.log("\n", ev.result?.costUsd, ev.result?.usage);
}
```

### Tools, structured output, observability

```ts
import { createClient, loadConfig, functionTool, webSearchTool } from "fugu-poc";

const client = createClient(loadConfig(), { onResponse: (e) => metrics.record(e) });

// agentic tool loop
const res = await client.runTools([{ role: "user", content: "weather in Tokyo?" }], {
  tools: [functionTool("getWeather", { parameters: { type: "object", properties: { city: { type: "string" } } } }), webSearchTool()],
  handlers: { getWeather: async (args) => fetchWeather((args as { city: string }).city) },
});

// structured output with validate-and-repair
const { data } = await client.respondJson<{ score: number }>("Rate this 1-10", {
  schema: { type: "object", properties: { score: { type: "number" } }, required: ["score"] },
  validate: (v) => {
    const o = v as { score?: unknown };
    if (typeof o.score !== "number") throw new Error("score must be a number");
    return o as { score: number };
  },
});
```

### Cache, confidence cascade & evals

```ts
import { createClient, loadConfig, MemoryCache, Cascade, llmJudge, runEval, llmGrader } from "fugu-poc";

// opt-in cache: identical requests are free (no network, no budget charge)
const cache = new MemoryCache({ maxEntries: 1000, ttlMs: 60 * 60_000 });
const client = createClient(loadConfig(), { cache });

// confidence cascade: try fugu, escalate to fugu-ultra only when the judge isn't sure
const cascade = new Cascade(client, {
  stages: [{ model: "fugu" }, { model: "fugu-ultra", effort: "high" }],
  judge: llmJudge(client, { threshold: 0.7 }), // or the zero-cost default `statusJudge`
});
const { result, stageIndex, escalations } = await cascade.run("A hard question…");

// evals: measure quality/cost/latency over a golden set (neutral judge ≠ system under test)
const report = await runEval(client, goldenSet, { grader: llmGrader(judgeClient), concurrency: 4 });
console.log(report.passRate, report.totalCostUsd, report.avgLatencyMs);
```

### Router + proxy (use Fugu from any OpenAI-SDK tool, with failover)

```ts
import { FuguClient, FuguRouter, createProxyServer, loadConfig } from "fugu-poc";

const router = new FuguRouter({
  providers: [
    { name: "fugu", client: new FuguClient(loadConfig()), model: "fugu-ultra" },
    { name: "backup", client: new FuguClient({ ...loadConfig(), baseUrl: "https://backup/v1" }) },
  ],
});

// one localhost OpenAI endpoint any tool (Cursor, n8n, scripts) can target:
createProxyServer({ backend: router, token: "local-secret" }).listen(4141);
// or just run the bin:  npx fugu-proxy   ->   http://localhost:4141/v1
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
npm test            # 157 tests, offline (mocked fetch) + real timeout wiring
npm run smoke       # live: one real round-trip to api.sakana.ai (needs SAKANA_API_KEY)
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
│   ├── fugu-client.ts  # FuguClient: respond() / chat() / *Stream()
│   ├── retry.ts        # backoff + jitter + Retry-After
│   ├── budget.ts       # BudgetGuard spend circuit-breaker
│   ├── routing.ts      # chooseModel() policy
│   ├── stream.ts       # SSE parsing
│   ├── tools.ts        # tool-calling types + parsing
│   ├── json.ts         # loose JSON extraction (structured output)
│   ├── observe.ts      # logging / metrics hooks
│   ├── conversation.ts # stateful Responses chaining
│   ├── cache.ts        # request cache (MemoryCache LRU+TTL; RequestCache)
│   ├── pool.ts         # WorkPool (bounded concurrency) + SingleFlight
│   ├── cascade.ts      # confidence-gated model cascade + judges
│   ├── evals.ts        # golden-set eval harness + graders
│   ├── router.ts       # multi-provider failover (FuguRouter)
│   ├── proxy.ts        # OpenAI-compatible proxy (bin: fugu-proxy)
│   ├── cli.ts          # CLI (bin: fugu)
│   └── openai.ts       # optional ./openai adapter
├── test/               # client / timeout / p2-p5 / mcp / obsidian / strategy tests
├── integrations/
│   ├── mcp/            # Fugu MCP server (own package; @modelcontextprotocol/sdk + zod)
│   ├── obsidian/       # fugu-obsidian CLI (own package; zero-dep, Local REST API)
│   └── n8n/            # n8n-nodes-fugu (own package; declarative node + credential)
├── .claude/           # /fugu skill + fugu subagent (delegate to the MCP server)
├── .cursor/           # mirrored Cursor command
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
