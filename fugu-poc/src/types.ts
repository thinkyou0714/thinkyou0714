/**
 * Result + usage types and tolerant parsers for the Fugu (OpenAI-compatible) API.
 *
 * Parsing stays tolerant at runtime (degrade gracefully), but unlike the original
 * PoC it surfaces `status`/`incomplete`/`finish_reason` instead of silently
 * returning "" — and exposes Fugu's hidden, billed orchestration token counts.
 */

export type ResponseStatus = "completed" | "incomplete" | "unknown";

export interface FuguUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  /** Fugu-specific: tokens spent by the hidden multi-agent orchestration (billed). */
  orchestrationInputTokens?: number;
  orchestrationOutputTokens?: number;
  orchestrationInputCachedTokens?: number;
  /** The raw `usage` object as returned, for forward-compat. */
  raw?: unknown;
}

export interface FuguToolCall {
  /** Tool-call id (Responses `call_id` / Chat `id`). */
  id: string;
  /** Function / tool name. */
  name: string;
  /** Raw JSON-string arguments as returned by the model. */
  arguments: string;
}

export interface FuguResult {
  /** Best-effort plain-text extraction of the model output. */
  text: string;
  /** Raw parsed JSON response from Fugu. */
  raw: unknown;
  /** Model id that was requested. */
  model: string;
  /** Response id (Responses API) — pass as `previous_response_id` to chain. */
  id?: string;
  /** "completed" | "incomplete" | "unknown" — no longer hidden behind an empty string. */
  status: ResponseStatus;
  /** Why a response was incomplete (e.g. "max_output_tokens", "content_filter"). */
  incompleteReason?: string;
  /** Chat Completions finish_reason for the first choice. */
  finishReason?: string;
  /** Typed token usage incl. orchestration split. */
  usage: FuguUsage;
  /** Estimated cost in USD from the price table (undefined if usage/price unknown). */
  costUsd?: number;
  /** `x-request-id` from the response, for support tickets. */
  requestId?: string;
  /** Parsed tool/function calls the model requested, if any. */
  toolCalls?: FuguToolCall[];
  /** True when this result was served from a RequestCache (no network call was made). */
  cached?: boolean;
}

function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tolerant usage parser covering Responses + Chat shapes and orchestration token fields. */
export function parseUsage(raw: unknown): FuguUsage {
  const u = getProp(raw, "usage");
  const inDetails = getProp(u, "input_tokens_details");
  const outDetails = getProp(u, "output_tokens_details");
  const firstDefined = (...vals: Array<number | undefined>): number | undefined =>
    vals.find((v) => v !== undefined);
  return {
    inputTokens: firstDefined(asNumber(getProp(u, "input_tokens")), asNumber(getProp(u, "prompt_tokens"))),
    outputTokens: firstDefined(
      asNumber(getProp(u, "output_tokens")),
      asNumber(getProp(u, "completion_tokens")),
    ),
    totalTokens: asNumber(getProp(u, "total_tokens")),
    cachedInputTokens: asNumber(getProp(inDetails, "cached_tokens")),
    orchestrationInputTokens: firstDefined(
      asNumber(getProp(inDetails, "orchestration_input_tokens")),
      asNumber(getProp(u, "orchestration_input_tokens")),
    ),
    orchestrationOutputTokens: firstDefined(
      asNumber(getProp(outDetails, "orchestration_output_tokens")),
      asNumber(getProp(u, "orchestration_output_tokens")),
    ),
    orchestrationInputCachedTokens: firstDefined(
      asNumber(getProp(inDetails, "orchestration_input_cached_tokens")),
      asNumber(getProp(u, "orchestration_input_cached_tokens")),
    ),
    raw: u,
  };
}

/** Extract id/status/incomplete/finish metadata from either API shape. */
export function parseResponseMeta(raw: unknown): {
  id?: string;
  status: ResponseStatus;
  incompleteReason?: string;
  finishReason?: string;
} {
  const idVal = getProp(raw, "id");
  const id = typeof idVal === "string" ? idVal : undefined;

  let status: ResponseStatus = "unknown";
  const statusVal = getProp(raw, "status");
  if (statusVal === "completed") status = "completed";
  else if (statusVal === "incomplete") status = "incomplete";

  const incDetails = getProp(raw, "incomplete_details");
  const reasonVal = getProp(incDetails, "reason");
  const incompleteReason = typeof reasonVal === "string" ? reasonVal : undefined;

  let finishReason: string | undefined;
  const choices = getProp(raw, "choices");
  if (Array.isArray(choices) && choices[0]) {
    const fr = getProp(choices[0], "finish_reason");
    if (typeof fr === "string") finishReason = fr;
  }

  if (status === "unknown") {
    if (finishReason === "stop") status = "completed";
    else if (finishReason && finishReason !== "stop") status = "incomplete";
    else if (incompleteReason) status = "incomplete";
  }

  return { id, status, incompleteReason, finishReason };
}

/** Extract text from a Responses API payload (prefers `output_text`, else aggregates). */
export function extractResponsesText(raw: unknown): string {
  const ot = getProp(raw, "output_text");
  if (typeof ot === "string" && ot !== "") return ot;
  const parts: string[] = [];
  const output = getProp(raw, "output");
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = getProp(item, "content");
      if (Array.isArray(content)) {
        for (const c of content) {
          const text = getProp(c, "text");
          const type = getProp(c, "type");
          if (typeof text === "string" && (type === "output_text" || type === undefined)) {
            parts.push(text);
          }
        }
      }
    }
  }
  return parts.join("");
}

/** Extract text from a Chat Completions payload. */
export function extractChatText(raw: unknown): string {
  const choices = getProp(raw, "choices");
  if (!Array.isArray(choices) || !choices[0]) return "";
  const content = getProp(getProp(choices[0], "message"), "content");
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof getProp(p, "text") === "string" ? (getProp(p, "text") as string) : ""))
      .join("");
  }
  return "";
}
