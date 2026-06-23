import { test } from "node:test";
import assert from "node:assert/strict";

import { FuguClient } from "../src/fugu-client.ts";
import { FuguTimeoutError, FuguAbortError } from "../src/errors.ts";
import { DEFAULT_BASE_URL } from "../src/config.ts";

// A fetch that never resolves until its AbortSignal fires, then rejects the way
// undici does — exercising the REAL AbortSignal.timeout / AbortSignal.any wiring
// (the subtlest code in the client) rather than a stubbed error.
function hangingFetch(): typeof fetch {
  return ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      // A real network fetch keeps the event loop alive; AbortSignal.timeout's own
      // timer is unref'd, so without this ref'd keep-alive the process could exit
      // before the timeout fires and the test would be cancelled rather than run.
      const keepAlive = setTimeout(() => {}, 60_000);
      const fail = () => {
        clearTimeout(keepAlive);
        const reasonName = (signal?.reason as { name?: string } | undefined)?.name;
        const err = new Error("aborted");
        err.name = reasonName === "TimeoutError" ? "TimeoutError" : "AbortError";
        reject(err);
      };
      if (!signal) {
        clearTimeout(keepAlive);
        return;
      }
      if (signal.aborted) return fail();
      signal.addEventListener("abort", fail, { once: true });
    })) as unknown as typeof fetch;
}

test("internal AbortSignal.timeout aborts a hanging request -> FuguTimeoutError", async () => {
  const c = new FuguClient({
    apiKey: "k",
    baseUrl: DEFAULT_BASE_URL,
    model: "fugu",
    fetch: hangingFetch(),
    timeoutMs: 5,
  });
  await assert.rejects(
    () => c.respond("x"),
    (e: unknown) => e instanceof FuguTimeoutError && e.isRetryable === true,
  );
});

test("a caller-supplied signal aborting wins -> FuguAbortError (not a timeout)", async () => {
  const c = new FuguClient({ apiKey: "k", baseUrl: DEFAULT_BASE_URL, model: "fugu", fetch: hangingFetch() });
  await assert.rejects(
    () => c.respond("x", { signal: AbortSignal.timeout(5) }),
    (e: unknown) => e instanceof FuguAbortError && e.code === "aborted",
  );
});
