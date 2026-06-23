# fugu-poc

Minimal proof-of-concept client for the **Sakana Fugu** OpenAI-compatible API.

Fugu is Sakana AI's multi-agent orchestration system exposed as a *single* model
behind one OpenAI-compatible endpoint: you send one request and Fugu decides
internally whether to answer directly or to delegate to and synthesize a team of
expert frontier models. This PoC just proves connectivity and basic round-trips
against that endpoint (Responses API + Chat Completions API).

> **Status:** verified offline (unit tests run green with a mocked `fetch`). A
> live call against `api.sakana.ai` has **not** been exercised here because it
> needs a real `SAKANA_API_KEY` — supply one and run the CLI to confirm end-to-end.

## Requirements

- **Node.js >= 22.9** — that's it. **Zero runtime npm dependencies.**
  - Uses the built-in global `fetch`, the built-in test runner (`node:test`), and
    runs TypeScript directly via native type-stripping (`--experimental-strip-types`).

## Setup

```bash
cp .env.example .env
# then edit .env and set SAKANA_API_KEY (get one at https://console.sakana.ai/get-started)
```

## Usage (CLI)

```bash
# Responses API (default, recommended for generation)
npm start -- "Explain what Sakana Fugu is in one sentence."

# pick a model
npm start -- "Refactor this function..." --model fugu-ultra

# Chat Completions API instead of Responses
npm start -- "hello" --chat

# print the raw JSON response
npm start -- "hello" --json

# pipe a prompt via stdin
echo "summarize this" | npm start

# help
npm start -- --help
```

Without `npm`:

```bash
node --env-file-if-exists=.env --experimental-strip-types src/cli.ts "your prompt"
```

## Usage (programmatic)

```ts
import { loadConfig } from "./src/config.ts";
import { createClient } from "./src/fugu-client.ts";

const client = createClient(loadConfig());

const r = await client.respond("Give me a haiku about pufferfish.");
console.log(r.text);   // model output
console.log(r.usage);  // token usage, if returned
```

### Prefer the official OpenAI SDK?

Because the endpoint is OpenAI-compatible, you can drop in the `openai` package
and just point it at Fugu — no client code required:

```ts
import OpenAI from "openai"; // npm i openai
const client = new OpenAI({
  baseURL: "https://api.sakana.ai/v1",
  apiKey: process.env.SAKANA_API_KEY,
});
const res = await client.responses.create({ model: "fugu-ultra", input: "hi" });
```

This PoC deliberately avoids that dependency so it runs anywhere with zero install.

## Testing

```bash
npm test
```

Tests mock `fetch`, so they run fully offline and assert: request URL / method /
auth header / body shape, response parsing for both APIs, the missing-key error
path, non-2xx error handling, base-URL normalization, config defaults, and CLI
argument parsing.

## Type-checking (optional)

Running and testing need **no** dependencies. The optional `npm run typecheck`
uses TypeScript + Node types, declared as dev-only dependencies:

```bash
npm install        # installs typescript + @types/node (dev only)
npm run typecheck
```

## Project layout

```
fugu-poc/
├── src/
│   ├── config.ts        # env loading + defaults (base URL, model)
│   ├── fugu-client.ts   # FuguClient: respond() + chat(), error handling
│   └── cli.ts           # CLI entry + arg parsing
├── test/
│   └── fugu-client.test.ts
├── .env.example
├── package.json
└── tsconfig.json        # for editors / optional `npm run typecheck`
```

## Move this into its own repository

This folder is self-contained. To lift it into a dedicated repo:

```bash
cd fugu-poc
git init && git add -A && git commit -m "init: Fugu PoC"
# then create an empty repo on GitHub and:
git remote add origin git@github.com:<you>/fugu-poc.git
git push -u origin main
```

## API reference (as of 2026-06)

> Compiled from Sakana's site/console and public guides (see Sources). The model
> ids, endpoints, and base URL below have **not** been verified against a live
> call in this repo — confirm them against your console dashboard.

| Item        | Value                                                            |
|-------------|-----------------------------------------------------------------|
| Base URL    | `https://api.sakana.ai/v1` (copy the exact value from your console dashboard) |
| Models      | `fugu` (fast), `fugu-ultra` (max quality)                       |
| Auth        | `Authorization: Bearer $SAKANA_API_KEY`                         |
| Endpoints   | `/responses` (recommended), `/chat/completions`, `/models`     |
| API key     | https://console.sakana.ai/get-started                           |

Sources:
- Sakana Fugu — https://sakana.ai/fugu/
- Get started (console) — https://console.sakana.ai/get-started
- Models — https://console.sakana.ai/models
- Apidog: How to use the Sakana Fugu API — https://apidog.com/blog/how-to-use-sakana-fugu-api/
