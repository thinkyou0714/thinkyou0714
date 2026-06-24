import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";
import { fuguRespond, fuguChat, fuguListModels } from "../integrations/mcp/src/handlers.ts";

function jsonFetch(obj: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const client = (fn: typeof fetch) => new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu-ultra", fetch: fn });

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
