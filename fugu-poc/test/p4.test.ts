import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import { FuguClient } from "../src/fugu-client.ts";
import { FuguRouter } from "../src/router.ts";
import type { RouterProvider } from "../src/router.ts";
import { createProxyServer } from "../src/proxy.ts";
import type { ProxyOptions, ProxyBackend } from "../src/proxy.ts";
import type { FuguStreamEvent } from "../src/fugu-client.ts";
import { FuguBadRequestError, FuguError } from "../src/errors.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";

function throwingFetch(err: unknown): typeof fetch {
  return (async () => {
    throw err;
  }) as unknown as typeof fetch;
}

function jsonFetch(obj: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function provider(name: string, fn: typeof fetch, model?: string): RouterProvider {
  return {
    name,
    client: new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: model ?? "fugu", fetch: fn }),
    model,
  };
}

// ---------------------------------------------------------------- router

test("FuguRouter fails over to the next provider on a connection error", async () => {
  const router = new FuguRouter({
    providers: [
      provider("p1", throwingFetch(new Error("ECONNREFUSED"))),
      provider("p2", jsonFetch({ output_text: "from p2" })),
    ],
  });
  const res = await router.respond("hi");
  assert.equal(res.text, "from p2");
  assert.equal(res.provider, "p2");
});

test("FuguRouter does not fail over on a non-retryable 400", async () => {
  let p2Called = false;
  const p2: RouterProvider = {
    name: "p2",
    client: new FuguClient({
      apiKey: "k",
      baseUrl: DEFAULT_BASE_URL,
      model: "fugu",
      fetch: (async () => {
        p2Called = true;
        return new Response("{}");
      }) as unknown as typeof fetch,
    }),
  };
  const router = new FuguRouter({
    providers: [provider("p1", jsonFetch({ error: { message: "bad" } }, 400)), p2],
  });
  await assert.rejects(
    () => router.respond("hi"),
    (e: unknown) => e instanceof FuguBadRequestError,
  );
  assert.equal(p2Called, false);
});

test("FuguRouter uses each provider's own model", async () => {
  const { fn, body } = recordingJson({ output_text: "ok" });
  const router = new FuguRouter({ providers: [provider("p", fn, "fugu-ultra")] });
  await router.respond("hi");
  assert.equal(JSON.parse(body.value).model, "fugu-ultra");
});

test("FuguRouter requires at least one provider", () => {
  assert.throws(() => new FuguRouter({ providers: [] }));
});

function recordingJson(obj: unknown) {
  const body = { value: "" };
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    body.value = String(init?.body ?? "");
    return new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, body };
}

// ---------------------------------------------------------------- proxy

function startProxy(opts: ProxyOptions): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createProxyServer(opts);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const backendWith = (fn: typeof fetch, model = "fugu-ultra") =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model, fetch: fn });

test("proxy GET /v1/models lists models", async () => {
  const { base, close } = await startProxy({
    backend: backendWith(jsonFetch({})),
    models: ["fugu", "fugu-ultra"],
  });
  const j = (await (await fetch(`${base}/models`)).json()) as { object: string; data: Array<{ id: string }> };
  assert.equal(j.object, "list");
  assert.deepEqual(
    j.data.map((m) => m.id),
    ["fugu", "fugu-ultra"],
  );
  await close();
});

test("proxy POST /v1/chat/completions returns an OpenAI chat.completion", async () => {
  const backend = backendWith(
    jsonFetch({
      choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }),
  );
  const { base, close } = await startProxy({ backend });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fugu-ultra", messages: [{ role: "user", content: "hi" }] }),
  });
  const j = (await r.json()) as {
    object: string;
    choices: Array<{ message: { content: string }; finish_reason: string }>;
    usage: { prompt_tokens: number };
  };
  assert.equal(j.object, "chat.completion");
  assert.equal(j.choices[0].message.content, "hello");
  assert.equal(j.choices[0].finish_reason, "stop");
  assert.equal(j.usage.prompt_tokens, 1);
  await close();
});

test("proxy enforces the bearer token", async () => {
  const { base, close } = await startProxy({ backend: backendWith(jsonFetch({})), token: "secret" });
  assert.equal((await fetch(`${base}/models`)).status, 401);
  assert.equal((await fetch(`${base}/models`, { headers: { authorization: "Bearer secret" } })).status, 200);
  await close();
});

test("proxy streams chat completions as SSE chunks ending with [DONE]", async () => {
  const sseFetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          const e = new TextEncoder();
          c.enqueue(e.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
          c.enqueue(e.encode('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n'));
          c.enqueue(e.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )) as unknown as typeof fetch;
  const { base, close } = await startProxy({ backend: backendWith(sseFetch) });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fugu", messages: [{ role: "user", content: "hi" }], stream: true }),
  });
  const text = await r.text();
  assert.match(text, /chat\.completion\.chunk/);
  assert.match(text, /"content":"Hi"/);
  assert.match(text, /data: \[DONE\]/);
  await close();
});

// ---------------------------------------------------------------- proxy review fixes

test("proxy 404s non-exact paths (no endsWith bypass) and never reaches the backend", async () => {
  let called = false;
  const backend = backendWith((async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch);
  const { base, close } = await startProxy({ backend });
  const origin = new URL(base).origin;
  const r = await fetch(`${origin}/foo/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(r.status, 404);
  assert.equal(called, false);
  await close();
});

test("proxy POST /v1/responses returns the raw responses payload", async () => {
  const { base, close } = await startProxy({
    backend: backendWith(jsonFetch({ output_text: "resp", status: "completed" })),
  });
  const r = await fetch(`${base}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fugu", input: "hi" }),
  });
  const j = (await r.json()) as { output_text: string };
  assert.equal(j.output_text, "resp");
  await close();
});

test("proxy stream emits an error frame and no [DONE] when the backend stream fails", async () => {
  const backend: ProxyBackend = {
    chat: async () => {
      throw new Error("nope");
    },
    respond: async () => {
      throw new Error("nope");
    },
    async *chatStream(): AsyncGenerator<FuguStreamEvent> {
      yield { type: "delta", textDelta: "partial" };
      throw new Error("mid-stream boom");
    },
    // biome-ignore lint/correctness/useYield: throwing mock generator; never iterated in this test
    async *respondStream(): AsyncGenerator<FuguStreamEvent> {
      throw new Error("nope");
    },
  };
  const { base, close } = await startProxy({ backend });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], stream: true }),
  });
  const text = await r.text();
  assert.match(text, /"content":"partial"/);
  assert.match(text, /mid-stream boom/);
  assert.doesNotMatch(text, /\[DONE\]/);
  await close();
});

test("proxy returns 500 (not a hang) on an invalid JSON body", async () => {
  const { base, close } = await startProxy({ backend: backendWith(jsonFetch({})) });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not valid json",
  });
  assert.equal(r.status, 500);
  await close();
});

test("proxy token blocks /chat/completions before the backend", async () => {
  let called = false;
  const backend = backendWith((async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch);
  const { base, close } = await startProxy({ backend, token: "secret" });
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  assert.equal(r.status, 401);
  assert.equal(called, false);
  await close();
});

test("FuguRouter propagates the last provider's error after exhausting failover", async () => {
  const mk = (name: string) => provider(name, jsonFetch({ error: { message: name } }, 503));
  const router = new FuguRouter({ providers: [mk("p1"), mk("p2"), mk("p3")] });
  await assert.rejects(
    () => router.respond("hi"),
    (e: unknown) => e instanceof FuguError && e.status === 503,
  );
});
