/**
 * Request-level response cache (roadmap #38, L1 "exact" layer).
 *
 * Keyed on a stable hash of the *full* request body, so identical calls (same prompt,
 * model, effort, params) are served without re-spending — Fugu's hidden orchestration
 * tokens make repeat calls the biggest avoidable cost. The `RequestCache` interface is
 * async so an L2 layer (Redis, or a semantic/pgvector store) can drop in behind the same
 * shape; `MemoryCache` is the zero-dependency default (LRU + optional TTL).
 */

import { createHash } from "node:crypto";
import type { FuguResult } from "./types.ts";

export interface RequestCache {
  /**
   * Return the cached result for `key`, or undefined. Implementations MUST return an
   * isolated copy (value semantics) — callers may read/mutate `raw`/`usage` in place.
   */
  get(key: string): Promise<FuguResult | undefined>;
  set(key: string, value: FuguResult): Promise<void>;
}

/** Recursively sort object keys so the hash is independent of property insertion order. */
function canonical(value: unknown): unknown {
  // Non-finite numbers would all become `null` under JSON.stringify (NaN==Infinity collision).
  if (typeof value === "number" && !Number.isFinite(value)) return { __nonfinite: String(value) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key]);
    return out;
  }
  return value;
}

/** Stable cache key for an endpoint + request body (order-independent SHA-256). */
export function cacheKeyFor(endpoint: string, body: Record<string, unknown>): string {
  return createHash("sha256")
    .update(endpoint)
    .update("\n")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}

export interface MemoryCacheOptions {
  /** Max entries before LRU eviction (default 500). */
  maxEntries?: number;
  /** Time-to-live in ms; 0 (default) means entries never expire. */
  ttlMs?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  /** Sum of `costUsd` of results served from cache — the spend this cache avoided. */
  costSavedUsd: number;
}

interface MemoryEntry {
  value: FuguResult;
  /** Epoch ms when this entry expires; 0 means no expiry. */
  expiresAt: number;
}

/** In-memory LRU + TTL cache. Insertion order in a Map is the LRU order we maintain. */
export class MemoryCache implements RequestCache {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;
  private costSavedUsd = 0;

  constructor(opts: MemoryCacheOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? 500);
    this.ttlMs = Math.max(0, opts.ttlMs ?? 0);
  }

  async get(key: string): Promise<FuguResult | undefined> {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt !== 0 && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU touch: re-insert so it becomes the most-recently-used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    this.costSavedUsd += entry.value.costUsd ?? 0;
    // Clone on the way out so a caller mutating raw/usage can't poison the stored entry.
    return structuredClone(entry.value);
  }

  async set(key: string, value: FuguResult): Promise<void> {
    this.entries.delete(key);
    // Clone on the way in so the caller's later mutations don't reach back into the cache.
    this.entries.set(key, {
      value: structuredClone(value),
      expiresAt: this.ttlMs > 0 ? Date.now() + this.ttlMs : 0,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Drop all entries (keeps cumulative hit/miss/costSaved counters). */
  clear(): void {
    this.entries.clear();
  }

  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, size: this.entries.size, costSavedUsd: this.costSavedUsd };
  }
}
