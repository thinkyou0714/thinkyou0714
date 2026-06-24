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
export type { FuguResult, FuguUsage, ResponseStatus, FuguToolCall } from "./types.ts";

export { functionTool, webSearchTool, mapToolsForResponses, mapToolsForChat, parseToolCalls } from "./tools.ts";
export type { FuguTool, ToolChoice } from "./tools.ts";
export { parseJsonLoose } from "./json.ts";
export { Conversation } from "./conversation.ts";
export { noopLogger } from "./observe.ts";
export type { Logger, RequestEvent, ResponseEvent } from "./observe.ts";

export { FuguRouter } from "./router.ts";
export type { RouterProvider, RoutedResult, FuguRouterOptions } from "./router.ts";
export { createProxyServer } from "./proxy.ts";
export type { ProxyOptions, ProxyBackend } from "./proxy.ts";

export * from "./errors.ts";

export { BudgetGuard } from "./budget.ts";
export type { BudgetOptions } from "./budget.ts";

export { MemoryCache, cacheKeyFor } from "./cache.ts";
export type { RequestCache, MemoryCacheOptions, CacheStats } from "./cache.ts";

export { WorkPool, SingleFlight } from "./pool.ts";

export { Cascade, statusJudge, llmJudge, parseScore01 } from "./cascade.ts";
export type {
  Responder,
  CascadeStage,
  CascadeOptions,
  CascadeOutcome,
  Judge,
  JudgeVerdict,
  LlmJudgeOptions,
} from "./cascade.ts";

export { runEval, containsGrader, exactGrader, llmGrader } from "./evals.ts";
export type {
  EvalCase,
  EvalReport,
  EvalRow,
  Grader,
  GradeResult,
  RunEvalOptions,
  LlmGraderOptions,
} from "./evals.ts";

export {
  compareSystems,
  headToHead,
  llmPairwiseJudge,
  parseGoldenSet,
  formatComparison,
} from "./eval-compare.ts";
export type {
  EvalSystem,
  SystemSummary,
  ComparisonReport,
  CompareOptions,
  PairwiseJudge,
  PairwiseVerdict,
  Head2HeadResult,
} from "./eval-compare.ts";

export { chooseModel } from "./routing.ts";
export type { FuguModel, RouteTask, RouteInput, RoutingPolicy } from "./routing.ts";

export {
  parseSSE,
  extractStreamDelta,
  extractStreamFinal,
  extractStreamUsage,
  extractStreamFinishReason,
} from "./stream.ts";
export type { SSEMessage } from "./stream.ts";

export { DEFAULT_RETRY, retryDelayMs, fullJitterBackoff, sleep } from "./retry.ts";
export type { RetryConfig } from "./retry.ts";

export { redact, redactString } from "./redact.ts";

export { computeCost, DEFAULT_PRICES, baseModelId } from "./pricing.ts";
export type { ModelPrice, PriceTable } from "./pricing.ts";

export { loadConfig, normalizeBaseUrl, defaultTimeoutMs, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./config.ts";
export type { FuguConfig, ReasoningEffort, LoadConfigOptions } from "./config.ts";
