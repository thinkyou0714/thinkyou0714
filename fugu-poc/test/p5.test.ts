import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";
import { MemoryCache, cacheKeyFor } from "../src/cache.ts";
import { WorkPool, SingleFlight } from "../src/pool.ts";
import type { FuguResult } from "../src/types.ts";

const mk = (text: string): FuguResult => ({ text, raw: {}, model: "fugu", status: "completed", usage: {} });

function countingFetch(obj: unknown) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

const clientWith = (fetchImpl: typeof fetch, cache?: MemoryCache) =>
  new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: fetchImpl, cache });

// ---------- cacheKeyFor ----------

test("cacheKeyFor is order-independent and content/endpoint sensitive", () => {
  const a = cacheKeyFor("/responses", { model: "fugu", input: "x", reasoning: { effort: "high" } });
  const b = cacheKeyFor("/responses", { reasoning: { effort: "high" }, input: "x", model: "fugu" });
  assert.equal(a, b, "key must not depend on property order");
  assert.notEqual(a, cacheKeyFor("/responses", { model: "fugu", input: "y" }));
  assert.notEqual(
    a,
    cacheKeyFor("/chat/completions", { model: "fugu", input: "x", reasoning: { effort: "high" } }),
  );
});

// ---------- MemoryCache ----------

test("MemoryCache stores, returns, and tracks hits/misses/cost saved", async () => {
  const c = new MemoryCache();
  assert.equal(await c.get("x"), undefined);
  await c.set("x", { ...mk("v"), costUsd: 0.25 });
  assert.equal((await c.get("x"))?.text, "v");
  await c.get("x");
  const s = c.stats();
  assert.deepEqual([s.hits, s.misses, s.size], [2, 1, 1]);
  assert.equal(s.costSavedUsd, 0.5);
});

test("MemoryCache evicts the least-recently-used beyond maxEntries", async () => {
  const c = new MemoryCache({ maxEntries: 2 });
  await c.set("a", mk("a"));
  await c.set("b", mk("b"));
  await c.get("a"); // touch "a" so "b" becomes least-recently-used
  await c.set("c", mk("c")); // evicts "b"
  assert.ok(await c.get("a"));
  assert.equal(await c.get("b"), undefined);
  assert.ok(await c.get("c"));
});

test("MemoryCache entries expire after ttlMs", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const c = new MemoryCache({ ttlMs: 1000 });
  await c.set("k", mk("v"));
  assert.ok(await c.get("k"));
  t.mock.timers.tick(1001);
  assert.equal(await c.get("k"), undefined);
});

// ---------- client cache integration ----------

test("identical respond() calls are served from cache (one network call)", async () => {
  const cf = countingFetch({ output_text: "hi", usage: { output_tokens: 10 } });
  const cache = new MemoryCache();
  const client = clientWith(cf.fetchImpl, cache);

  const r1 = await client.respond("same prompt");
  const r2 = await client.respond("same prompt");

  assert.equal(cf.calls(), 1, "second identical call must not hit the network");
  assert.ok(!r1.cached);
  assert.equal(r2.cached, true);
  assert.equal(r2.text, "hi");
  assert.equal(cache.stats().hits, 1);
});

test("opts.cache=false bypasses the cache", async () => {
  const cf = countingFetch({ output_text: "hi" });
  const client = clientWith(cf.fetchImpl, new MemoryCache());
  await client.respond("p");
  await client.respond("p", { cache: false });
  assert.equal(cf.calls(), 2);
});

test("stateful chaining (previousResponseId) is never cached", async () => {
  const cf = countingFetch({ output_text: "hi" });
  const client = clientWith(cf.fetchImpl, new MemoryCache());
  await client.respond("p", { previousResponseId: "resp_1" });
  await client.respond("p", { previousResponseId: "resp_1" });
  assert.equal(cf.calls(), 2);
});

test("different prompts are not confused in the cache", async () => {
  const cf = countingFetch({ output_text: "hi" });
  const client = clientWith(cf.fetchImpl, new MemoryCache());
  await client.respond("prompt A");
  await client.respond("prompt B");
  assert.equal(cf.calls(), 2);
});

// ---------- WorkPool ----------

test("WorkPool never exceeds its concurrency limit", async () => {
  const pool = new WorkPool(2);
  let active = 0;
  let max = 0;
  const task = async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
  };
  await pool.map(Array.from({ length: 6 }), task);
  assert.equal(max, 2);
});

test("WorkPool.map preserves input order", async () => {
  const pool = new WorkPool(3);
  const out = await pool.map([1, 2, 3, 4, 5], async (n) => {
    await new Promise((r) => setTimeout(r, (6 - n) * 2));
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test("WorkPool releases higher-priority waiters first", async () => {
  const pool = new WorkPool(1);
  const order: string[] = [];
  const blocker = pool.run(async () => {
    await new Promise((r) => setTimeout(r, 10));
    order.push("blocker");
  });
  // Queued while the single slot is busy; higher priority must run first despite enqueuing later.
  const low = pool.run(async () => void order.push("low"), 1);
  const high = pool.run(async () => void order.push("high"), 5);
  await Promise.all([blocker, low, high]);
  assert.deepEqual(order, ["blocker", "high", "low"]);
});

// ---------- SingleFlight ----------

test("SingleFlight coalesces concurrent same-key calls into one execution", async () => {
  const sf = new SingleFlight();
  let calls = 0;
  const task = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return "v";
  };
  const [a, b] = await Promise.all([sf.run("k", task), sf.run("k", task)]);
  assert.equal(calls, 1, "the shared key must execute once");
  assert.deepEqual([a, b], ["v", "v"]);
  assert.equal(sf.size, 0, "settled key is released");

  await sf.run("k", task); // same key, but the previous one already settled
  assert.equal(calls, 2);
});

test("SingleFlight runs distinct keys independently", async () => {
  const sf = new SingleFlight();
  let calls = 0;
  const task = async () => {
    calls++;
    return calls;
  };
  await Promise.all([sf.run("a", task), sf.run("b", task)]);
  assert.equal(calls, 2);
});

test("SingleFlight frees the key and shares a rejection with all callers", async () => {
  const sf = new SingleFlight();
  let calls = 0;
  const task = async () => {
    calls++;
    await Promise.resolve();
    throw new Error("nope");
  };
  const a = sf.run("k", task);
  const b = sf.run("k", task);
  await assert.rejects(a, /nope/);
  await assert.rejects(b, /nope/);
  assert.equal(calls, 1, "the shared key executes once even on rejection");
  assert.equal(sf.size, 0, "a rejected key is released");
});

test("SingleFlight does not poison a key when the task throws synchronously", async () => {
  const sf = new SingleFlight();
  let calls = 0;
  const syncThrow = (() => {
    calls++;
    throw new Error("sync boom");
  }) as () => Promise<never>;
  await assert.rejects(sf.run("k", syncThrow), /sync boom/);
  assert.equal(sf.size, 0, "key freed after a synchronous throw");
  const recovered = await sf.run("k", async () => "recovered");
  assert.equal(recovered, "recovered", "a later call re-executes rather than returning the stuck rejection");
  assert.equal(calls, 1);
});

test("WorkPool holds the limit when work is submitted mid-drain", async () => {
  const pool = new WorkPool(1);
  let active = 0;
  let max = 0;
  const track = async () => {
    active++;
    max = Math.max(max, active);
    await Promise.resolve();
    await Promise.resolve();
    active--;
  };
  const ps: Promise<void>[] = [];
  for (let i = 0; i < 5; i++) ps.push(pool.run(track));
  // Submit more work across microtask gaps, exactly the window where a naive pool over-admits.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    ps.push(pool.run(track));
  }
  await Promise.all(ps);
  assert.equal(max, 1, "never more than `concurrency` tasks run at once");
});

// ---------- cache value-semantics & key edge cases ----------

test("MemoryCache returns isolated copies — mutating a hit can't poison the cache", async () => {
  const c = new MemoryCache();
  await c.set("k", mk("v"));
  const first = await c.get("k");
  if (first) {
    first.text = "changed";
    (first.raw as Record<string, unknown>).mutated = true;
  }
  const second = await c.get("k");
  assert.equal(second?.text, "v");
  assert.deepEqual(second?.raw, {});
});

test("MemoryCache isolates from later mutation of the set value", async () => {
  const c = new MemoryCache();
  const v = mk("v");
  await c.set("k", v);
  v.text = "mutated after set";
  const got = await c.get("k");
  assert.equal(got?.text, "v");
});

test("cacheKeyFor distinguishes non-finite numbers instead of collapsing them to null", () => {
  const nan = cacheKeyFor("/responses", { input: "x", params: { t: Number.NaN } });
  const inf = cacheKeyFor("/responses", { input: "x", params: { t: Number.POSITIVE_INFINITY } });
  const nul = cacheKeyFor("/responses", { input: "x", params: { t: null } });
  assert.notEqual(nan, inf);
  assert.notEqual(nan, nul);
  assert.notEqual(inf, nul);
});
