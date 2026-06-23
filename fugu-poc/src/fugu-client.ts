/**
 * Fugu API client (OpenAI-compatible). Built-in global `fetch` — no runtime deps.
 *
 *   - POST /responses          (Responses API — recommended for generation)
 *   - POST /chat/completions   (Chat Completions API)
 *
 * P0: typed error hierarchy, secret redaction, timeout/abort/network classification,
 *     effort-scaled timeouts, typed usage + cost (incl. Fugu orchestration tokens).
 * P2: retries (backoff + jitter, honoring Retry-After) with an idempotency key,
 *     streaming (SSE), a spend BudgetGuard, and output-token / input-size caps.
 */

import { randomUUID } from "node:crypto";
import { normalizeBaseUrl, defaultTimeoutMs } from "./config.ts";
import type { FuguConfig, ReasoningEffort } from "./config.ts";
import {
  FuguError,
  FuguConfigError,
  FuguConnectionError,
  FuguTimeoutError,
  FuguAbortError,
  FuguParseError,
  FuguIncompleteError,
  FuguBadRequestError,
  errorFromResponse,
} from "./errors.ts";
import { computeCost, DEFAULT_PRICES } from "./pricing.ts";
import type { PriceTable } from "./pricing.ts";
import { parseUsage, parseResponseMeta, extractResponsesText, extractChatText } from "./types.ts";
import type { FuguResult } from "./types.ts";
import { DEFAULT_RETRY, retryDelayMs, sleep } from "./retry.ts";
import type { RetryConfig } from "./retry.ts";
import {
  parseSSE,
  extractStreamDelta,
  extractStreamFinal,
  extractStreamUsage,
  extractStreamFinishReason,
} from "./stream.ts";
import type { BudgetGuard } from "./budget.ts";

export type { FuguResult, FuguUsage, ResponseStatus } from "./types.ts";
export * from "./errors.ts";

export interface FuguClientOptions extends FuguConfig {
  /** Inject a fetch implementation (defaults to global fetch). Handy for tests. */
  fetch?: typeof fetch;
  /** Override the per-request timeout (ms). When unset, an effort/model-scaled default is used. */
  timeoutMs?: number;
  /** Price table for cost estimation (defaults to the built-in table). */
  priceTable?: PriceTable;
  /** Max retries after the first attempt for transient failures (default 2). */
  maxRetries?: number;
  /** Backoff base / cap (ms) — full-jitter exponential backoff (defaults 500 / 8000). */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Hard cap applied to requested max output tokens. */
  maxOutputTokens?: number;
  /** Reject inputs longer than this many characters (default 4,000,000; 0 disables). */
  maxInputChars?: number;
  /** Optional spend guard; throws FuguBudgetError once the limit would be exceeded. */
  budget?: BudgetGuard;
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
  /** Override the retry count for this call. */
  maxRetries?: number;
  /** Per-call output-token cap (clamped to the client's maxOutputTokens). */
  maxOutputTokens?: number;
  /** Reuse a specific Idempotency-Key (defaults to a fresh UUID per logical request). */
  idempotencyKey?: string;
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

export interface FuguStreamEvent {
  type: "delta" | "done";
  /** Present on "delta" events: the incremental text. */
  textDelta?: string;
  /** Present on the terminal "done" event: the aggregated result. */
  result?: FuguResult;
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
  private readonly retry: RetryConfig;
  private readonly maxOutputTokens?: number;
  private readonly maxInputChars: number;
  private readonly budget?: BudgetGuard;

  constructor(options: FuguClientOptions) {
    this.apiKey = (options.apiKey ?? "").trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutOverrideMs = options.timeoutMs;
    this.priceTable = options.priceTable ?? DEFAULT_PRICES;
    this.retry = {
      maxRetries: options.maxRetries ?? DEFAULT_RETRY.maxRetries,
      baseMs: options.retryBaseMs ?? DEFAULT_RETRY.baseMs,
      maxMs: options.retryMaxMs ?? DEFAULT_RETRY.maxMs,
    };
    this.maxOutputTokens = options.maxOutputTokens;
    this.maxInputChars = options.maxInputChars ?? 4_000_000;
    this.budget = options.budget;
    if (typeof this.fetchImpl !== "function") {
      throw new FuguConfigError("No fetch implementation available. Use Node >= 18 or pass options.fetch.");
    }
  }

  /** Responses API (recommended). `input` is the user prompt. */
  async respond(input: string, opts: GenerateOptions = {}): Promise<FuguResult> {
    this.guardInput(input.length);
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, input };
    if (opts.instructions) body.instructions = opts.instructions;
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    this.applyOutputCap(body, "max_output_tokens", opts);
    const { json, requestId } = await this.request("/responses", body, model, opts);
    return this.buildResult(json, model, extractResponsesText(json), requestId, opts);
  }

  /** Chat Completions API. */
  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<FuguResult> {
    this.guardInput(messages.reduce((n, m) => n + m.content.length, 0));
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, messages };
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    this.applyOutputCap(body, "max_completion_tokens", opts);
    const { json, requestId } = await this.request("/chat/completions", body, model, opts);
    return this.buildResult(json, model, extractChatText(json), requestId, opts);
  }

  /** Streaming Responses API. Yields text deltas then a terminal aggregated result. */
  async *respondStream(input: string, opts: GenerateOptions = {}): AsyncGenerator<FuguStreamEvent> {
    this.guardInput(input.length);
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, input, stream: true };
    if (opts.instructions) body.instructions = opts.instructions;
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    this.applyOutputCap(body, "max_output_tokens", opts);
    yield* this.stream("/responses", body, model, "responses", opts);
  }

  /** Streaming Chat Completions API. */
  async *chatStream(messages: ChatMessage[], opts: GenerateOptions = {}): AsyncGenerator<FuguStreamEvent> {
    this.guardInput(messages.reduce((n, m) => n + m.content.length, 0));
    const model = opts.model ?? this.model;
    const body: Record<string, unknown> = { ...(opts.params ?? {}), model, messages, stream: true };
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
    // Ask the API to emit a final usage chunk so cost / BudgetGuard work for chat streams.
    body.stream_options ??= { include_usage: true };
    this.applyOutputCap(body, "max_completion_tokens", opts);
    yield* this.stream("/chat/completions", body, model, "chat", opts);
  }

  private requireApiKey(): void {
    if (!this.apiKey) {
      throw new FuguConfigError(
        "Missing SAKANA_API_KEY. Get a key from https://console.sakana.ai/get-started and set it in your environment.",
      );
    }
  }

  private guardInput(chars: number): void {
    if (this.maxInputChars > 0 && chars > this.maxInputChars) {
      throw new FuguBadRequestError(`Input too large: ${chars} chars > maxInputChars ${this.maxInputChars}.`);
    }
  }

  private applyOutputCap(body: Record<string, unknown>, field: string, opts: GenerateOptions): void {
    const current = typeof body[field] === "number" ? (body[field] as number) : undefined;
    const requested = opts.maxOutputTokens ?? current;
    const cap = this.maxOutputTokens;
    if (requested !== undefined) body[field] = cap !== undefined ? Math.min(requested, cap) : requested;
    else if (cap !== undefined) body[field] = cap;
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
    this.budget?.record(result.costUsd);
    if (opts.throwOnIncomplete && meta.status === "incomplete") {
      throw new FuguIncompleteError(
        `Fugu response incomplete${meta.incompleteReason ? `: ${meta.incompleteReason}` : ""}`,
        { requestId },
      );
    }
    return result;
  }

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    return headers;
  }

  /** Map a thrown fetch/stream error to a typed FuguError (timeout/abort/network). */
  private classifyError(
    err: unknown,
    callerSignal: AbortSignal | undefined,
    path: string,
    timeoutMs: number,
  ): FuguError {
    if (err instanceof FuguError) return err;
    if (callerSignal?.aborted) return new FuguAbortError("Request aborted by caller.", { cause: err });
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return new FuguTimeoutError(`Request to ${path} timed out after ${timeoutMs}ms.`, { cause: err });
    }
    const reason = err instanceof Error ? err.message : String(err);
    return new FuguConnectionError(`Request to ${path} failed: ${reason}`, { cause: err });
  }

  /** A single fetch with timeout/abort/network classification (no body consumed). */
  private async doFetch(
    url: string,
    init: RequestInit,
    path: string,
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
  ): Promise<Response> {
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal });
    } catch (err) {
      throw this.classifyError(err, callerSignal, path, timeoutMs);
    }
  }

  private async sendOnce(
    path: string,
    body: unknown,
    model: string,
    opts: GenerateOptions,
    idempotencyKey: string,
  ): Promise<RawResponse> {
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = opts.timeoutMs ?? this.timeoutOverrideMs ?? defaultTimeoutMs(model, opts.reasoningEffort);
    const res = await this.doFetch(
      url,
      { method: "POST", headers: this.headers(idempotencyKey), body: JSON.stringify(body) },
      path,
      timeoutMs,
      opts.signal,
    );
    const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-requestid") ?? undefined;
    let rawText: string;
    try {
      rawText = await res.text();
    } catch (err) {
      throw this.classifyError(err, opts.signal, path, timeoutMs);
    }
    if (!res.ok) throw errorFromResponse(res.status, rawText, res.headers);
    if (!rawText) return { json: {}, requestId };
    try {
      return { json: JSON.parse(rawText), requestId };
    } catch {
      throw new FuguParseError(`Failed to parse Fugu response as JSON (${path}).`, {
        status: res.status,
        requestId,
      });
    }
  }

  private async request(
    path: string,
    body: unknown,
    model: string,
    opts: GenerateOptions,
  ): Promise<RawResponse> {
    this.requireApiKey();
    this.budget?.check();
    const idempotencyKey = opts.idempotencyKey ?? randomUUID();
    const maxRetries = opts.maxRetries ?? this.retry.maxRetries;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendOnce(path, body, model, opts, idempotencyKey);
      } catch (err) {
        if (!(err instanceof FuguError) || !err.isRetryable || attempt >= maxRetries) throw err;
        await sleep(retryDelayMs(err, attempt, this.retry), opts.signal);
      }
    }
  }

  private async *stream(
    path: string,
    body: unknown,
    model: string,
    kind: "responses" | "chat",
    opts: GenerateOptions,
  ): AsyncGenerator<FuguStreamEvent> {
    this.requireApiKey();
    this.budget?.check();
    const url = `${this.baseUrl}${path}`;
    const timeoutMs = opts.timeoutMs ?? this.timeoutOverrideMs ?? defaultTimeoutMs(model, opts.reasoningEffort);
    const res = await this.doFetch(
      url,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
      path,
      timeoutMs,
      opts.signal,
    );
    const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-requestid") ?? undefined;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw errorFromResponse(res.status, text, res.headers);
    }
    if (!res.body) throw new FuguParseError(`No response body to stream (${path}).`, { requestId });

    let text = "";
    let finalResponse: unknown;
    let usage: unknown;
    let finishReason: string | undefined;
    try {
      for await (const msg of parseSSE(res.body)) {
        if (msg.data === "[DONE]") break;
        let json: unknown;
        try {
          json = JSON.parse(msg.data);
        } catch {
          continue;
        }
        const delta = extractStreamDelta(json);
        if (delta) {
          text += delta;
          yield { type: "delta", textDelta: delta };
        }
        const f = extractStreamFinal(json);
        if (f !== undefined) finalResponse = f;
        const u = extractStreamUsage(json);
        if (u !== undefined) usage = u;
        const fr = extractStreamFinishReason(json);
        if (fr !== undefined) finishReason = fr;
      }
    } catch (err) {
      throw this.classifyError(err, opts.signal, path, timeoutMs);
    }

    // Prefer the API's terminal payload; otherwise synthesize from accumulated text +
    // any captured usage WITHOUT claiming "completed" (a truncated stream must not look done).
    let raw: unknown;
    if (finalResponse !== undefined) {
      raw = finalResponse;
    } else if (kind === "responses") {
      raw = usage !== undefined ? { output_text: text, usage } : { output_text: text };
    } else {
      const choice: Record<string, unknown> = { message: { content: text } };
      if (finishReason !== undefined) choice.finish_reason = finishReason;
      raw = usage !== undefined ? { choices: [choice], usage } : { choices: [choice] };
    }
    const baseText = kind === "responses" ? extractResponsesText(raw) : extractChatText(raw);
    const result = this.buildResult(raw, model, baseText || text, requestId, {
      ...opts,
      throwOnIncomplete: false,
    });
    yield { type: "done", result };
  }
}

/** Build a client straight from a loaded config. */
export function createClient(
  config: FuguConfig,
  extra: Omit<FuguClientOptions, keyof FuguConfig> = {},
): FuguClient {
  return new FuguClient({ ...config, ...extra });
}

// Re-export the pure parsers/helpers as part of the public surface.
export { extractResponsesText, extractChatText, parseUsage, parseResponseMeta } from "./types.ts";
