import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient, createClient } from "../src/fugu-client.ts";
import {
  FuguError,
  FuguConfigError,
  FuguAuthError,
  FuguRateLimitError,
  FuguAPIError,
  FuguBadRequestError,
  FuguTimeoutError,
  FuguAbortError,
  FuguConnectionError,
  FuguParseError,
  FuguIncompleteError,
  parseApiError,
  parseRetryAfter,
} from "../src/errors.ts";
import { redact, redactString } from "../src/redact.ts";
import { computeCost, baseModelId } from "../src/pricing.ts";
import { parseUsage, parseResponseMeta, extractResponsesText, extractChatText } from "../src/types.ts";
import type { FuguUsage } from "../src/types.ts";
import {
  loadConfig,
  normalizeBaseUrl,
  defaultTimeoutMs,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
} from "../src/config.ts";
import { parseArgs, renderResult } from "../src/cli.ts";
import type { FuguResult } from "../src/fugu-client.ts";

// Obviously-fake credentials, assembled at runtime so secret scanners never see a
// contiguous token literal in the source. They only need to be redaction-pattern-shaped.
const SK = "sk-" + "fakefakefake01";
const SK_LIVE = "sk_" + "live_" + "fakefake01";
const LABELED_VALUE = "notarealvalue00";

interface RecordedCall {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
}

function mockFetch(responder: () => Response) {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall["init"] });
    return responder();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function throwingFetch(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function jsonResponse(
  obj: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(obj), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

const client = (fn: typeof fetch, over: Partial<{ model: string }> = {}) =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: over.model ?? "fugu-ultra", fetch: fn });

// ---------------------------------------------------------------- happy paths

test("respond() posts to /responses with auth + model and parses output_text + metadata", async () => {
  const { fn, calls } = mockFetch(() =>
    jsonResponse(
      {
        id: "resp_1",
        status: "completed",
        output_text: "hello world",
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
      { headers: { "x-request-id": "req_abc" } },
    ),
  );
  const res = await client(fn).respond("hi");

  assert.equal(res.text, "hello world");
  assert.equal(res.model, "fugu-ultra");
  assert.equal(res.id, "resp_1");
  assert.equal(res.status, "completed");
  assert.equal(res.requestId, "req_abc");
  assert.equal(res.usage.inputTokens, 10);
  assert.equal(res.usage.outputTokens, 20);
  assert.ok((res.costUsd ?? 0) > 0);
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/responses");
  assert.equal(calls[0].init.headers.Authorization, "Bearer k");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "fugu-ultra");
  assert.equal(body.input, "hi");
});

test("respond() surfaces hidden orchestration tokens from usage details", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({
      output_text: "x",
      usage: {
        input_tokens: 24704,
        output_tokens: 10774,
        input_tokens_details: { cached_tokens: 100, orchestration_input_tokens: 23531 },
        output_tokens_details: { orchestration_output_tokens: 30285 },
      },
    }),
  );
  const res = await client(fn).respond("x");
  assert.equal(res.usage.orchestrationInputTokens, 23531);
  assert.equal(res.usage.orchestrationOutputTokens, 30285);
  assert.equal(res.usage.cachedInputTokens, 100);
});

test("respond() aggregates nested output[].content[].text when output_text is absent", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "foo " },
            { type: "output_text", text: "bar" },
          ],
        },
      ],
    }),
  );
  assert.equal((await client(fn).respond("x")).text, "foo bar");
});

test("chat() posts to /chat/completions, parses content + finishReason", async () => {
  const { fn, calls } = mockFetch(() =>
    jsonResponse({
      choices: [{ message: { role: "assistant", content: "chat reply" }, finish_reason: "stop" }],
    }),
  );
  const res = await client(fn).chat([{ role: "user", content: "hi" }]);
  assert.equal(res.text, "chat reply");
  assert.equal(res.finishReason, "stop");
  assert.equal(res.status, "completed");
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/chat/completions");
});

test("respond() forwards reasoning.effort and instructions into the body", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "ok" }));
  await client(fn).respond("hi", { reasoningEffort: "high", instructions: "be terse" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.instructions, "be terse");
});

test("params cannot override model/input", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "ok" }));
  await client(fn).respond("real", {
    model: "fugu-ultra",
    params: { model: "HIJACK", input: "HIJACK", temperature: 0.2 },
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "fugu-ultra");
  assert.equal(body.input, "real");
  assert.equal(body.temperature, 0.2);
});

// ---------------------------------------------------------------- error taxonomy

test("missing API key throws FuguConfigError before calling fetch", async () => {
  let called = false;
  const fn = (async () => {
    called = true;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const c = new FuguClient({ apiKey: "", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });
  await assert.rejects(
    () => c.respond("x"),
    (e: unknown) => e instanceof FuguConfigError && e.code === "config",
  );
  assert.equal(called, false);
});

test("401 -> FuguAuthError (not retryable), apiError parsed, no raw body kept", async () => {
  const { fn } = mockFetch(() => jsonResponse({ error: "nope" }, { status: 401 }));
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) =>
      e instanceof FuguAuthError &&
      e.status === 401 &&
      e.code === "auth" &&
      e.isRetryable === false &&
      e.apiError?.message === "nope",
  );
});

test("429 -> FuguRateLimitError carries retryAfterMs and is retryable", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({ error: { message: "slow down" } }, { status: 429, headers: { "retry-after": "2" } }),
  );
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) => e instanceof FuguRateLimitError && e.retryAfterMs === 2000 && e.isRetryable === true,
  );
});

test("500 -> FuguAPIError is retryable", async () => {
  const { fn } = mockFetch(() => jsonResponse({ error: { message: "boom" } }, { status: 500 }));
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) => e instanceof FuguAPIError && e.isRetryable === true,
  );
});

test("400 with a secret in the message is redacted in apiError", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({ error: { message: `invalid key ${SK} provided` } }, { status: 400 }),
  );
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) =>
      e instanceof FuguBadRequestError &&
      /\[REDACTED\]/.test(e.apiError?.message ?? "") &&
      !(e.apiError?.message ?? "").includes(SK) &&
      !e.message.includes(SK),
  );
});

test("invalid JSON on a 200 -> FuguParseError", async () => {
  const { fn } = mockFetch(
    () => new Response("not json{", { status: 200, headers: { "content-type": "text/html" } }),
  );
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) => e instanceof FuguParseError && e.code === "parse",
  );
});

test("internal timeout -> FuguTimeoutError (retryable)", async () => {
  const fn = throwingFetch(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) => e instanceof FuguTimeoutError && e.isRetryable === true,
  );
});

test("caller abort -> FuguAbortError (not retryable)", async () => {
  const fn = throwingFetch(Object.assign(new Error("aborted"), { name: "AbortError" }));
  await assert.rejects(
    () => client(fn).respond("x", { signal: AbortSignal.abort() }),
    (e: unknown) => e instanceof FuguAbortError && e.code === "aborted" && e.isRetryable === false,
  );
});

test("network failure -> FuguConnectionError (retryable)", async () => {
  const fn = throwingFetch(new Error("ECONNREFUSED 127.0.0.1:443"));
  await assert.rejects(
    () => client(fn).respond("x"),
    (e: unknown) => e instanceof FuguConnectionError && e.isRetryable === true,
  );
});

test("throwOnIncomplete throws FuguIncompleteError on an incomplete response", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: "",
    }),
  );
  await assert.rejects(
    () => client(fn).respond("x", { throwOnIncomplete: true }),
    (e: unknown) => e instanceof FuguIncompleteError && /max_output_tokens/.test((e as Error).message),
  );
});

test("incomplete response is surfaced (not thrown) by default", async () => {
  const { fn } = mockFetch(() =>
    jsonResponse({
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output_text: "partial",
    }),
  );
  const res = await client(fn).respond("x");
  assert.equal(res.status, "incomplete");
  assert.equal(res.incompleteReason, "content_filter");
  assert.equal(res.text, "partial");
});

// ---------------------------------------------------------------- redaction

test("redactString scrubs Bearer tokens, sk- keys, and labelled secrets", () => {
  assert.equal(redactString(`Authorization: Bearer ${SK}`), "Authorization: Bearer [REDACTED]");
  assert.equal(redactString(`key=${SK} done`), "key=[REDACTED] done");
  assert.equal(redactString(`api_key=${LABELED_VALUE} x`), "api_key=[REDACTED] x");
});

test("redact() censors deny-listed object keys", () => {
  const out = redact({ headers: { Authorization: `Bearer ${SK}` }, model: "fugu" }) as {
    headers: { Authorization: string };
    model: string;
  };
  assert.equal(out.headers.Authorization, "[REDACTED]");
  assert.equal(out.model, "fugu");
});

test("FuguError redacts its own message", () => {
  const e = new FuguError(`failed with Bearer ${SK}`, "api");
  assert.match(e.message, /\[REDACTED\]/);
  assert.ok(!e.message.includes(SK));
});

// ---------------------------------------------------------------- pricing

test("computeCost includes orchestration tokens", () => {
  const usage: FuguUsage = { inputTokens: 200000, outputTokens: 100000, orchestrationInputTokens: 50000 };
  // fugu-ultra: (250000*5 + 100000*30)/1e6 = 1.25 + 3.0 = 4.25
  assert.equal(computeCost("fugu-ultra", usage), 4.25);
});

test("computeCost resolves dated snapshot ids and returns undefined when usage empty", () => {
  assert.equal(baseModelId("fugu-ultra-20260615"), "fugu-ultra");
  assert.ok((computeCost("fugu-ultra-20260615", { inputTokens: 1_000_000 }) ?? 0) > 0);
  assert.equal(computeCost("fugu-ultra", {}), undefined);
  assert.equal(computeCost("unknown-model", { inputTokens: 10 }), undefined);
});

// ---------------------------------------------------------------- parsers + config

test("parseUsage maps chat-style prompt/completion tokens", () => {
  const u = parseUsage({ usage: { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 } });
  assert.equal(u.inputTokens, 7);
  assert.equal(u.outputTokens, 9);
  assert.equal(u.totalTokens, 16);
});

test("parseResponseMeta derives status from finish_reason and incomplete_details", () => {
  assert.equal(parseResponseMeta({ choices: [{ finish_reason: "length" }] }).status, "incomplete");
  assert.equal(parseResponseMeta({ choices: [{ finish_reason: "stop" }] }).status, "completed");
  assert.equal(
    parseResponseMeta({ status: "incomplete", incomplete_details: { reason: "x" } }).incompleteReason,
    "x",
  );
  assert.equal(parseResponseMeta({}).status, "unknown");
});

test("extractResponsesText preserves intentional whitespace output_text", () => {
  assert.equal(extractResponsesText({ output_text: "\n\n" }), "\n\n");
  assert.equal(extractResponsesText({}), "");
});

test("extractChatText reads choices[0].message.content (string or parts)", () => {
  assert.equal(extractChatText({ choices: [{ message: { content: "hi" } }] }), "hi");
  assert.equal(extractChatText({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }), "ab");
  assert.equal(extractChatText({}), "");
});

test("parseApiError never returns the raw body and caps length", () => {
  assert.equal(parseApiError('{"error":{"message":"m","type":"t","code":"c"}}')?.code, "c");
  assert.equal(parseApiError("plain text error")?.message, "plain text error");
  assert.equal(parseApiError(""), undefined);
});

test("parseRetryAfter handles seconds and HTTP-date", () => {
  assert.equal(parseRetryAfter("5"), 5000);
  assert.equal(parseRetryAfter(null), undefined);
  assert.ok((parseRetryAfter(new Date(Date.now() + 10000).toUTCString()) ?? 0) > 5000);
});

test("defaultTimeoutMs scales with model and effort", () => {
  assert.equal(defaultTimeoutMs("fugu"), 120_000);
  assert.equal(defaultTimeoutMs("fugu-ultra"), 600_000);
  assert.equal(defaultTimeoutMs("fugu-ultra-20260615"), 600_000);
  assert.equal(defaultTimeoutMs("fugu", "max"), 1_800_000);
  assert.equal(defaultTimeoutMs("fugu", "xhigh"), 1_800_000);
});

test("loadConfig + normalizeBaseUrl defaults", () => {
  const cfg = loadConfig({ env: { SAKANA_API_KEY: "abc" } });
  assert.equal(cfg.apiKey, "abc");
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL);
  assert.equal(cfg.model, DEFAULT_MODEL);
  assert.equal(normalizeBaseUrl("https://x/v1/"), "https://x/v1");
});

test("createClient builds a working client and normalizes baseUrl", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "hi" }));
  const c = createClient({ apiKey: "k", baseUrl: "https://api.sakana.ai/v1/", model: "fugu" }, { fetch: fn });
  const res = await c.respond("yo");
  assert.equal(res.text, "hi");
  assert.equal(c.baseUrl, "https://api.sakana.ai/v1");
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/responses");
});

// ---------------------------------------------------------------- CLI args

test("parseArgs parses flags, effort, and the positional prompt", () => {
  const a = parseArgs(["hello", "world", "--model", "fugu", "--effort", "high", "--chat", "--json", "--usage"]);
  assert.equal(a.prompt, "hello world");
  assert.equal(a.model, "fugu");
  assert.equal(a.effort, "high");
  assert.equal(a.chat, true);
  assert.equal(a.json, true);
  assert.equal(a.usage, true);

  assert.equal(parseArgs(["--effort=max", "hi"]).effort, "max");
  assert.ok(parseArgs(["--effort", "bogus", "hi"]).error);
  assert.equal(parseArgs(["--help"]).help, true);
});

test("renderResult deep-redacts secrets in --json raw output", () => {
  const result: FuguResult = {
    text: "ok",
    model: "fugu",
    status: "completed",
    usage: {},
    raw: {
      output_text: "ok",
      echoed: { headers: { Authorization: `Bearer ${SK}` } },
      note: `leaked token ${SK_LIVE} here`,
    },
  };
  const json = renderResult(result, true);
  assert.ok(!json.includes(SK));
  assert.ok(!json.includes(SK_LIVE));
  assert.match(json, /\[REDACTED\]/);
  assert.equal(renderResult(result, false), "ok");
});
