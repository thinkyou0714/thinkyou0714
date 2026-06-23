/**
 * Observability hooks — a dependency-free seam for logging/tracing/metrics. The
 * core never imports pino/OpenTelemetry; wire them in via these hooks. Prompt and
 * response *content* are deliberately NOT included (privacy by default) — only model,
 * status, latency, token usage, cost, and request id.
 */

import type { FuguUsage } from "./types.ts";
import type { FuguError } from "./errors.ts";

export interface RequestEvent {
  path: string;
  model: string;
  /** 0-based attempt index (incremented on retry). */
  attempt: number;
}

export interface ResponseEvent {
  path: string;
  model: string;
  status: string;
  durationMs: number;
  usage?: FuguUsage;
  costUsd?: number;
  requestId?: string;
  error?: FuguError;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: Logger = {
  debug() {},
  warn() {},
};
