/**
 * Eval harness (roadmap #100): run a golden set against any `Responder`, grade each case
 * (exact / contains / neutral LLM-judge), and report quality + cost + latency — the
 * evidence to decide Fugu-orchestration vs a manual loop. Zero-dependency; concurrency is
 * bounded by the WorkPool so a large set doesn't burst quotas.
 */

import type { FuguResult } from "./types.ts";
import type { GenerateOptions } from "./fugu-client.ts";
import type { Responder } from "./cascade.ts";
import { parseScore01 } from "./cascade.ts";
import { WorkPool } from "./pool.ts";

export interface EvalCase {
  id: string;
  input: string;
  /** Optional reference answer for graders that compare against it. */
  reference?: string;
  tags?: string[];
}

export interface GradeResult {
  pass: boolean;
  /** 0..1 quality score. */
  score: number;
  reason?: string;
}

export type Grader = (evalCase: EvalCase, result: FuguResult) => Promise<GradeResult> | GradeResult;

export interface EvalRow {
  id: string;
  pass: boolean;
  score: number;
  costUsd: number;
  latencyMs: number;
  text: string;
  reason?: string;
  /** Set when the call itself threw (counts as a non-pass with score 0). */
  error?: string;
}

export interface EvalReport {
  rows: EvalRow[];
  total: number;
  passed: number;
  passRate: number;
  avgScore: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export interface RunEvalOptions {
  grader: Grader;
  /** Max concurrent cases (default 4). */
  concurrency?: number;
  /** Options forwarded to each `respond` call (model, effort, …). */
  generate?: GenerateOptions;
  /** Wall-clock source (injectable for tests); defaults to Date.now. */
  now?: () => number;
}

/** Pass when `reference` appears in the answer (case-insensitive by default). */
export function containsGrader(opts: { caseSensitive?: boolean } = {}): Grader {
  return (evalCase, result) => {
    const ref = evalCase.reference ?? "";
    if (!ref) return { pass: false, score: 0, reason: "no reference" };
    const hay = opts.caseSensitive ? result.text : result.text.toLowerCase();
    const needle = opts.caseSensitive ? ref : ref.toLowerCase();
    const pass = hay.includes(needle);
    return { pass, score: pass ? 1 : 0, reason: pass ? "contains reference" : "missing reference" };
  };
}

/** Pass on exact (trimmed) match against `reference`. */
export function exactGrader(): Grader {
  return (evalCase, result) => {
    const pass = result.text.trim() === (evalCase.reference ?? "").trim();
    return { pass, score: pass ? 1 : 0, reason: pass ? "exact" : "mismatch" };
  };
}

export interface LlmGraderOptions {
  model?: string;
  effort?: GenerateOptions["reasoningEffort"];
  /** Pass threshold on the 0..1 score (default 0.7). */
  threshold?: number;
}

/**
 * Neutral LLM-judge grader: asks a (ideally different-family) model to score the answer
 * 0..1 against the reference. Keep the judge distinct from the system under test.
 */
export function llmGrader(judge: Responder, opts: LlmGraderOptions = {}): Grader {
  const threshold = opts.threshold ?? 0.7;
  return async (evalCase, result) => {
    const ref = evalCase.reference ? `\n\nREFERENCE ANSWER:\n${evalCase.reference}` : "";
    const prompt =
      "Score how well the ANSWER addresses the QUESTION" +
      (evalCase.reference ? " given the REFERENCE ANSWER" : "") +
      ", from 0.0 (wrong) to 1.0 (fully correct). Reply with ONLY the number.\n\n" +
      `QUESTION:\n${evalCase.input}${ref}\n\nANSWER:\n${result.text}`;
    const judged = await judge.respond(prompt, { model: opts.model, reasoningEffort: opts.effort });
    const score = parseScore01(judged.text);
    return { pass: score >= threshold, score, reason: `llm-grader:${score.toFixed(2)}` };
  };
}

function summarize(rows: EvalRow[]): EvalReport {
  const total = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const sum = (pick: (r: EvalRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  return {
    rows,
    total,
    passed,
    passRate: total ? passed / total : 0,
    avgScore: total ? sum((r) => r.score) / total : 0,
    totalCostUsd: sum((r) => r.costUsd),
    avgLatencyMs: total ? sum((r) => r.latencyMs) / total : 0,
  };
}

/** Run `cases` against `client`, grade each, and aggregate a report. */
export async function runEval(client: Responder, cases: EvalCase[], opts: RunEvalOptions): Promise<EvalReport> {
  const now = opts.now ?? Date.now;
  const pool = new WorkPool(opts.concurrency ?? 4);
  const rows = await pool.map(cases, async (evalCase): Promise<EvalRow> => {
    const start = now();
    try {
      const result = await client.respond(evalCase.input, opts.generate);
      const latencyMs = now() - start;
      const grade = await opts.grader(evalCase, result);
      return {
        id: evalCase.id,
        pass: grade.pass,
        score: grade.score,
        costUsd: result.costUsd ?? 0,
        latencyMs,
        text: result.text,
        reason: grade.reason,
      };
    } catch (err) {
      return {
        id: evalCase.id,
        pass: false,
        score: 0,
        costUsd: 0,
        latencyMs: now() - start,
        text: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  return summarize(rows);
}
