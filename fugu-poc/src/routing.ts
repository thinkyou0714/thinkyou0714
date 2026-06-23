/**
 * Model-selection policy: default to the cheaper `fugu`, escalate to `fugu-ultra`
 * only on clear signals (long context past the price cliff, high effort, or a
 * task class that benefits from max quality). Pure function — call it yourself or
 * pass the result as `respond(..., { model })`.
 */

import type { ReasoningEffort } from "./config.ts";

export type FuguModel = "fugu" | "fugu-ultra";

export type RouteTask = "code" | "reasoning" | "research" | "chat" | "draft" | "other";

export interface RouteInput {
  /** Approximate prompt size in characters. */
  chars: number;
  effort?: ReasoningEffort;
  task?: RouteTask;
}

export interface RoutingPolicy {
  /**
   * Character count above which to prefer `fugu-ultra` (Fugu's price tier jumps past
   * ~272K tokens; ~1.1M chars is a rough proxy — tune to taste).
   */
  contextCliffChars?: number;
  /** Task classes that escalate to `fugu-ultra`. */
  escalateTasks?: RouteTask[];
}

export function chooseModel(input: RouteInput, policy: RoutingPolicy = {}): FuguModel {
  const cliff = policy.contextCliffChars ?? 1_100_000;
  const escalate = policy.escalateTasks ?? ["code", "reasoning", "research"];
  if (input.effort === "xhigh" || input.effort === "max") return "fugu-ultra";
  if (input.chars >= cliff) return "fugu-ultra";
  if (input.task && escalate.includes(input.task)) return "fugu-ultra";
  return "fugu";
}
