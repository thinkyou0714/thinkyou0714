import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";
import { ObsidianClient } from "../integrations/obsidian/src/obsidian-api.ts";
import { runFuguOnNote, buildPrompt } from "../integrations/obsidian/src/command.ts";

/** Mock the Local REST API: serve notes on GET, accumulate appends on POST. */
function obsidianMock(initial: Record<string, string>) {
  const notes: Record<string, string> = { ...initial };
  const calls: Array<{ method: string; key: string; body?: string }> = [];
  const fetchImpl = (async (url: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(new URL(url).pathname);
    const key = path === "/active/" ? "active" : path.replace(/^\/vault\//, "");
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, key, body });
    if (method === "GET") {
      if (notes[key] === undefined) return new Response("not found", { status: 404 });
      return new Response(notes[key], { status: 200, headers: { "content-type": "text/markdown" } });
    }
    if (method === "POST") {
      notes[key] = (notes[key] ?? "") + (body ?? "");
      return new Response(null, { status: 204 });
    }
    return new Response("method not allowed", { status: 405 });
  }) as unknown as typeof fetch;
  return { fetchImpl, notes, calls };
}

/** Mock Fugu: capture the `input` it was sent and reply with `text`. */
function fuguMock(text: string) {
  const inputs: string[] = [];
  const fetchImpl = (async (_url: string, init?: { body?: unknown }) => {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { input?: string }) : {};
    if (typeof body.input === "string") inputs.push(body.input);
    return new Response(JSON.stringify({ output_text: text }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, inputs };
}

const obsidian = (fetchImpl: typeof fetch) =>
  new ObsidianClient({ apiKey: "k", baseUrl: "http://127.0.0.1:27124", fetch: fetchImpl });
const fugu = (fetchImpl: typeof fetch) =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fetchImpl });

test("buildPrompt embeds the question and the note body", () => {
  const p = buildPrompt("the body", "Improve this");
  assert.match(p, /Improve this/);
  assert.match(p, /the body/);
});

test("buildPrompt falls back to a default instruction when no question", () => {
  const p = buildPrompt("the body");
  assert.match(p, /assistant embedded in Obsidian/i);
  assert.match(p, /the body/);
});

test("runs Fugu on the active note and appends the answer", async () => {
  const obs = obsidianMock({ active: "My note body" });
  const fg = fuguMock("ANSWER-42");

  const answer = await runFuguOnNote(
    { notes: obsidian(obs.fetchImpl), fugu: fugu(fg.fetchImpl) },
    { question: "What is missing?" },
  );

  assert.equal(answer, "ANSWER-42");
  assert.match(obs.notes.active, /## 🐡 Fugu/);
  assert.match(obs.notes.active, /ANSWER-42/);
  // The prompt carried the note body and the question.
  assert.match(fg.inputs[0], /My note body/);
  assert.match(fg.inputs[0], /What is missing\?/);
});

test("targets a vault path instead of the active note", async () => {
  const obs = obsidianMock({ "Projects/Plan.md": "plan content" });
  const fg = fuguMock("vault-answer");

  const answer = await runFuguOnNote(
    { notes: obsidian(obs.fetchImpl), fugu: fugu(fg.fetchImpl) },
    { target: { path: "Projects/Plan.md" } },
  );

  assert.equal(answer, "vault-answer");
  assert.match(obs.notes["Projects/Plan.md"], /vault-answer/);
  assert.equal(obs.notes.active, undefined);
  // Read+write both addressed the vault path.
  assert.deepEqual(
    obs.calls.map((c) => `${c.method} ${c.key}`),
    ["GET Projects/Plan.md", "POST Projects/Plan.md"],
  );
});

test("an empty Fugu answer becomes a visible placeholder, not a blank append", async () => {
  const obs = obsidianMock({ active: "x" });
  const answer = await runFuguOnNote({ notes: obsidian(obs.fetchImpl), fugu: fugu(fuguMock("").fetchImpl) });
  assert.match(answer, /empty response/i);
  assert.match(obs.notes.active, /empty response/i);
});

test("ObsidianClient redacts a secret echoed in an error body", async () => {
  const fakeSecret = ["sk", "live", "C0FFEE1234567890abcd"].join("-");
  const mock = (async () =>
    new Response(`denied for Authorization: Bearer ${fakeSecret}`, { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(obsidian(mock).getActiveNote(), (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    assert.ok(!msg.includes(fakeSecret), "raw secret must not appear in the error");
    assert.match(msg, /\[REDACTED\]/);
    assert.match(msg, /Obsidian API error 401/);
    return true;
  });
});
