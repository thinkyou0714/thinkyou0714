/**
 * A/B comparison harness on top of the eval runner (roadmap #100, strategy capstone).
 *
 * Runs several named systems — e.g. `fugu`, `fugu-ultra`, a `Cascade`, or a stand-in for a
 * manual multi-model loop — over the SAME golden set, then ranks them on quality / cost /
 * latency and (the decision metric) quality-per-dollar. Also supports a neutral pairwise
 * LLM-judge for direct head-to-head "which answer is better" comparisons. Zero-dependency;
 * every system is just a `Responder`, so it is fully mockable.
 */

import type { Responder } from "./cascade.ts";
import type { ReasoningEffort } from "./config.ts";
import type { EvalCase, EvalReport, Grader, RunEvalOptions } from "./evals.ts";
import { runEval } from "./evals.ts";

/** A named system under test: a label + something that answers a prompt. */
export interface EvalSystem {
  name: string;
  client: Responder;
  /** Per-system generate options (model / effort) forwarded to each call. */
  generate?: RunEvalOptions["generate"];
}

export interface SystemSummary {
  name: string;
  report: EvalReport;
}

export interface ComparisonReport {
  systems: SystemSummary[];
  /** Winning system name on each axis (empty string if there are no systems). */
  best: { quality: string; cost: string; latency: string; qualityPerUsd: string };
}

export interface CompareOptions {
  grader: Grader;
  concurrency?: number;
  now?: () => number;
}

function rank(summaries: SystemSummary[]): ComparisonReport["best"] {
  const empty = { quality: "", cost: "", latency: "", qualityPerUsd: "" };
  if (summaries.length === 0) return empty;
  // `dir = -1` picks the max of `pick`, `dir = 1` picks the min; ties keep the first listed.
  const winner = (pick: (s: SystemSummary) => number, dir: number): string =>
    summaries.reduce((best, s) => (dir * (pick(s) - pick(best)) < 0 ? s : best)).name;
  return {
    quality: winner((s) => s.report.avgScore, -1),
    cost: winner((s) => s.report.totalCostUsd, 1),
    latency: winner((s) => s.report.avgLatencyMs, 1),
    qualityPerUsd: winner((s) => s.report.avgScore / Math.max(s.report.totalCostUsd, 1e-9), -1),
  };
}

/** Run several systems over the SAME golden set and rank them. Systems run sequentially
 *  (each `runEval` already parallelizes internally) to avoid cross-system quota bursts. */
export async function compareSystems(
  systems: EvalSystem[],
  cases: EvalCase[],
  opts: CompareOptions,
): Promise<ComparisonReport> {
  const summaries: SystemSummary[] = [];
  for (const system of systems) {
    const report = await runEval(system.client, cases, {
      grader: opts.grader,
      concurrency: opts.concurrency,
      generate: system.generate,
      now: opts.now,
    });
    summaries.push({ name: system.name, report });
  }
  return { systems: summaries, best: rank(summaries) };
}

export interface PairwiseVerdict {
  winner: "a" | "b" | "tie";
  reason?: string;
}

export type PairwiseJudge = (input: string, a: string, b: string) => Promise<PairwiseVerdict> | PairwiseVerdict;

/** Neutral pairwise LLM-judge: "which answer is better, A or B?" (reply A / B / TIE). */
export function llmPairwiseJudge(
  judge: Responder,
  opts: { model?: string; effort?: ReasoningEffort } = {},
): PairwiseJudge {
  return async (input, a, b) => {
    const prompt =
      'Two AI answers to the same question. Which is better? Reply with ONLY "A", "B", or "TIE".\n\n' +
      `QUESTION:\n${input}\n\nANSWER A:\n${a}\n\nANSWER B:\n${b}`;
    const judged = await judge.respond(prompt, { model: opts.model, reasoningEffort: opts.effort });
    const verdict = judged.text.trim().toUpperCase();
    if (verdict.startsWith("A")) return { winner: "a" };
    if (verdict.startsWith("B")) return { winner: "b" };
    return { winner: "tie" };
  };
}

export interface Head2HeadResult {
  a: string;
  b: string;
  aWins: number;
  bWins: number;
  ties: number;
  rows: Array<{ id: string; winner: "a" | "b" | "tie" }>;
}

/**
 * Head-to-head: answer every case with both systems and let a pairwise judge pick a winner.
 * The presentation order is swapped on alternate cases (and the verdict flipped back) to
 * cancel the judge's position bias.
 */
export async function headToHead(
  a: EvalSystem,
  b: EvalSystem,
  cases: EvalCase[],
  judge: PairwiseJudge,
): Promise<Head2HeadResult> {
  const rows: Head2HeadResult["rows"] = [];
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const [ra, rb] = await Promise.all([
      a.client.respond(c.input, a.generate),
      b.client.respond(c.input, b.generate),
    ]);
    const swap = i % 2 === 1; // present B first on odd cases to cancel position bias
    const raw = swap ? await judge(c.input, rb.text, ra.text) : await judge(c.input, ra.text, rb.text);
    let winner: "a" | "b" | "tie" = "tie";
    if (raw.winner !== "tie") {
      const favorsFirst = raw.winner === "a";
      winner = favorsFirst === !swap ? "a" : "b";
    }
    if (winner === "a") aWins++;
    else if (winner === "b") bWins++;
    else ties++;
    rows.push({ id: c.id, winner });
  }
  return { a: a.name, b: b.name, aWins, bWins, ties, rows };
}

/** Parse a JSONL golden set (one `{id,input,reference?,tags?}` per line). */
export function parseGoldenSet(jsonl: string): EvalCase[] {
  const cases: EvalCase[] = [];
  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const obj = JSON.parse(line) as Partial<EvalCase>;
    if (typeof obj.id !== "string" || typeof obj.input !== "string") {
      throw new Error(`golden set line ${i + 1}: each case needs string "id" and "input".`);
    }
    cases.push({ id: obj.id, input: obj.input, reference: obj.reference, tags: obj.tags });
  }
  return cases;
}

/** Render a comparison report as a Markdown table (handy for CI summaries / READMEs). */
export function formatComparison(report: ComparisonReport): string {
  const header = "| System | Pass % | Avg score | Cost $ | Avg latency ms | Quality/$ |";
  const sep = "|---|---|---|---|---|---|";
  const rows = report.systems.map((s) => {
    const r = s.report;
    const qpd = r.avgScore / Math.max(r.totalCostUsd, 1e-9);
    return `| ${s.name} | ${(r.passRate * 100).toFixed(0)}% | ${r.avgScore.toFixed(2)} | ${r.totalCostUsd.toFixed(4)} | ${r.avgLatencyMs.toFixed(0)} | ${qpd.toFixed(1)} |`;
  });
  const best = report.best;
  const footer = `\nBest — quality: **${best.quality}**, cost: **${best.cost}**, latency: **${best.latency}**, quality/$: **${best.qualityPerUsd}**`;
  return [header, sep, ...rows].join("\n") + footer;
}
