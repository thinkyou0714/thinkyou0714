import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { Conversation } from "../src/conversation.ts";
import { functionTool, webSearchTool, parseToolCalls } from "../src/tools.ts";
import { parseJsonLoose } from "../src/json.ts";
import { FuguValidationError } from "../src/errors.ts";
import type { RequestEvent, ResponseEvent } from "../src/observe.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";

type RecordedInit = RequestInit & { headers: Record<string, string>; body: string };

function jsonResponse(
  obj: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(obj), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function fixedFetch(factory: () => Response) {
  const calls: RecordedInit[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push((init ?? {}) as RecordedInit);
    return factory();
  }) as unknown as typeof fetch;
  return { fn, calls };
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

const newClient = (fn: typeof fetch, over: Record<string, unknown> = {}) =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu-ultra", fetch: fn, ...over });

// ---------------------------------------------------------------- tool calling

test("parseToolCalls reads Responses function_call and Chat tool_calls", () => {
  assert.deepEqual(
    parseToolCalls({
      output: [{ type: "function_call", call_id: "c1", name: "getWeather", arguments: '{"city":"Tokyo"}' }],
    }),
    [{ id: "c1", name: "getWeather", arguments: '{"city":"Tokyo"}' }],
  );
  assert.deepEqual(
    parseToolCalls({
      choices: [{ message: { tool_calls: [{ id: "t1", function: { name: "sum", arguments: "{}" } }] } }],
    }),
    [{ id: "t1", name: "sum", arguments: "{}" }],
  );
});

test("respond() sends Responses-format tools and surfaces tool calls", async () => {
  const { fn, calls } = fixedFetch(() =>
    jsonResponse({
      output: [{ type: "function_call", call_id: "c1", name: "getWeather", arguments: '{"city":"NYC"}' }],
    }),
  );
  const res = await newClient(fn).respond("weather?", {
    tools: [
      functionTool("getWeather", { parameters: { type: "object", properties: { city: { type: "string" } } } }),
      webSearchTool(),
    ],
    toolChoice: "auto",
  });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].name, "getWeather"); // flat — Responses format
  assert.equal(body.tools[1].type, "web_search");
  assert.equal(body.tool_choice, "auto");
  assert.equal(res.toolCalls?.[0].name, "getWeather");
});

test("chat() sends Chat-format tools (nested under function)", async () => {
  const { fn, calls } = fixedFetch(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
  await newClient(fn).chat([{ role: "user", content: "hi" }], { tools: [functionTool("sum")] });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.tools[0].type, "function");
  assert.equal(body.tools[0].function.name, "sum"); // nested — Chat format
});

test("runTools runs handlers and feeds results back until a final answer", async () => {
  const { fn, calls } = queueFetch([
    () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "t1", function: { name: "add", arguments: '{"a":2,"b":3}' } }],
            },
          },
        ],
      }),
    () =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "The sum is 5." }, finish_reason: "stop" }],
      }),
  ]);
  let handlerArgs: unknown;
  const res = await newClient(fn).runTools([{ role: "user", content: "add 2 and 3" }], {
    tools: [functionTool("add")],
    handlers: {
      add: (args) => {
        handlerArgs = args;
        const { a, b } = args as { a: number; b: number };
        return { result: a + b };
      },
    },
  });
  assert.equal(res.text, "The sum is 5.");
  assert.deepEqual(handlerArgs, { a: 2, b: 3 });
  assert.equal(calls.length, 2);
  const secondMessages = JSON.parse(calls[1].body).messages;
  const toolMsg = secondMessages.at(-1);
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "t1");
  assert.equal(JSON.parse(toolMsg.content).result, 5);
});

// ---------------------------------------------------------------- structured output

test("respondJson parses fenced JSON and validates", async () => {
  const { fn } = fixedFetch(() => jsonResponse({ output_text: '```json\n{"n":42}\n```' }));
  const { data } = await newClient(fn).respondJson("give n", {
    validate: (v) => {
      const o = v as { n: number };
      if (typeof o.n !== "number") throw new Error("n must be number");
      return o;
    },
  });
  assert.equal(data.n, 42);
});

test("respondJson sends a json_schema text.format when a schema is given", async () => {
  const { fn, calls } = fixedFetch(() => jsonResponse({ output_text: '{"ok":true}' }));
  await newClient(fn).respondJson("x", {
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
    schemaName: "Ans",
  });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "Ans");
  assert.equal(body.text.format.strict, true);
});

test("respondJson repairs once then succeeds", async () => {
  const { fn, state } = queueFetch([
    () => jsonResponse({ output_text: "not json at all" }),
    () => jsonResponse({ output_text: '{"ok":true}' }),
  ]);
  const { data } = await newClient(fn).respondJson("x");
  assert.deepEqual(data, { ok: true });
  assert.equal(state.n, 2);
});

test("respondJson throws FuguValidationError after exhausting repairs", async () => {
  const { fn, state } = queueFetch([() => jsonResponse({ output_text: "never json" })]);
  await assert.rejects(
    () => newClient(fn).respondJson("x", { repairAttempts: 0 }),
    (e: unknown) => e instanceof FuguValidationError,
  );
  assert.equal(state.n, 1);
});

test("parseJsonLoose handles fences and surrounding prose", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here you go: {"b":2} done'), { b: 2 });
  assert.throws(() => parseJsonLoose("no json here"));
});

// ---------------------------------------------------------------- stateful chaining

test("respond() forwards previous_response_id/store; Conversation chains ids", async () => {
  const { fn, calls } = queueFetch([
    () => jsonResponse({ id: "resp_1", output_text: "a", status: "completed" }),
    () => jsonResponse({ id: "resp_2", output_text: "b", status: "completed" }),
  ]);
  const client = newClient(fn);
  const convo = new Conversation(client);
  await convo.send("first");
  await convo.send("second");
  const body2 = JSON.parse(calls[1].body);
  assert.equal(body2.previous_response_id, "resp_1");
  assert.equal(body2.store, true);
  assert.equal(convo.lastId, "resp_2");
});

// ---------------------------------------------------------------- observability

test("onRequest/onResponse hooks and the retry logger fire", async () => {
  const reqs: RequestEvent[] = [];
  const resps: ResponseEvent[] = [];
  const logs: Array<{ message: string; meta?: Record<string, unknown> }> = [];
  const { fn } = queueFetch([
    () => jsonResponse({ error: { message: "slow" } }, { status: 429 }),
    () => jsonResponse({ output_text: "ok", usage: { input_tokens: 1, output_tokens: 1 } }),
  ]);
  const client = newClient(fn, {
    retryBaseMs: 1,
    retryMaxMs: 2,
    onRequest: (e: RequestEvent) => reqs.push(e),
    onResponse: (e: ResponseEvent) => resps.push(e),
    logger: {
      debug: (message: string, meta?: Record<string, unknown>) => logs.push({ message, meta }),
      warn: () => {},
    },
  });
  const res = await client.respond("x");
  assert.equal(res.text, "ok");
  assert.equal(reqs.length, 2);
  assert.deepEqual(
    reqs.map((r) => r.attempt),
    [0, 1],
  );
  assert.equal(resps.length, 1);
  assert.ok((resps[0].costUsd ?? 0) > 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].meta?.code, "rate_limit");
});

// ---------------------------------------------------------------- review fixes

test("runTools relaxes toolChoice 'required' to 'auto' after the first turn", async () => {
  const { fn, calls } = queueFetch([
    () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "t1", function: { name: "noop", arguments: "{}" } }],
            },
          },
        ],
      }),
    () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }] }),
  ]);
  const res = await newClient(fn).runTools([{ role: "user", content: "go" }], {
    tools: [functionTool("noop")],
    toolChoice: "required",
    handlers: { noop: () => ({ ok: true }) },
  });
  assert.equal(res.text, "done");
  assert.equal(JSON.parse(calls[0].body).tool_choice, "required");
  assert.equal(JSON.parse(calls[1].body).tool_choice, "auto"); // relaxed so it can finish
});

test("respondJson merges schema into a caller-provided params.text", async () => {
  const { fn, calls } = fixedFetch(() => jsonResponse({ output_text: '{"ok":true}' }));
  await newClient(fn).respondJson("x", {
    schema: { type: "object", properties: { ok: { type: "boolean" } } },
    params: { text: { verbosity: "low" } },
  });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.text.verbosity, "low"); // sibling preserved
  assert.equal(body.text.format.type, "json_schema");
});

test("runTools turns a missing/throwing handler into an error tool message", async () => {
  const { fn, calls } = queueFetch([
    () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                { id: "t1", function: { name: "boom", arguments: "{}" } },
                { id: "t2", function: { name: "missing", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    () =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "recovered" }, finish_reason: "stop" }],
      }),
  ]);
  const res = await newClient(fn).runTools([{ role: "user", content: "go" }], {
    tools: [functionTool("boom"), functionTool("missing")],
    handlers: {
      boom: () => {
        throw new Error("kaboom");
      },
    },
  });
  assert.equal(res.text, "recovered");
  const msgs = JSON.parse(calls[1].body).messages as Array<{ role?: string; content?: string }>;
  const toolMsgs = msgs.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 2);
  assert.match(JSON.parse(toolMsgs[0].content ?? "{}").error, /kaboom/);
  assert.match(JSON.parse(toolMsgs[1].content ?? "{}").error, /No handler/);
});
