---
"fugu-poc": minor
---

Live smoke test (`npm run smoke`): a key-gated, one-shot real round-trip against
`api.sakana.ai` that prints a PASS/FAIL banner with latency + usage and, on failure, maps
each typed `FuguError` to a concrete fix (401 → re-copy SAKANA_API_KEY, 403 → plan/model
access, 429 → wait, connection/parse → verify SAKANA_BASE_URL, timeout → raise/retry).
Distinct exit codes (0 pass / 1 failed / 2 not configured) let CI treat a missing key as a
skip. The `diagnose` / `runSmoke` / `formatSmoke` helpers are pure and unit-tested offline.
