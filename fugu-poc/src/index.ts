/**
 * Public API surface for the Fugu client library.
 *
 * This curated barrel is the ONLY entry point consumers import from
 * (`import { FuguClient } from "fugu-poc"`). Deep imports are not part of the
 * supported surface.
 */

export { FuguClient, createClient } from "./fugu-client.ts";
export type {
  FuguClientOptions,
  GenerateOptions,
  ChatMessage,
  ChatRole,
  FuguStreamEvent,
} from "./fugu-client.ts";

export { parseUsage, parseResponseMeta, extractResponsesText, extractChatText } from "./types.ts";
export type { FuguResult, FuguUsage, ResponseStatus } from "./types.ts";

export * from "./errors.ts";

export { BudgetGuard } from "./budget.ts";
export type { BudgetOptions } from "./budget.ts";

export { chooseModel } from "./routing.ts";
export type { FuguModel, RouteTask, RouteInput, RoutingPolicy } from "./routing.ts";

export { parseSSE, extractStreamDelta, extractStreamFinal } from "./stream.ts";
export type { SSEMessage } from "./stream.ts";

export { DEFAULT_RETRY, retryDelayMs, fullJitterBackoff, sleep } from "./retry.ts";
export type { RetryConfig } from "./retry.ts";

export { redact, redactString } from "./redact.ts";

export { computeCost, DEFAULT_PRICES, baseModelId } from "./pricing.ts";
export type { ModelPrice, PriceTable } from "./pricing.ts";

export { loadConfig, normalizeBaseUrl, defaultTimeoutMs, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./config.ts";
export type { FuguConfig, ReasoningEffort, LoadConfigOptions } from "./config.ts";
