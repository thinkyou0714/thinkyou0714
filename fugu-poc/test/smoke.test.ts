import { test } from "node:test";
import assert from "node:assert/strict";

import { diagnose, runSmoke, formatSmoke, main, SMOKE_EXIT, type SmokeResponder } from "../examples/smoke.ts";
import {
  FuguAuthError,
  FuguPermissionError,
  FuguRateLimitError,
  FuguBadRequestError,
  FuguConnectionError,
  FuguTimeoutError,
  FuguParseError,
  FuguAPIError,
  FuguIncompleteError,
  FuguAbortError,
  FuguBudgetError,
} from "../src/errors.ts";
import type { FuguResult } from "../src/types.ts";

function result(text: string, extra: Partial<FuguResult> = {}): FuguResult {
  return { text, raw: {}, model: "fugu-ultra", status: "completed", usage: {}, ...extra };
}

function thrower(err: unknown): SmokeResponder {
  return {
    respond: async () => {
      throw err;
    },
  };
}

const BASE = { baseUrl: "https://api.sakana.ai/v1", model: "fugu-ultra" };

// --- diagnose: every typed error maps to an actionable, on-topic hint ---

test("diagnose maps auth -> re-copy SAKANA_API_KEY", () => {
  const d = diagnose(new FuguAuthError("Fugu API error 401", { status: 401 }));
  assert.equal(d.code, "auth");
  assert.match(d.hint, /SAKANA_API_KEY/);
});

test("diagnose maps permission -> plan/access guidance", () => {
  const d = diagnose(new FuguPermissionError("Fugu API error 403", { status: 403 }));
  assert.equal(d.code, "permission");
  assert.match(d.hint, /plan|access/i);
});

test("diagnose maps rate_limit -> wait/retry", () => {
  const d = diagnose(new FuguRateLimitError("Fugu API error 429", { status: 429 }));
  assert.equal(d.code, "rate_limit");
  assert.match(d.hint, /retry/i);
});

test("diagnose maps a 404 bad_request -> check model id / base URL", () => {
  const d = diagnose(new FuguBadRequestError("Fugu API error 404", { status: 404 }));
  assert.equal(d.code, "bad_request");
  assert.match(d.hint, /model id|SAKANA_BASE_URL/);
});

test("diagnose maps connection -> verify SAKANA_BASE_URL", () => {
  const d = diagnose(new FuguConnectionError("Request to /responses failed: getaddrinfo ENOTFOUND"));
  assert.equal(d.code, "connection");
  assert.match(d.hint, /SAKANA_BASE_URL/);
});

test("diagnose maps timeout -> raise timeout / wrong host", () => {
  const d = diagnose(new FuguTimeoutError("Request to /responses timed out after 600000ms."));
  assert.equal(d.code, "timeout");
  assert.match(d.hint, /timeout|minutes/i);
});

test("diagnose maps parse -> base URL points at non-Fugu endpoint", () => {
  const d = diagnose(new FuguParseError("Failed to parse Fugu response as JSON (/responses)."));
  assert.equal(d.code, "parse");
  assert.match(d.hint, /SAKANA_BASE_URL/);
});

test("diagnose maps a 5xx api error -> transient, retry", () => {
  const d = diagnose(new FuguAPIError("Fugu API error 503", { status: 503 }));
  assert.equal(d.code, "api");
  assert.match(d.hint, /retry/i);
});

test("diagnose maps a thrown incomplete -> raise output token cap", () => {
  const d = diagnose(new FuguIncompleteError("Fugu response incomplete: max_output_tokens"));
  assert.equal(d.code, "incomplete");
  assert.match(d.hint, /token|truncat|simplif/i);
});

test("diagnose maps aborted -> cancelled via AbortSignal", () => {
  const d = diagnose(new FuguAbortError("Request aborted by caller."));
  assert.equal(d.code, "aborted");
  assert.match(d.hint, /abort|cancel/i);
});

test("diagnose maps budget -> spend cap hit", () => {
  const d = diagnose(new FuguBudgetError("Budget exceeded"));
  assert.equal(d.code, "budget");
  assert.match(d.hint, /budget|cap/i);
});

test("diagnose handles a non-FuguError as 'unknown'", () => {
  const d = diagnose(new Error("boom"));
  assert.equal(d.code, "unknown");
});

// --- runSmoke: structured, never-throwing report ---

test("runSmoke reports PASS on a non-empty reply, with usage + latency", async () => {
  const client: SmokeResponder = {
    respond: async () =>
      result("pong", { usage: { inputTokens: 5, outputTokens: 1 }, costUsd: 0.0001, requestId: "req_1" }),
  };
  const report = await runSmoke(client, BASE);
  assert.equal(report.ok, true);
  assert.equal(report.snippet, "pong");
  assert.equal(report.inputTokens, 5);
  assert.equal(report.requestId, "req_1");
  assert.ok(report.latencyMs >= 0);
});

test("runSmoke reports FAIL with a hint when the reply is empty", async () => {
  const client: SmokeResponder = { respond: async () => result("   ") };
  const report = await runSmoke(client, BASE);
  assert.equal(report.ok, false);
  assert.match(report.hint ?? "", /empty/i);
});

test("runSmoke flags an incomplete-but-non-empty reply as PASS with a note", async () => {
  const client: SmokeResponder = { respond: async () => result("partial", { status: "incomplete" }) };
  const report = await runSmoke(client, BASE);
  assert.equal(report.ok, true);
  assert.equal(report.status, "incomplete");
  assert.match(report.hint ?? "", /incomplete|truncated/i);
});

test("runSmoke converts a thrown FuguError into a FAIL report (no throw)", async () => {
  const report = await runSmoke(
    thrower(new FuguAuthError("Fugu API error 401", { status: 401, requestId: "r9" })),
    BASE,
  );
  assert.equal(report.ok, false);
  assert.equal(report.errorCode, "auth");
  assert.equal(report.status, "401");
  assert.equal(report.requestId, "r9");
  assert.match(report.hint ?? "", /SAKANA_API_KEY/);
});

// --- formatSmoke: banner content ---

test("formatSmoke renders a PASS banner with endpoint, model and reply", async () => {
  const report = await runSmoke({ respond: async () => result("pong") }, BASE);
  const text = formatSmoke(report);
  assert.match(text, /PASS/);
  assert.match(text, /api\.sakana\.ai/);
  assert.match(text, /fugu-ultra/);
  assert.match(text, /pong/);
});

test("formatSmoke renders a FAIL banner with the error code and a fix line", () => {
  const text = formatSmoke({
    ok: false,
    baseUrl: BASE.baseUrl,
    model: BASE.model,
    latencyMs: 3,
    errorCode: "auth",
    status: "401",
    errorMessage: "Fugu API error 401",
    hint: "set SAKANA_API_KEY",
  });
  assert.match(text, /FAIL/);
  assert.match(text, /\[auth 401\]/);
  assert.match(text, /fix\s+:/);
});

// --- main: key-gated exit code ---

test("main returns notConfigured (2) and prints help when SAKANA_API_KEY is unset", async () => {
  const saved = process.env.SAKANA_API_KEY;
  const originalWrite = process.stderr.write.bind(process.stderr);
  let captured = "";
  process.env.SAKANA_API_KEY = "";
  // biome-ignore lint/suspicious/noExplicitAny: minimal stderr capture for the test
  process.stderr.write = ((chunk: any) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await main([]);
    assert.equal(code, SMOKE_EXIT.notConfigured);
    assert.match(captured, /NOT CONFIGURED/);
    assert.match(captured, /console\.sakana\.ai/);
  } finally {
    process.stderr.write = originalWrite;
    if (saved === undefined) delete process.env.SAKANA_API_KEY;
    else process.env.SAKANA_API_KEY = saved;
  }
});
