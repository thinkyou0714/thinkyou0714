/**
 * Minimal Fugu API client (OpenAI-compatible).
 * Uses the built-in global `fetch` — no runtime dependencies.
 *
 *   - POST /responses          (Responses API — recommended by Sakana for generation)
 *   - POST /chat/completions   (Chat Completions API)
 *
 * P0 hardening: typed error hierarchy, secret redaction, timeout-vs-abort-vs-network
 * classification, effort-scaled timeouts, and typed usage + cost (incl. Fugu's hidden
 * orchestration tokens) — instead of a single stringly-typed error and an `unknown` usage.
 */

import { normalizeBaseUrl, defaultTimeoutMs } from "./config.ts";
import type { FuguConfig, ReasoningEffort } from "./config.ts";
import {
  FuguConfigError,
  FuguConnectionError,
  FuguTimeoutError,
  FuguAbortError,
  FuguParseError,
  FuguIncompleteError,
  errorFromResponse,
} from "./errors.ts";
import { computeCost, DEFAULT_PRICES } from "./pricing.ts";
import type { PriceTable } from "./pricing.ts";
import {
  parseUsage,
  parseResponseMeta,
  extractResponsesText,
  extractChatText,
} from "./types.ts";
import type { FuguResult } from "./types.ts";

export type { FuguResult, FuguUsage, ResponseStatus } from "./types.ts";
export * from "./errors.ts";

export interface FuguClientOptions extends FuguConfig {
  /** Inject a fetch implementation (defaults to global fetch). Handy for tests. */
  fetch?: typeof fetch;
  /** Override the per-request timeout (ms). When unset, an effort/model-scaled default is used. */
  timeoutMs?: number;
  /** Price table for cost estimation (defaults to the built-in table). */
  priceTable?: PriceTable;
}

export interface GenerateOptions {
  /** Override the configured model for this call. */
  model?: string;
  /** Reasoning effort (high/xhigh/max) — also scales the default timeout. */
  reasoningEffort?: ReasoningEffort;
  /** Responses API `instructions` (system/developer guidance). */
  instructions?: string;
  /** Abort signal; combined with the internal timeout via AbortSignal.any. */
  signal?: AbortSignal;
  /** Override the timeout for this call (ms). */
  timeoutMs?: number;
  /** Throw FuguIncompleteError when the response status is "incomplete". */
  throwOnIncomplete?: boolean;
  /** Extra body params merged into the request (e.g. { temperature: 0.2 }). */
  params?: Record<string, unknown>;
}

export type ChatRole = "system" | "developer" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface RawResponse {
  json: unknown;
  requestId?: string;
}

export class FuguClient {
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutOverrideMs?: number;
  private readonly priceTable: PriceTable;

  constructor(options: FuguClientOptions) {
    this.apiKey = (options.apiKey ?? "").trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutOverrideMs = options.timeoutMs;
    this.priceTable = options.priceTable ?? DEFAULT_PRICES;
    if (typeof this.fetchImpl !== "function") {
      throw new FuguConfigError("No fetch implementation available. Use Node >= 18 or pass options.fetch.");
    }
  }

  /** Responses API (recommended). `input` is the user prompt. */
  async respond(input: string, opts: GenerateOptions = {}): Promise<FuguResult> {
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, input };
    if (opts.instructions) body.instructions = opts.instructions;
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    const { json, requestId } = await this.request("/responses", body, model, opts);
    return this.buildResult(json, model, extractResponsesText(json), requestId, opts);
  }

  /** Chat Completions API. */
  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<FuguResult> {
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, messages };
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    const { json, requestId } = await this.request("/chat/completions", body, model, opts);
    return this.buildResult(json, model, extractChatText(json), requestId, opts);
  }

  private buildResult(
    raw: unknown,
    model: string,
    text: string,
    requestId: string | undefined,
    opts: GenerateOptions,
  ): FuguResult {
    const meta = parseResponseMeta(raw);
    const usage = parseUsage(raw);
    const result: FuguResult = {
      text,
      raw,
      model,
      id: meta.id,
      status: meta.status,
      incompleteReason: meta.incompleteReason,
      finishReason: meta.finishReason,
      usage,
      costUsd: computeCost(model, usage, this.priceTable),
      requestId,
    };
    if (opts.throwOnIncomplete && meta.status === "incomplete") {
      throw new FuguIncompleteError(
        `Fugu response incomplete${meta.incompleteReason ? `: ${meta.incompleteReason}` : ""}`,
        { requestId },
      );
    }
    return result;
  }

  private async request(
    path: string,
    body: unknown,
    model: string,
    opts: GenerateOptions,
  ): Promise<RawResponse> {
    if (!this.apiKey) {
      throw new FuguConfigError(
        "Missing SAKANA_API_KEY. Get a key from https://console.sakana.ai/get-started and set it in your environment.",
      );
    }
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = opts.timeoutMs ?? this.timeoutOverrideMs ?? defaultTimeoutMs(model, opts.reasoningEffort);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Caller-initiated cancellation wins; then timeout; otherwise it's a connection error.
      if (opts.signal?.aborted) {
        throw new FuguAbortError("Request aborted by caller.", { cause: err });
      }
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new FuguTimeoutError(`Request to ${path} timed out after ${timeoutMs}ms.`, { cause: err });
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new FuguConnectionError(`Request to ${path} failed: ${reason}`, { cause: err });
    }

    const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-requestid") ?? undefined;
    const rawText = await res.text();
    if (!res.ok) {
      throw errorFromResponse(res.status, rawText, res.headers);
    }
    if (!rawText) return { json: {}, requestId };
    try {
      return { json: JSON.parse(rawText), requestId };
    } catch {
      throw new FuguParseError(`Failed to parse Fugu response as JSON (${path}).`, { status: res.status, requestId });
    }
  }
}

/** Build a client straight from a loaded config. */
export function createClient(
  config: FuguConfig,
  extra: { fetch?: typeof fetch; timeoutMs?: number; priceTable?: PriceTable } = {},
): FuguClient {
  return new FuguClient({ ...config, ...extra });
}

// Re-export the pure parsers/helpers as part of the public surface.
export { extractResponsesText, extractChatText, parseUsage, parseResponseMeta } from "./types.ts";
