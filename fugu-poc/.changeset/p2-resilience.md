---
"fugu-poc": minor
---

P2 resilience & cost control: automatic retries (exponential backoff + full jitter,
honoring `Retry-After`) with a stable `Idempotency-Key`, SSE streaming
(`respondStream` / `chatStream`), a `BudgetGuard` spend circuit-breaker, output-token
and input-size caps, and a `chooseModel()` routing policy (`fugu` ↔ `fugu-ultra`).
