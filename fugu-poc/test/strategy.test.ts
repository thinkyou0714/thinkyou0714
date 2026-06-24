import { test } from "node:test";
import assert from "node:assert/strict";

import { Cascade, statusJudge, llmJudge, parseScore01 } from "../src/cascade.ts";
import type { Responder } from "../src/cascade.ts";
import { runEval, containsGrader, exactGrader, llmGrader } from "../src/evals.ts";
import type { EvalCase } from "../src/evals.ts";
import type { FuguResult } from "../src/types.ts";

function result(text: string, extra: Partial<FuguResult> = {}): FuguResult {
  return { text, raw: {}, model: "fugu", status: "completed", usage: {}, ...extra };
}

/** A Responder whose reply depends on the requested model; records the models it saw. */
function modelResponder(byModel: Record<string, FuguResult>) {
  const models: string[] = [];
  const client: Responder = {
    async respond(_input, opts) {
      const model = opts?.model ?? "fugu";
      models.push(model);
      return byModel[model] ?? result("", { model });
    },
  };
  return { client, models };
}

// ---------- parseScore01 ----------

test("parseScore01 clamps and tolerates percentage-style scores", () => {
  assert.equal(parseScore01("0.85"), 0.85);
  assert.equal(parseScore01("score: 0.4 out of 1"), 0.4);
  assert.equal(parseScore01("85"), 0.85);
  assert.equal(parseScore01("1.0"), 1);
  assert.equal(parseScore01("nonsense"), 0);
});

test("parseScore01 resists version prefixes, ratios, and negatives", () => {
  assert.equal(parseScore01("v2 score 0.8"), 0.8); // not 0.02 from the "2" in "v2"
  assert.equal(parseScore01("8 out of 10"), 0.8); // not 0.08
  assert.equal(parseScore01("8/10"), 0.8);
  assert.equal(parseScore01("-0.5"), 0); // negative rejected
  assert.equal(parseScore01("0"), 0);
  assert.equal(parseScore01("0.0"), 0);
  assert.equal(parseScore01("100"), 1); // 100% -> clamped to 1
});

// ---------- Cascade ----------

test("Cascade stops at the cheap stage when the judge is confident", async () => {
  const { client, models } = modelResponder({ fugu: result("good answer") });
  const cascade = new Cascade(client, { stages: [{ model: "fugu" }, { model: "fugu-ultra" }] });
  const outcome = await cascade.run("q");
  assert.equal(outcome.result.text, "good answer");
  assert.equal(outcome.stageIndex, 0);
  assert.equal(outcome.escalations, 0);
  assert.deepEqual(models, ["fugu"]);
});

test("Cascade escalates to the stronger model when the cheap answer is incomplete", async () => {
  const { client, models } = modelResponder({
    fugu: result("", { status: "incomplete", incompleteReason: "max_output_tokens" }),
    "fugu-ultra": result("full answer"),
  });
  const escalated: string[] = [];
  const cascade = new Cascade(client, {
    stages: [{ model: "fugu" }, { model: "fugu-ultra", effort: "high" }],
    onEscalate: (info) => escalated.push(`${info.from.model}->${info.to.model}`),
  });
  const outcome = await cascade.run("q");
  assert.equal(outcome.result.text, "full answer");
  assert.equal(outcome.stageIndex, 1);
  assert.equal(outcome.escalations, 1);
  assert.deepEqual(models, ["fugu", "fugu-ultra"]);
  assert.deepEqual(escalated, ["fugu->fugu-ultra"]);
});

test("Cascade accepts the last stage even if the judge would reject it", async () => {
  const { client } = modelResponder({
    fugu: result("", { status: "incomplete" }),
    "fugu-ultra": result("", { status: "incomplete" }),
  });
  const cascade = new Cascade(client, { stages: [{ model: "fugu" }, { model: "fugu-ultra" }] });
  const outcome = await cascade.run("q");
  assert.equal(outcome.stageIndex, 1, "settles on the final stage");
  assert.equal(outcome.escalations, 1);
});

test("Cascade startStage memory skips the cheap stage for a known-hard prompt", async () => {
  const { client, models } = modelResponder({
    fugu: result("", { status: "incomplete" }),
    "fugu-ultra": result("answer"),
  });
  const startStage = new Map<string, number>();
  const cascade = new Cascade(client, { stages: [{ model: "fugu" }, { model: "fugu-ultra" }], startStage });

  await cascade.run("hard prompt"); // escalates: fugu then fugu-ultra
  assert.deepEqual(models, ["fugu", "fugu-ultra"]);
  models.length = 0;

  await cascade.run("hard prompt"); // remembered -> straight to fugu-ultra
  assert.deepEqual(models, ["fugu-ultra"]);
});

test("llmJudge accepts at/above threshold and rejects below", async () => {
  const judge = llmJudge(
    {
      async respond() {
        return result("0.9");
      },
    },
    { threshold: 0.7 },
  );
  const high = await judge("q", result("a"), { model: "fugu" });
  assert.equal(high.confident, true);
  assert.equal(high.score, 0.9);

  const lowJudge = llmJudge(
    {
      async respond() {
        return result("0.3");
      },
    },
    { threshold: 0.7 },
  );
  const low = await lowJudge("q", result("a"), { model: "fugu" });
  assert.equal(low.confident, false);
});

test("statusJudge is confident only for a non-empty completed answer", () => {
  assert.equal(statusJudge("q", result("hi"), { model: "fugu" }).confident, true);
  assert.equal(statusJudge("q", result(""), { model: "fugu" }).confident, false);
  assert.equal(statusJudge("q", result("x", { status: "incomplete" }), { model: "fugu" }).confident, false);
});

// ---------- evals ----------

const CASES: EvalCase[] = [
  { id: "a", input: "capital of France?", reference: "Paris" },
  { id: "b", input: "2+2?", reference: "4" },
];

test("runEval scores a golden set and aggregates cost/latency", async () => {
  let tick = 0;
  const client: Responder = {
    async respond(input) {
      return result(input.includes("France") ? "It is Paris." : "5", { costUsd: 0.01 });
    },
  };
  const report = await runEval(client, CASES, {
    grader: containsGrader(),
    now: () => (tick += 10), // deterministic latency: start then end differ by 10
  });
  assert.equal(report.total, 2);
  assert.equal(report.passed, 1); // "Paris" matches; "5" != "4"
  assert.equal(report.passRate, 0.5);
  assert.equal(Number(report.totalCostUsd.toFixed(2)), 0.02);
  assert.ok(report.avgLatencyMs > 0);
  const rowA = report.rows.find((r) => r.id === "a");
  assert.equal(rowA?.pass, true);
});

test("runEval records a thrown call as a non-pass with the error", async () => {
  const client: Responder = {
    async respond() {
      throw new Error("boom");
    },
  };
  const report = await runEval(client, [{ id: "x", input: "q" }], { grader: exactGrader() });
  assert.equal(report.passed, 0);
  assert.equal(report.rows[0].error, "boom");
  assert.equal(report.rows[0].score, 0);
});

test("llmGrader passes/fails on the neutral judge's score", async () => {
  const judge: Responder = {
    async respond() {
      return result("0.95");
    },
  };
  const report = await runEval(
    {
      async respond() {
        return result("an answer");
      },
    },
    [{ id: "a", input: "q", reference: "ref" }],
    {
      grader: llmGrader(judge, { threshold: 0.8 }),
    },
  );
  assert.equal(report.passed, 1);
  assert.equal(report.rows[0].score, 0.95);
});

test("runEval treats a throwing grader as a non-pass error row (not a crash)", async () => {
  const client: Responder = {
    async respond() {
      return result("an answer");
    },
  };
  const report = await runEval(client, [{ id: "a", input: "q" }], {
    grader: () => {
      throw new Error("grader boom");
    },
  });
  assert.equal(report.passed, 0);
  assert.equal(report.rows[0].error, "grader boom");
});

test("runEval aggregates an empty case list without dividing by zero", async () => {
  const client: Responder = {
    async respond() {
      return result("");
    },
  };
  const report = await runEval(client, [], { grader: exactGrader() });
  assert.deepEqual(
    [report.total, report.passRate, report.avgScore, report.avgLatencyMs, report.totalCostUsd],
    [0, 0, 0, 0, 0],
  );
});
