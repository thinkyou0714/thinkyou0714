/**
 * Retry policy: capped exponential backoff with full jitter, honoring `Retry-After`.
 * Zero dependencies.
 */

import { FuguAbortError, type FuguError } from "./errors.ts";

export interface RetryConfig {
  /** Max retries AFTER the first attempt (so total attempts = maxRetries + 1). */
  maxRetries: number;
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_RETRY: RetryConfig = { maxRetries: 2, baseMs: 500, maxMs: 8000 };

/** Cap to honor for a server-provided `Retry-After` (avoid pathological waits). */
const RETRY_AFTER_CAP_MS = 60_000;

/** Full-jitter exponential backoff: random in [0, min(maxMs, baseMs * 2^attempt)]. */
export function fullJitterBackoff(attempt: number, base: number, max: number): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/** Delay before the next attempt: honor `Retry-After` if present, else jittered backoff. */
export function retryDelayMs(err: FuguError, attempt: number, cfg: RetryConfig): number {
  if (err.retryAfterMs !== undefined) return Math.min(err.retryAfterMs, RETRY_AFTER_CAP_MS);
  return fullJitterBackoff(attempt, cfg.baseMs, cfg.maxMs);
}

/** Promise-based sleep that rejects (FuguAbortError) if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FuguAbortError("Aborted during retry backoff."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new FuguAbortError("Aborted during retry backoff."));
      },
      { once: true },
    );
  });
}
