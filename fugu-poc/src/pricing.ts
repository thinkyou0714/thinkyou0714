/**
 * Per-model price table + cost estimation.
 *
 * Fugu bills hidden orchestration tokens (which can exceed the visible tokens), so
 * cost is computed over surface + orchestration tokens. Prices are stamped with
 * `asOf` — verify against your console dashboard; treat as estimates.
 */

import type { FuguUsage } from "./types.ts";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cachedInputPerMTok?: number;
  currency: string;
  /** When this price was recorded (prices drift — keep this honest). */
  asOf: string;
}

export type PriceTable = Record<string, ModelPrice>;

/** Best-known public rates (per 1M tokens), 2026-06. NOT verified against a live bill. */
export const DEFAULT_PRICES: PriceTable = {
  fugu: { inputPerMTok: 1.25, outputPerMTok: 10, currency: "USD", asOf: "2026-06" },
  "fugu-ultra": {
    inputPerMTok: 5,
    outputPerMTok: 30,
    cachedInputPerMTok: 0.5,
    currency: "USD",
    asOf: "2026-06",
  },
};

/** Strip a dated snapshot suffix, e.g. `fugu-ultra-20260615` -> `fugu-ultra`. */
export function baseModelId(model: string): string {
  const m = model.match(/^(fugu(?:-ultra)?)/);
  return m ? m[1] : model;
}

/**
 * Estimate USD cost from usage. Includes orchestration tokens (billed) and applies
 * the cached-input rate to cached tokens. Returns undefined if price/usage unknown.
 */
export function computeCost(
  model: string,
  usage: FuguUsage,
  table: PriceTable = DEFAULT_PRICES,
): number | undefined {
  const price = table[model] ?? table[baseModelId(model)];
  if (!price) return undefined;

  // Orchestration tokens are treated as ADDITIONAL to the surface tokens, matching the
  // observed Fugu usage split (surface vs orchestration reported as separate totals).
  // If Fugu's `input_tokens` later proves inclusive of orchestration, this over-counts —
  // it is a documented estimate; verify against a real bill.
  const inputTokens = (usage.inputTokens ?? 0) + (usage.orchestrationInputTokens ?? 0);
  const outputTokens = (usage.outputTokens ?? 0) + (usage.orchestrationOutputTokens ?? 0);
  const cachedTokens = (usage.cachedInputTokens ?? 0) + (usage.orchestrationInputCachedTokens ?? 0);
  if (inputTokens === 0 && outputTokens === 0) return undefined;

  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  const cachedRate = price.cachedInputPerMTok ?? price.inputPerMTok;
  const inputCost = (uncachedInput * price.inputPerMTok + cachedTokens * cachedRate) / 1_000_000;
  const outputCost = (outputTokens * price.outputPerMTok) / 1_000_000;
  return inputCost + outputCost;
}
