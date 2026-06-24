import { test } from "node:test";
import assert from "node:assert/strict";

import type { Responder } from "../src/cascade.ts";
import type { FuguResult } from "../src/types.ts";
import { containsGrader } from "../src/evals.ts";
import {
  compareSystems,
  parseGoldenSet,
  headToHead,
  llmPairwiseJudge,
  formatComparison,
} from "../src/eval-compare.ts";
import type { EvalSystem, PairwiseJudge } from "../src/eval-compare.ts";

function result(text: string, extra: Partial<FuguResult> = {}): FuguResult {
  return { text, raw: {}, model: "fugu", status: "completed", usage: {}, ...extra };
}

const fixed = (text: string, costUsd = 0): Responder => ({
  async respond() {
    return result(text, { costUsd });
  },
});

test("compareSystems ranks systems per axis (quality / cost / quality-per-$)", async () => {
  const systems: EvalSystem[] = [
    { name: "premium", client: fixed("Paris", 0.05) }, // correct, expensive
    { name: "mid", client: fixed("Paris", 0.002) }, // correct, cheap -> best quality/$
    { name: "cheap", client: fixed("London", 0.001) }, // wrong, cheapest
  ];
  const report = await compareSystems(systems, [{ id: "a", input: "capital of France?", reference: "Paris" }], {
    grader: containsGrader(),
  });

  assert.equal(report.systems.length, 3);
  assert.equal(report.best.quality, "premium"); // tie at 1.0 -> first listed
  assert.equal(report.best.cost, "cheap");
  assert.equal(report.best.qualityPerUsd, "mid");
});

test("parseGoldenSet parses JSONL, skips blanks, and rejects malformed cases", () => {
  const jsonl = '{"id":"a","input":"q1","reference":"r"}\n\n{"id":"b","input":"q2","tags":["x"]}\n';
  const cases = parseGoldenSet(jsonl);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].reference, "r");
  assert.deepEqual(cases[1].tags, ["x"]);
  assert.throws(() => parseGoldenSet('{"input":"no id"}'), /needs string/);
});

test("headToHead tallies wins and cancels position bias across the swap", async () => {
  const a: EvalSystem = { name: "A", client: fixed("good answer") };
  const b: EvalSystem = { name: "B", client: fixed("bad answer") };
  // Judge favours whichever presented answer contains "good", regardless of slot.
  const judge: PairwiseJudge = (_input, x, _y) => (x.includes("good") ? { winner: "a" } : { winner: "b" });
  // 2 cases exercise both the non-swapped (even) and swapped (odd) presentation paths.
  const h2h = await headToHead(
    a,
    b,
    [
      { id: "c0", input: "q" },
      { id: "c1", input: "q" },
    ],
    judge,
  );
  assert.equal(h2h.aWins, 2, "A wins both, even after the odd-case order swap is undone");
  assert.equal(h2h.bWins, 0);
  assert.deepEqual(
    h2h.rows.map((r) => r.winner),
    ["a", "a"],
  );
});

test("llmPairwiseJudge maps A / B / TIE replies", async () => {
  const a = await llmPairwiseJudge(fixed("A is better"))("q", "x", "y");
  const b = await llmPairwiseJudge(fixed("B"))("q", "x", "y");
  const tie = await llmPairwiseJudge(fixed("TIE"))("q", "x", "y");
  assert.equal(a.winner, "a");
  assert.equal(b.winner, "b");
  assert.equal(tie.winner, "tie");
});

test("formatComparison renders a Markdown table with the best-by-axis footer", async () => {
  const report = await compareSystems(
    [
      { name: "fugu", client: fixed("Paris", 0.01) },
      { name: "fugu-ultra", client: fixed("Paris", 0.08) },
    ],
    [{ id: "a", input: "capital of France?", reference: "Paris" }],
    { grader: containsGrader() },
  );
  const md = formatComparison(report);
  assert.match(md, /\| System \| Pass % \|/);
  assert.match(md, /fugu-ultra/);
  assert.match(md, /Best — quality:/);
});
