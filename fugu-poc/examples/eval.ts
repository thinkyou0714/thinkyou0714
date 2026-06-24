#!/usr/bin/env node
/**
 * Strategy eval (roadmap #100): compare `fugu` vs `fugu-ultra` vs a confidence `Cascade`
 * over the golden set, graded by a neutral LLM-judge, and print a quality/cost/latency
 * table — the evidence for "Fugu-orchestration vs a manual multi-model loop". Live; gated
 * on SAKANA_API_KEY.
 *
 *   SAKANA_API_KEY=... node --experimental-strip-types examples/eval.ts
 *
 * NOTE: a trustworthy judge must be a DIFFERENT model family than the systems under test
 * (no self-grading). Here it defaults to `fugu-ultra` as a placeholder — for a real run,
 * point `judge` at Claude/OpenAI (e.g. via the proxy/router) by setting JUDGE_BASE_URL.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  FuguClient,
  loadConfig,
  MemoryCache,
  Cascade,
  llmGrader,
  compareSystems,
  parseGoldenSet,
  formatComparison,
} from "../src/index.ts";
import type { Responder } from "../src/index.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  // Cache identical calls so re-runs (and the judge re-asking) don't re-spend.
  const client = new FuguClient({ ...config, cache: new MemoryCache() });

  const goldenPath = join(dirname(fileURLToPath(import.meta.url)), "golden-set.jsonl");
  const cases = parseGoldenSet(readFileSync(goldenPath, "utf8"));

  // The cascade exposed as a plain Responder: try fugu, escalate to fugu-ultra when unsure.
  const cascade = new Cascade(client, { stages: [{ model: "fugu" }, { model: "fugu-ultra", effort: "high" }] });
  const cascadeSystem: Responder = { respond: (input) => cascade.run(input).then((outcome) => outcome.result) };

  // Neutral judge — swap in a different provider for a real eval (see the file header).
  const judgeBaseUrl = process.env.JUDGE_BASE_URL;
  const judge = judgeBaseUrl ? new FuguClient({ ...config, baseUrl: judgeBaseUrl }) : client;
  const grader = llmGrader(judge, { model: "fugu-ultra", threshold: 0.7 });

  const report = await compareSystems(
    [
      { name: "fugu", client, generate: { model: "fugu" } },
      { name: "fugu-ultra", client, generate: { model: "fugu-ultra", reasoningEffort: "high" } },
      { name: "cascade", client: cascadeSystem },
    ],
    cases,
    { grader, concurrency: 3 },
  );

  process.stdout.write(`${formatComparison(report)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
