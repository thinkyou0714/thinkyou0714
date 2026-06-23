---
"fugu-poc": minor
---

P3 advanced API & observability: tool / function calling (`tools`, `toolChoice`,
parsed `result.toolCalls`, built-in `web_search`) plus a `runTools` agentic loop;
structured output via `respondJson` with a validate-and-repair loop
(`FuguValidationError`); stateful Responses chaining (`previousResponseId` / `store`
and a `Conversation` helper); and dependency-free observability hooks
(`onRequest` / `onResponse` / `logger`) for wiring pino / OpenTelemetry.
