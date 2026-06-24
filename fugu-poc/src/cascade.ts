/**
 * Confidence-gated model cascade (roadmap #37): try the cheap model first, judge the
 * answer, and escalate to a stronger model only when the judge isn't confident — fugu →
 * (judge) → fugu-ultra → … . Zero-dependency; works against any `Responder` (FuguClient
 * satisfies it structurally) so it is unit-testable with a mock.
 */

import { createHash } from "node:crypto";
import type { FuguResult } from "./types.ts";
import type { GenerateOptions } from "./fugu-client.ts";
import type { ReasoningEffort } from "./config.ts";

export interface Responder {
  respond(input: string, opts?: GenerateOptions): Promise<FuguResult>;
}

export interface CascadeStage {
  model: string;
  effort?: ReasoningEffort;
}

export interface JudgeVerdict {
  confident: boolean;
  /** Optional 0..1 confidence score (LLM-judge); informational. */
  score?: number;
  reason?: string;
}

export type Judge = (
  input: string,
  result: FuguResult,
  stage: CascadeStage,
) => Promise<JudgeVerdict> | JudgeVerdict;

export interface CascadeOptions {
  /** Ordered stages, cheapest first. Required, non-empty. */
  stages: CascadeStage[];
  /** Gates escalation after each non-final stage (default: `statusJudge`). */
  judge?: Judge;
  /** Called when a stage's answer is rejected and the cascade escalates. */
  onEscalate?: (info: {
    fromIndex: number;
    from: CascadeStage;
    to: CascadeStage;
    verdict: JudgeVerdict;
  }) => void;
  /**
   * Optional decision memory (input-hash → stage index). When present, a prompt seen to
   * need escalation starts at that stage next time, skipping the wasted cheap call + judge.
   */
  startStage?: Map<string, number>;
}

export interface CascadeOutcome {
  result: FuguResult;
  stage: CascadeStage;
  stageIndex: number;
  /** How many times the cascade escalated before settling. */
  escalations: number;
  /** Verdicts collected from the judge, in order. */
  verdicts: JudgeVerdict[];
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

/**
 * Parse a model-emitted confidence into 0..1. Handles the canonical `0.85` / `1.0`, a bare
 * `85` (→ 0.85), and `8 out of 10` / `8/10` ratios — without being fooled by version-like
 * prefixes ("v2 score 0.8" → 0.8, not 0.02) or negatives.
 */
export function parseScore01(text: string): number {
  const t = text.trim();
  // "x / y" or "x out of y" ratio.
  const ratio = t.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)/i);
  if (ratio) {
    const den = Number(ratio[2]);
    if (den > 0) return clamp01(Number(ratio[1]) / den);
  }
  // Canonical 0..1 decimal (0, 0.x, 1, 1.0, .x) — not part of a larger or negative number.
  const dec = t.match(/(?<![\d.-])(0(?:\.\d+)?|1(?:\.0+)?|\.\d+)(?![\d.])/);
  if (dec) return clamp01(Number(dec[0]));
  // Bare integer or percentage ("85", "85%") → divide by 100.
  const pct = t.match(/(?<![\d.-])(\d{1,3})\s*%?(?![\d.])/);
  if (pct) return clamp01(Number(pct[1]) / 100);
  return 0;
}

/**
 * Zero-cost heuristic judge: not confident when the answer is incomplete or empty.
 * Typed as synchronous (still assignable to `Judge`) so callers can read the verdict directly.
 */
export const statusJudge = (_input: string, result: FuguResult, _stage: CascadeStage): JudgeVerdict => {
  if (result.status === "incomplete") {
    return { confident: false, reason: `incomplete:${result.incompleteReason ?? "unknown"}` };
  }
  if (!result.text.trim()) return { confident: false, reason: "empty" };
  return { confident: true };
};

export interface LlmJudgeOptions {
  model?: string;
  effort?: ReasoningEffort;
  /** Confidence threshold to accept an answer (default 0.7). */
  threshold?: number;
}

/** An LLM-as-judge: asks a model to rate the answer 0..1 and accepts at/above the threshold. */
export function llmJudge(judge: Responder, opts: LlmJudgeOptions = {}): Judge {
  const threshold = opts.threshold ?? 0.7;
  return async (input, result) => {
    const prompt =
      "Rate how confident you are that the ANSWER correctly and completely addresses the " +
      "QUESTION, from 0.0 (wrong/uncertain) to 1.0 (clearly correct). Reply with ONLY the number.\n\n" +
      `QUESTION:\n${input}\n\nANSWER:\n${result.text}`;
    const judged = await judge.respond(prompt, { model: opts.model, reasoningEffort: opts.effort });
    const score = parseScore01(judged.text);
    return { confident: score >= threshold, score, reason: `llm-judge:${score.toFixed(2)}` };
  };
}

function hashInput(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class Cascade {
  private readonly client: Responder;
  private readonly options: CascadeOptions;

  constructor(client: Responder, options: CascadeOptions) {
    if (!options.stages || options.stages.length === 0) {
      throw new Error("Cascade requires at least one stage.");
    }
    this.client = client;
    this.options = options;
  }

  async run(input: string, opts: GenerateOptions = {}): Promise<CascadeOutcome> {
    const { stages, judge = statusJudge, onEscalate, startStage } = this.options;
    const key = startStage ? hashInput(input) : "";
    let index = startStage?.get(key) ?? 0;
    if (index >= stages.length) index = stages.length - 1;
    if (index < 0) index = 0;

    const verdicts: JudgeVerdict[] = [];
    let escalations = 0;
    let result: FuguResult | undefined;

    for (; index < stages.length; index++) {
      const stage = stages[index];
      result = await this.client.respond(input, { ...opts, model: stage.model, reasoningEffort: stage.effort });
      if (index === stages.length - 1) break; // last stage: accept whatever it returns
      const verdict = await judge(input, result, stage);
      verdicts.push(verdict);
      if (verdict.confident) break;
      onEscalate?.({ fromIndex: index, from: stage, to: stages[index + 1], verdict });
      escalations++;
    }

    // result is always assigned (stages is non-empty and the loop runs at least once).
    const finalResult = result as FuguResult;
    startStage?.set(key, index);
    return { result: finalResult, stage: stages[index], stageIndex: index, escalations, verdicts };
  }
}
