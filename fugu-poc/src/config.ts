/**
 * Configuration loading + small helpers for the Fugu PoC client.
 * Zero runtime dependencies.
 */

export interface FuguConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Best-known public base URL. Copy the exact value from https://console.sakana.ai if it differs. */
export const DEFAULT_BASE_URL = "https://api.sakana.ai/v1";

/** "fugu" = fast / low-latency, "fugu-ultra" = max quality. */
export const DEFAULT_MODEL = "fugu-ultra";

/** Fugu accepts these `reasoning.effort` values (other values are rejected). */
export type ReasoningEffort = "high" | "xhigh" | "max";

export interface LoadConfigOptions {
  /** Defaults to process.env. Inject a map for tests. */
  env?: Record<string, string | undefined>;
}

/** Strip trailing slashes so we can safely concatenate paths. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Default per-request timeout. Fugu's orchestration latency is unbounded relative
 * to a single model — a flat 60s aborts legitimate `fugu-ultra` / high-effort runs —
 * so the default scales with the model and reasoning effort.
 */
export function defaultTimeoutMs(model: string, effort?: ReasoningEffort): number {
  if (effort === "xhigh" || effort === "max") return 30 * 60_000; // 30 min
  if (model.startsWith("fugu-ultra")) return 10 * 60_000; // 10 min
  return 120_000; // 2 min
}

/**
 * Read configuration from the environment.
 *
 * Does NOT throw when the API key is missing — callers decide how to handle that
 * (the client throws a typed error at request time; the CLI prints friendly help).
 */
export function loadConfig(options: LoadConfigOptions = {}): FuguConfig {
  const env = options.env ?? process.env;
  const apiKey = (env.SAKANA_API_KEY ?? "").trim();
  const baseUrl = normalizeBaseUrl((env.SAKANA_BASE_URL ?? "").trim() || DEFAULT_BASE_URL);
  const model = (env.FUGU_MODEL ?? "").trim() || DEFAULT_MODEL;
  return { apiKey, baseUrl, model };
}
