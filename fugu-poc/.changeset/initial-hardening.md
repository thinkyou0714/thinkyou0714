---
"fugu-poc": minor
---

P0 + P1 hardening: typed `FuguError` hierarchy with secret redaction (the raw
response body is never stored or logged), typed `usage` + cost estimation
including Fugu's hidden orchestration tokens, effort-scaled request timeouts,
`status`/`incomplete`/`finishReason` surfacing, a curated public API barrel, an
optional `./openai` adapter, and a real ESM build (tsdown) with `exports`/`bin`
validated by publint + are-the-types-wrong.
