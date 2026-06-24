---
"fugu-poc": minor
---

P4 ecosystem (router + proxy): a multi-provider `FuguRouter` that fails over across
OpenAI-compatible providers (Fugu primary → backups) on transient/auth errors, and a
zero-dependency OpenAI-compatible HTTP `createProxyServer` (+ `fugu-proxy` bin)
exposing `/v1/models`, `/v1/chat/completions`, and `/v1/responses` (with SSE
streaming) so Cursor / n8n / any OpenAI-SDK tool can target Fugu at a localhost
endpoint, optionally behind a local token.
