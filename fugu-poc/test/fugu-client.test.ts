import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FuguClient,
  FuguError,
  createClient,
  extractResponsesText,
  extractChatText,
} from "../src/fugu-client.ts";
import { loadConfig, normalizeBaseUrl, DEFAULT_BASE_URL, DEFAULT_MODEL } from "../src/config.ts";
import { parseArgs } from "../src/cli.ts";

interface RecordedCall {
  url: string;
  init: RequestInit & { headers: Record<string, string> };
}

function mockFetch(responder: () => Response) {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall["init"] });
    return responder();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("respond() posts to /responses with auth + model and parses output_text", async () => {
  const { fn, calls } = mockFetch(() =>
    jsonResponse({ output_text: "hello world", usage: { total_tokens: 5 } }),
  );
  const client = new FuguClient({
    apiKey: "test-key",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu-ultra",
    fetch: fn,
  });

  const res = await client.respond("hi");

  assert.equal(res.text, "hello world");
  assert.equal(res.model, "fugu-ultra");
  assert.deepEqual(res.usage, { total_tokens: 5 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/responses");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "fugu-ultra");
  assert.equal(body.input, "hi");
});

test("respond() aggregates nested output[].content[].text when output_text is absent", async () => {
  const payload = {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "foo " },
          { type: "output_text", text: "bar" },
        ],
      },
    ],
  };
  const { fn } = mockFetch(() => jsonResponse(payload));
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  const res = await client.respond("x");
  assert.equal(res.text, "foo bar");
});

test("chat() posts to /chat/completions and parses choices[0].message.content", async () => {
  const { fn, calls } = mockFetch(() =>
    jsonResponse({ choices: [{ message: { role: "assistant", content: "chat reply" } }] }),
  );
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  const res = await client.chat([{ role: "user", content: "hi" }]);

  assert.equal(res.text, "chat reply");
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/chat/completions");
  const body = JSON.parse(String(calls[0].init.body));
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("missing API key throws FuguError before calling fetch", async () => {
  let called = false;
  const fn = (async () => {
    called = true;
    return jsonResponse({});
  }) as unknown as typeof fetch;
  const client = new FuguClient({ apiKey: "", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  await assert.rejects(
    () => client.respond("x"),
    (e: unknown) => e instanceof FuguError && /api key|SAKANA_API_KEY/i.test(e.message),
  );
  assert.equal(called, false);
});

test("non-2xx response throws FuguError with status + body", async () => {
  const { fn } = mockFetch(() => jsonResponse({ error: "nope" }, 401));
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  await assert.rejects(
    () => client.respond("x"),
    (e: unknown) => e instanceof FuguError && e.status === 401 && /nope/.test(e.body ?? ""),
  );
});

test("model option overrides the configured default", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "ok" }));
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  await client.respond("x", { model: "fugu-ultra" });
  assert.equal(JSON.parse(String(calls[0].init.body)).model, "fugu-ultra");
});

test("baseUrl is normalized (trailing slash removed)", () => {
  assert.equal(normalizeBaseUrl("https://api.sakana.ai/v1/"), "https://api.sakana.ai/v1");
  const client = new FuguClient({
    apiKey: "k",
    baseUrl: "https://api.sakana.ai/v1/",
    model: "fugu",
    fetch: (async () => jsonResponse({})) as unknown as typeof fetch,
  });
  assert.equal(client.baseUrl, "https://api.sakana.ai/v1");
});

test("loadConfig reads env with sane defaults", () => {
  const cfg = loadConfig({ env: { SAKANA_API_KEY: "abc" } });
  assert.equal(cfg.apiKey, "abc");
  assert.equal(cfg.baseUrl, DEFAULT_BASE_URL);
  assert.equal(cfg.model, DEFAULT_MODEL);

  const cfg2 = loadConfig({
    env: { SAKANA_API_KEY: "abc", SAKANA_BASE_URL: "https://x/v1/", FUGU_MODEL: "fugu" },
  });
  assert.equal(cfg2.baseUrl, "https://x/v1");
  assert.equal(cfg2.model, "fugu");
});

test("extract helpers handle empty / odd payloads", () => {
  assert.equal(extractResponsesText({}), "");
  assert.equal(
    extractResponsesText({ output_text: "", output: [{ content: [{ type: "output_text", text: "z" }] }] }),
    "z",
  );
  assert.equal(extractChatText({}), "");
});

test("parseArgs parses flags and the positional prompt", () => {
  const a = parseArgs(["hello", "world", "--model", "fugu", "--chat", "--json"]);
  assert.equal(a.prompt, "hello world");
  assert.equal(a.model, "fugu");
  assert.equal(a.chat, true);
  assert.equal(a.json, true);

  const b = parseArgs(["--model=fugu-ultra", "hi"]);
  assert.equal(b.model, "fugu-ultra");
  assert.equal(b.prompt, "hi");

  const c = parseArgs(["--help"]);
  assert.equal(c.help, true);
});

test("respond() does not let params override model/input", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "ok" }));
  const client = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fn });

  const res = await client.respond("real-input", {
    model: "fugu-ultra",
    params: { model: "HIJACK", input: "HIJACK", temperature: 0.2 },
  });

  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.model, "fugu-ultra");
  assert.equal(body.input, "real-input");
  assert.equal(body.temperature, 0.2);
  assert.equal(res.model, "fugu-ultra");
});

test("extractResponsesText preserves intentional whitespace output_text", () => {
  assert.equal(extractResponsesText({ output_text: "\n\n" }), "\n\n");
});

test("createClient builds a working client from a config", async () => {
  const { fn, calls } = mockFetch(() => jsonResponse({ output_text: "hi" }));
  const client = createClient(
    { apiKey: "k", baseUrl: "https://api.sakana.ai/v1/", model: "fugu" },
    { fetch: fn },
  );

  const res = await client.respond("yo");
  assert.equal(res.text, "hi");
  assert.equal(client.baseUrl, "https://api.sakana.ai/v1");
  assert.equal(calls[0].url, "https://api.sakana.ai/v1/responses");
});
