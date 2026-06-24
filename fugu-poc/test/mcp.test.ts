import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";
import { fuguRespond, fuguChat, fuguListModels } from "../integrations/mcp/src/handlers.ts";

function jsonFetch(obj: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

const client = (fn: typeof fetch) =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu-ultra", fetch: fn });

test("fugu_respond handler returns the model text", async () => {
  const r = await fuguRespond(client(jsonFetch({ output_text: "hi there" })), { input: "hello" });
  assert.equal(r.content[0].text, "hi there");
  assert.ok(!r.isError);
});

test("fugu_chat handler returns the model text", async () => {
  const r = await fuguChat(client(jsonFetch({ choices: [{ message: { content: "yo" } }] })), {
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(r.content[0].text, "yo");
});

test("handler surfaces (redacted) errors as isError", async () => {
  const r = await fuguRespond(client(jsonFetch({ error: { message: "bad key" } }, 401)), { input: "x" });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /Fugu error/);
});

test("fugu_list_models handler lists models", () => {
  const r = fuguListModels(["fugu", "fugu-ultra"]);
  assert.deepEqual(JSON.parse(r.content[0].text), ["fugu", "fugu-ultra"]);
});

test("error text redacts a secret echoed in the upstream body", async () => {
  // Assemble the fake token in fragments so no literal key-shaped string lives in source.
  const fakeSecret = ["sk", "live", "DEADBEEFcafef00d1234"].join("-");
  const r = await fuguRespond(
    client(jsonFetch({ error: { message: `auth rejected: Authorization: Bearer ${fakeSecret}` } }, 401)),
    { input: "x" },
  );
  assert.ok(r.isError);
  assert.ok(!r.content[0].text.includes(fakeSecret), "raw secret must not appear in the tool result");
  assert.match(r.content[0].text, /\[REDACTED\]/);
});

test("fugu_respond reports a truncated (incomplete + empty) response as an error", async () => {
  const r = await fuguRespond(
    client(
      jsonFetch({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "" }),
    ),
    { input: "x" },
  );
  assert.ok(r.isError, "an empty truncated answer must not be a silent empty success");
  assert.match(r.content[0].text, /incomplete/i);
  assert.match(r.content[0].text, /max_output_tokens/);
});

test("fugu_respond keeps partial text but annotates the truncation", async () => {
  const r = await fuguRespond(
    client(
      jsonFetch({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: "partial",
      }),
    ),
    { input: "x" },
  );
  assert.ok(!r.isError);
  assert.match(r.content[0].text, /partial/);
  assert.match(r.content[0].text, /incomplete.*max_output_tokens/i);
});

test("fugu_respond reports an empty completed response as an error, not empty success", async () => {
  const r = await fuguRespond(client(jsonFetch({ status: "completed", output_text: "" })), { input: "x" });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /empty response/i);
});

test("fugu_chat forwards every message role unchanged", async () => {
  const calls: Array<{ body: unknown }> = [];
  const capture = (async (_url: string, init?: { body?: unknown }) => {
    const raw = init?.body;
    calls.push({ body: typeof raw === "string" ? JSON.parse(raw) : raw });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  await fuguChat(client(capture), {
    messages: [
      { role: "system", content: "s" },
      { role: "developer", content: "d" },
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ],
  });

  const sent = calls[0].body as { messages: Array<{ role: string }> };
  assert.deepEqual(
    sent.messages.map((m) => m.role),
    ["system", "developer", "user", "assistant"],
  );
});
