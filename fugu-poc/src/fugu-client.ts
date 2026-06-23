/**
 * Minimal Fugu API client (OpenAI-compatible).
 * Uses the built-in global `fetch` — no runtime dependencies.
 *
 * Fugu exposes the standard OpenAI-compatible surface. This client covers the two
 * generation endpoints:
 *   - POST /responses          (Responses API — recommended by Sakana for generation)
 *   - POST /chat/completions   (Chat Completions API)
 */

import { normalizeBaseUrl } from "./config.ts";
import type { FuguConfig } from "./config.ts";

export interface FuguClientOptions extends FuguConfig {
  /** Inject a fetch implementation (defaults to global fetch). Handy for tests. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms (default 60s). */
  timeoutMs?: number;
}

export interface GenerateOptions {
  /** Override the configured model for this call. */
  model?: string;
  /** Abort signal; combined with the internal timeout via AbortSignal.any. */
  signal?: AbortSignal;
  /** Override the timeout for this call. */
  timeoutMs?: number;
  /** Extra body params merged into the request (e.g. { temperature: 0.2 }). */
  params?: Record<string, unknown>;
}

export interface FuguResult {
  /** Best-effort plain-text extraction of the model output. */
  text: string;
  /** Raw parsed JSON response from Fugu. */
  raw: unknown;
  /** `usage` block if the API returned one. */
  usage?: unknown;
  /** Model id that was actually requested. */
  model: string;
}

export type ChatRole = "system" | "developer" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export class FuguError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts: { status?: number; body?: string } = {}) {
    super(message);
    this.name = "FuguError";
    this.status = opts.status;
    this.body = opts.body;
  }
}

export class FuguClient {
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: FuguClientOptions) {
    this.apiKey = (options.apiKey ?? "").trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.model = options.model;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (typeof this.fetchImpl !== "function") {
      throw new FuguError("No fetch implementation available. Use Node >= 18 or pass options.fetch.");
    }
  }

  /** Responses API (recommended). `input` is the user prompt. */
  async respond(input: string, opts: GenerateOptions = {}): Promise<FuguResult> {
    const model = opts.model ?? this.model;
    const raw = await this.request("/responses", { ...(opts.params ?? {}), model, input }, opts);
    return { text: extractResponsesText(raw), raw, usage: pickUsage(raw), model };
  }

  /** Chat Completions API. */
  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<FuguResult> {
    const model = opts.model ?? this.model;
    const raw = await this.request("/chat/completions", { ...(opts.params ?? {}), model, messages }, opts);
    return { text: extractChatText(raw), raw, usage: pickUsage(raw), model };
  }

  private async request(path: string, body: unknown, opts: GenerateOptions): Promise<unknown> {
    if (!this.apiKey) {
      throw new FuguError(
        "Missing SAKANA_API_KEY. Get a key from https://console.sakana.ai/get-started and set it in your environment.",
      );
    }
    const url = `${this.baseUrl}${path}`;

    // Always enforce the timeout; combine it with the caller's signal if one was given.
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
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
      const reason = err instanceof Error ? err.message : String(err);
      throw new FuguError(`Request to ${url} failed: ${reason}`);
    }

    const rawText = await res.text();
    if (!res.ok) {
      throw new FuguError(
        `Fugu API error ${res.status} ${res.statusText || ""}`.trim() + ` (${path})`,
        { status: res.status, body: rawText },
      );
    }
    if (!rawText) return {};
    try {
      return JSON.parse(rawText);
    } catch {
      throw new FuguError(`Failed to parse Fugu response as JSON (${path}).`, { body: rawText });
    }
  }
}

/** Build a client straight from a loaded config. */
export function createClient(
  config: FuguConfig,
  extra: { fetch?: typeof fetch; timeoutMs?: number } = {},
): FuguClient {
  return new FuguClient({ ...config, ...extra });
}

function pickUsage(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "usage" in raw) {
    return (raw as { usage?: unknown }).usage;
  }
  return undefined;
}

/** Extract text from a Responses API payload. */
export function extractResponsesText(raw: unknown): string {
  const obj = raw as { output_text?: unknown; output?: unknown };
  // Prefer the convenience field, but only when it actually carries content
  // (empty string -> fall through to aggregate the structured output array).
  if (typeof obj?.output_text === "string" && obj.output_text !== "") {
    return obj.output_text;
  }
  const parts: string[] = [];
  const output = obj?.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = (item as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const part = c as { type?: unknown; text?: unknown };
          if (typeof part?.text === "string" && (part.type === "output_text" || part.type === undefined)) {
            parts.push(part.text);
          }
        }
      }
    }
  }
  return parts.join("");
}

/** Extract text from a Chat Completions API payload. */
export function extractChatText(raw: unknown): string {
  const choices = (raw as { choices?: unknown })?.choices;
  const first = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } }) : undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : ""))
      .join("");
  }
  return "";
}
