import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { FuguRateLimitError, FuguBadRequestError, FuguBudgetError, FuguTimeoutError } from "../src/errors.ts";
import { BudgetGuard } from "../src/budget.ts";
import { chooseModel } from "../src/routing.ts";
import { parseSSE } from "../src/stream.ts";
import { fullJitterBackoff, retryDelayMs } from "../src/retry.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";

type RecordedInit = RequestInit & { headers: Record<string, string>; body: string };

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
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

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const ch of chunks) controller.enqueue(enc.encode(ch));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function queueFetch(factories: Array<() => Response>) {
  const calls: RecordedInit[] = [];
  const state = { n: 0 };
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push((init ?? {}) as RecordedInit);
    const factory = factories[Math.min(state.n, factories.length - 1)];
    state.n += 1;
    return factory();
  }) as unknown as typeof fetch;
  return { fn, calls, state };
}

function fixedFetch(factory: () => Response) {
  const calls: RecordedInit[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push((init ?? {}) as RecordedInit);
    return factory();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const fastRetryClient = (fn: typeof fetch, over: Partial<{ maxRetries: number }> = {}) =>
  new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu",
    fetch: fn,
    retryBaseMs: 1,
    retryMaxMs: 2,
    ...over,
  });

// ---------------------------------------------------------------- retries

test("retries a 429 then succeeds", async () => {
  const { fn, state } = queueFetch([
    () => jsonResponse({ error: { message: "slow" } }, { status: 429 }),
    () => jsonResponse({ output_text: "ok" }),
  ]);
  const res = await fastRetryClient(fn).respond("x");
  assert.equal(res.text, "ok");
  assert.equal(state.n, 2);
});

test("retries a thrown network error then succeeds", async () => {
  const { fn, state } = queueFetch([
    () => {
      throw new Error("ECONNRESET");
    },
    () => jsonResponse({ output_text: "recovered" }),
  ]);
  const res = await fastRetryClient(fn).respond("x");
  assert.equal(res.text, "recovered");
  assert.equal(state.n, 2);
});

test("gives up after maxRetries (default 2 -> 3 attempts) and throws the last error", async () => {
  const { fn, state } = queueFetch([() => jsonResponse({ error: { message: "slow" } }, { status: 429 })]);
  await assert.rejects(
    () => fastRetryClient(fn).respond("x"),
    (e: unknown) => e instanceof FuguRateLimitError,
  );
  assert.equal(state.n, 3);
});

test("does not retry a non-retryable 400", async () => {
  const { fn, state } = queueFetch([() => jsonResponse({ error: { message: "bad" } }, { status: 400 })]);
  await assert.rejects(
    () => fastRetryClient(fn).respond("x"),
    (e: unknown) => e instanceof FuguBadRequestError,
  );
  assert.equal(state.n, 1);
});

test("reuses the same Idempotency-Key across retries", async () => {
  const { fn, calls } = queueFetch([
    () => jsonResponse({ error: { message: "slow" } }, { status: 429 }),
    () => jsonResponse({ output_text: "ok" }),
  ]);
  await fastRetryClient(fn).respond("x");
  assert.equal(calls.length, 2);
  const k0 = calls[0].headers["Idempotency-Key"];
  assert.ok(k0 && k0.length > 0);
  assert.equal(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
});

test("retryDelayMs honors Retry-After; fullJitterBackoff stays within the ceiling", () => {
  const err = new FuguRateLimitError("rl", { retryAfterMs: 1234 });
  assert.equal(retryDelayMs(err, 0, { maxRetries: 2, baseMs: 500, maxMs: 8000 }), 1234);
  for (let i = 0; i < 50; i++) {
    const d = fullJitterBackoff(3, 500, 8000);
    assert.ok(d >= 0 && d <= 4000); // min(8000, 500*2^3)=4000
  }
});

// ---------------------------------------------------------------- streaming

test("respondStream yields text deltas then a terminal result with usage", async () => {
  const { fn } = fixedFetch(() =>
    sseResponse([
      'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'data: {"type":"response.completed","response":{"output_text":"Hello","status":"completed","usage":{"input_tokens":3,"output_tokens":1}}}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu-ultra", fetch: fn });
  const events = [];
  for await (const ev of client.respondStream("hi")) events.push(ev);

  const text = events
    .filter((e) => e.type === "delta")
    .map((e) => e.textDelta)
    .join("");
  assert.equal(text, "Hello");
  const done = events.at(-1);
  assert.equal(done?.type, "done");
  assert.equal(done?.result?.text, "Hello");
  assert.equal(done?.result?.status, "completed");
  assert.equal(done?.result?.usage.inputTokens, 3);
});

test("parseSSE reassembles events split across chunk boundaries", async () => {
  const { fn } = fixedFetch(() =>
    sseResponse(['data: {"type":"response.output_text.del', 'ta","delta":"Hi"}\n\ndata: [DONE]\n\n']),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });
  let text = "";
  for await (const ev of client.respondStream("hi")) if (ev.type === "delta") text += ev.textDelta;
  assert.equal(text, "Hi");
});

test("chatStream parses choices[0].delta.content", async () => {
  const { fn } = fixedFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });
  const done = (await collect(client.chatStream([{ role: "user", content: "hi" }]))).at(-1);
  assert.equal(done?.result?.text, "ab");
});

test("parseSSE is usable directly on a ReadableStream", async () => {
  const stream = sseResponse(["event: ping\ndata: 1\n\n", "data: 2\n\n"]).body;
  assert.ok(stream);
  const msgs = await collect(parseSSE(stream));
  assert.deepEqual(
    msgs.map((m) => m.data),
    ["1", "2"],
  );
  assert.equal(msgs[0].event, "ping");
});

// ---------------------------------------------------------------- budget

test("BudgetGuard records, warns at thresholds, and throws when exceeded", () => {
  const warned: number[] = [];
  const b = new BudgetGuard({ limitUsd: 1, onWarn: (_s, _l, r) => warned.push(r) });
  b.record(0.4);
  b.check();
  b.record(0.45); // 0.85 -> crosses 0.5 and 0.75
  assert.deepEqual(warned, [0.5, 0.75]);
  b.record(0.3); // 1.15
  assert.throws(
    () => b.check(),
    (e: unknown) => e instanceof FuguBudgetError,
  );
});

test("client refuses the next request once the budget is exceeded", async () => {
  const { fn, calls } = fixedFetch(() =>
    jsonResponse({ output_text: "ok", usage: { input_tokens: 10, output_tokens: 20 } }),
  );
  // fugu-ultra cost ≈ (10*5 + 20*30)/1e6 = 0.00065; limit below that trips after one call.
  const budget = new BudgetGuard({ limitUsd: 0.0005 });
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu-ultra",
    fetch: fn,
    budget,
  });

  await client.respond("first"); // ok, records ~0.00065
  await assert.rejects(
    () => client.respond("second"),
    (e: unknown) => e instanceof FuguBudgetError,
  );
  assert.equal(calls.length, 1); // second never hit the network
});

// ---------------------------------------------------------------- routing

test("chooseModel escalates only on clear signals", () => {
  assert.equal(chooseModel({ chars: 100 }), "fugu");
  assert.equal(chooseModel({ chars: 100, effort: "max" }), "fugu-ultra");
  assert.equal(chooseModel({ chars: 2_000_000 }), "fugu-ultra");
  assert.equal(chooseModel({ chars: 100, task: "code" }), "fugu-ultra");
  assert.equal(chooseModel({ chars: 100, task: "chat" }), "fugu");
  assert.equal(chooseModel({ chars: 100, task: "code" }, { escalateTasks: [] }), "fugu");
});

// ---------------------------------------------------------------- caps

test("input size guard rejects oversized input before any fetch", async () => {
  const { fn, calls } = fixedFetch(() => jsonResponse({ output_text: "ok" }));
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu",
    fetch: fn,
    maxInputChars: 5,
  });
  await assert.rejects(
    () => client.respond("way too long"),
    (e: unknown) => e instanceof FuguBadRequestError,
  );
  assert.equal(calls.length, 0);
});

test("output-token cap clamps the request body (responses + chat)", async () => {
  const { fn, calls } = fixedFetch(() => jsonResponse({ output_text: "ok" }));
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu",
    fetch: fn,
    maxOutputTokens: 100,
  });

  await client.respond("hi", { maxOutputTokens: 5000 });
  assert.equal(JSON.parse(calls[0].body).max_output_tokens, 100);

  await client.respond("hi"); // no per-call request -> default to the cap
  assert.equal(JSON.parse(calls[1].body).max_output_tokens, 100);

  await client.chat([{ role: "user", content: "hi" }], { maxOutputTokens: 50 });
  assert.equal(JSON.parse(calls[2].body).max_completion_tokens, 50);
});

// ---------------------------------------------------------------- streaming usage / budget / errors

test("chatStream captures usage from the final include_usage chunk", async () => {
  const { fn, calls } = fixedFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu-ultra", fetch: fn });
  const done = (await collect(client.chatStream([{ role: "user", content: "hi" }]))).at(-1);
  assert.equal(done?.result?.text, "hi");
  assert.equal(done?.result?.usage.inputTokens, 10);
  assert.equal(done?.result?.usage.outputTokens, 20);
  assert.ok((done?.result?.costUsd ?? 0) > 0);
  assert.equal(done?.result?.status, "completed");
  assert.deepEqual(JSON.parse(calls[0].body).stream_options, { include_usage: true });
});

test("streaming records spend against the BudgetGuard", async () => {
  const budget = new BudgetGuard({ limitUsd: 1000 });
  const { fn } = fixedFetch(() =>
    sseResponse([
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":1000000,"completion_tokens":0}}\n\n',
      "data: [DONE]\n\n",
    ]),
  );
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu-ultra",
    fetch: fn,
    budget,
  });
  await collect(client.chatStream([{ role: "user", content: "hi" }]));
  assert.ok(budget.spent > 4); // fugu-ultra 1M input ≈ $5
});

test("a stalled stream body aborts as a typed FuguTimeoutError", async () => {
  const fn = ((_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const keepAlive = setTimeout(() => {}, 60_000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(keepAlive);
            const reasonName = (signal.reason as { name?: string } | undefined)?.name;
            controller.error(
              Object.assign(new Error("aborted"), {
                name: reasonName === "TimeoutError" ? "TimeoutError" : "AbortError",
              }),
            );
          },
          { once: true },
        );
      },
    });
    return Promise.resolve(
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
  }) as unknown as typeof fetch;
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu",
    fetch: fn,
    timeoutMs: 5,
  });
  await assert.rejects(
    async () => {
      for await (const _ev of client.respondStream("hi")) {
        // drain until the body aborts
      }
    },
    (e: unknown) => e instanceof FuguTimeoutError,
  );
});

test("a stream that ends without a terminal event is not falsely 'completed'", async () => {
  const { fn } = fixedFetch(() =>
    sseResponse(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });
  const done = (await collect(client.respondStream("hi"))).at(-1);
  assert.equal(done?.result?.text, "partial");
  assert.notEqual(done?.result?.status, "completed");
});
