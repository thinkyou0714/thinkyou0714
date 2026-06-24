/**
 * Typed error hierarchy for the Fugu client.
 *
 * Callers can branch on `error.code` (or `instanceof`), read `isRetryable`, and
 * get supportable metadata (`status`, `requestId`, `retryAfterMs`, `apiError`)
 * WITHOUT the raw response body — which could echo the `Authorization` header on
 * a misrouted proxy. Messages are redacted at construction time.
 */

import { redactString } from "./redact.ts";

export type FuguErrorCode =
  | "config"
  | "auth"
  | "permission"
  | "rate_limit"
  | "bad_request"
  | "api"
  | "timeout"
  | "connection"
  | "aborted"
  | "parse"
  | "incomplete"
  | "budget"
  | "validation";

/** Whitelisted, length-capped view of an API error envelope. Never the raw body. */
export interface ParsedApiError {
  message?: string;
  type?: string;
  code?: string;
}

export interface FuguErrorOptions {
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  apiError?: ParsedApiError;
  cause?: unknown;
}

export class FuguError extends Error {
  readonly code: FuguErrorCode;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly apiError?: ParsedApiError;

  constructor(message: string, code: FuguErrorCode, options: FuguErrorOptions = {}) {
    super(redactString(message), options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "FuguError";
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
    this.apiError = options.apiError;
  }

  /** Whether a retry could plausibly succeed. */
  get isRetryable(): boolean {
    switch (this.code) {
      case "timeout":
      case "connection":
      case "rate_limit":
        return true;
      case "api":
        return this.status !== undefined && this.status >= 500;
      default:
        return false;
    }
  }
}

export class FuguConfigError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "config", options);
    this.name = "FuguConfigError";
  }
}
export class FuguAuthError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "auth", options);
    this.name = "FuguAuthError";
  }
}
export class FuguPermissionError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "permission", options);
    this.name = "FuguPermissionError";
  }
}
export class FuguRateLimitError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "rate_limit", options);
    this.name = "FuguRateLimitError";
  }
}
export class FuguBadRequestError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "bad_request", options);
    this.name = "FuguBadRequestError";
  }
}
export class FuguAPIError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "api", options);
    this.name = "FuguAPIError";
  }
}
export class FuguTimeoutError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "timeout", options);
    this.name = "FuguTimeoutError";
  }
}
export class FuguConnectionError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "connection", options);
    this.name = "FuguConnectionError";
  }
}
export class FuguAbortError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "aborted", options);
    this.name = "FuguAbortError";
  }
}
export class FuguParseError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "parse", options);
    this.name = "FuguParseError";
  }
}
export class FuguIncompleteError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "incomplete", options);
    this.name = "FuguIncompleteError";
  }
}
export class FuguBudgetError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "budget", options);
    this.name = "FuguBudgetError";
  }
}
export class FuguValidationError extends FuguError {
  constructor(message: string, options: FuguErrorOptions = {}) {
    super(message, "validation", options);
    this.name = "FuguValidationError";
  }
}

function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * Parse an API error envelope into whitelisted, redacted, length-capped fields.
 * The raw body is never retained.
 */
export function parseApiError(body: string): ParsedApiError | undefined {
  if (!body) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { message: redactString(body.slice(0, 200)) };
  }
  const pick = (o: unknown): ParsedApiError => {
    const result: ParsedApiError = {};
    const message = getProp(o, "message");
    const type = getProp(o, "type");
    const code = getProp(o, "code");
    if (typeof message === "string") result.message = redactString(message.slice(0, 512));
    if (typeof type === "string") result.type = type;
    if (typeof code === "string") result.code = code;
    return result;
  };
  const errObj = getProp(parsed, "error");
  if (typeof errObj === "string") return { message: redactString(errObj.slice(0, 512)) };
  if (errObj && typeof errObj === "object") return pick(errObj);
  const top = pick(parsed);
  return Object.keys(top).length > 0 ? top : undefined;
}

/** Parse a `Retry-After` header (numeric seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Map an HTTP error response to the right typed error (never storing the raw body). */
export function errorFromResponse(status: number, body: string, headers: Headers): FuguError {
  const apiError = parseApiError(body);
  const requestId = headers.get("x-request-id") ?? headers.get("x-requestid") ?? undefined;
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
  const detail = apiError?.message ? `: ${apiError.message}` : "";
  const message = `Fugu API error ${status}${detail}`;
  const options: FuguErrorOptions = { status, requestId, retryAfterMs, apiError };
  switch (status) {
    case 401:
      return new FuguAuthError(message, options);
    case 403:
      return new FuguPermissionError(message, options);
    case 429:
      return new FuguRateLimitError(message, options);
    case 400:
    case 404:
    case 422:
      return new FuguBadRequestError(message, options);
    default:
      return new FuguAPIError(message, options);
  }
}
