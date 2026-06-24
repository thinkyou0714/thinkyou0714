#!/usr/bin/env node
/**
 * Live smoke test: prove a real round-trip against `api.sakana.ai` works with your key.
 *
 *   SAKANA_API_KEY=... npm run smoke
 *   SAKANA_API_KEY=... node --experimental-strip-types examples/smoke.ts "optional prompt"
 *
 * Unlike the unit tests (mocked `fetch`), this hits the network. It does ONE minimal
 * Responses call, prints a PASS/FAIL banner with latency + usage, and on failure maps the
 * typed FuguError to a concrete fix. Exit codes: 0 = pass, 1 = reached the API but failed,
 * 2 = not configured (no SAKANA_API_KEY) — so CI can treat "no key" as a skip, not a break.
 *
 * The diagnosis/run/format helpers are pure (no I/O) so they are unit-tested offline.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.ts";
import type { ReasoningEffort } from "../src/config.ts";
import { FuguClient } from "../src/fugu-client.ts";
import type { GenerateOptions } from "../src/fugu-client.ts";
import { FuguError } from "../src/errors.ts";
import { redactString } from "../src/redact.ts";
import type { FuguResult } from "../src/types.ts";

/** Exit codes — distinct so callers/CI can tell "broken" from "not set up". */
export const SMOKE_EXIT = { pass: 0, fail: 1, notConfigured: 2 } as const;

/** The slice of FuguClient the smoke run needs — lets tests inject a stub. */
export interface SmokeResponder {
  respond(input: string, opts?: GenerateOptions): Promise<FuguResult>;
}

export interface RunSmokeOptions {
  baseUrl: string;
  model: string;
  /** Prompt override (default: a tiny deterministic one). */
  prompt?: string;
  effort?: ReasoningEffort;
  signal?: AbortSignal;
}

export interface SmokeReport {
  ok: boolean;
  baseUrl: string;
  model: string;
  latencyMs: number;
  status?: string;
  snippet?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  requestId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Actionable next step (set on failure, or on an empty/incomplete success). */
  hint?: string;
}

export interface Diagnosis {
  code: string;
  title: string;
  hint: string;
}

const DEFAULT_PROMPT = "Reply with the single word: pong";

/** Map any thrown error to a concrete, actionable remediation. Pure — no I/O. */
export function diagnose(err: unknown): Diagnosis {
  if (!(err instanceof FuguError)) {
    return {
      code: "unknown",
      title: "Unexpected error",
      hint: "Not a FuguError — see the message above. Likely an environment/runtime issue, not the API.",
    };
  }
  const status = err.status;
  switch (err.code) {
    case "auth":
      return {
        code: "auth",
        title: "Authentication failed (401)",
        hint:
          "SAKANA_API_KEY is missing, wrong, or expired. Re-copy it from " +
          "https://console.sakana.ai/get-started and set SAKANA_API_KEY.",
      };
    case "permission":
      return {
        code: "permission",
        title: "Permission denied (403)",
        hint:
          "The key is valid but not allowed here. Confirm your plan grants access to this model and " +
          "region in the Sakana console (fugu-ultra may require a higher tier).",
      };
    case "rate_limit":
      return {
        code: "rate_limit",
        title: "Rate limited (429)",
        hint: "Too many requests. Wait a few seconds, retry, and lower your concurrency.",
      };
    case "bad_request":
      return {
        code: "bad_request",
        title: `Request rejected${status ? ` (${status})` : ""}`,
        hint:
          status === 404
            ? "Model or endpoint not found. Verify the model id and that SAKANA_BASE_URL ends in the " +
              "OpenAI-compatible path (default https://api.sakana.ai/v1)."
            : "The request was rejected. Check the model id (fugu / fugu-ultra) and any extra params.",
      };
    case "connection":
      return {
        code: "connection",
        title: "Could not reach the server",
        hint:
          "Network/DNS/proxy failure, or the base URL is wrong. Verify SAKANA_BASE_URL (default " +
          "https://api.sakana.ai/v1) — copy the exact value from your console — and your connection.",
      };
    case "timeout":
      return {
        code: "timeout",
        title: "Request timed out",
        hint:
          "fugu-ultra / high-effort runs can take minutes — raise the timeout or retry. If it times out " +
          "instantly every time, the base URL or host is likely wrong.",
      };
    case "parse":
      return {
        code: "parse",
        title: "Response was not valid JSON",
        hint:
          "Reached a server, but it did not return Fugu JSON (e.g. an HTML error page from a proxy). " +
          "Check that SAKANA_BASE_URL points at the Fugu OpenAI-compatible endpoint.",
      };
    case "api":
      return {
        code: "api",
        title: `Server error${status ? ` (${status})` : ""}`,
        hint: "Transient error on the Fugu side. Retry shortly; check the Sakana status page if it persists.",
      };
    case "incomplete":
      return {
        code: "incomplete",
        title: "Response incomplete",
        hint: "The model stopped early (often the output-token cap). Raise max output tokens or simplify.",
      };
    case "config":
      return {
        code: "config",
        title: "Configuration error",
        hint: "Set SAKANA_API_KEY (and optionally SAKANA_BASE_URL / FUGU_MODEL). See .env.example.",
      };
    case "aborted":
      return {
        code: "aborted",
        title: "Request aborted",
        hint: "The smoke run was cancelled via AbortSignal before a response arrived.",
      };
    case "budget":
      return {
        code: "budget",
        title: "Budget exceeded",
        hint: "A BudgetGuard spend cap was hit before the call. Raise or reset the budget to continue.",
      };
    default:
      return { code: err.code, title: `Fugu error (${err.code})`, hint: "See the error message above." };
  }
}

function errMessage(err: unknown): string {
  return redactString(err instanceof Error ? err.message : String(err));
}

/**
 * Run one minimal round-trip and return a structured report. Never throws — a thrown
 * FuguError becomes `{ ok: false, errorCode, hint }`. `client` is any `{ respond }`.
 */
export async function runSmoke(client: SmokeResponder, opts: RunSmokeOptions): Promise<SmokeReport> {
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const start = Date.now();
  try {
    const result = await client.respond(prompt, { reasoningEffort: opts.effort, signal: opts.signal });
    const latencyMs = Date.now() - start;
    const text = (result.text ?? "").trim();
    const ok = text.length > 0;
    const report: SmokeReport = {
      ok,
      baseUrl: opts.baseUrl,
      model: result.model || opts.model,
      latencyMs,
      status: result.status,
      snippet: text.slice(0, 80),
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      costUsd: result.costUsd,
      requestId: result.requestId,
    };
    if (!ok) {
      report.hint = "The call succeeded but returned empty text. Try a different prompt or model.";
    } else if (result.status === "incomplete") {
      report.hint = "Response was incomplete — raise max output tokens if the reply looks truncated.";
    }
    return report;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const d = diagnose(err);
    return {
      ok: false,
      baseUrl: opts.baseUrl,
      model: opts.model,
      latencyMs,
      status: err instanceof FuguError && err.status !== undefined ? String(err.status) : undefined,
      requestId: err instanceof FuguError ? err.requestId : undefined,
      errorCode: d.code,
      errorMessage: errMessage(err),
      hint: d.hint,
    };
  }
}

function formatUsage(report: SmokeReport): string | undefined {
  const parts: string[] = [];
  if (report.inputTokens !== undefined) parts.push(`in=${report.inputTokens}`);
  if (report.outputTokens !== undefined) parts.push(`out=${report.outputTokens}`);
  if (report.costUsd !== undefined) parts.push(`cost≈$${report.costUsd.toFixed(6)}`);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** Render a human banner for the report. Pure. */
export function formatSmoke(report: SmokeReport): string {
  const lines = [
    `Fugu smoke test: ${report.ok ? "PASS" : "FAIL"}`,
    `  endpoint : ${report.baseUrl}`,
    `  model    : ${report.model}`,
    `  latency  : ${report.latencyMs} ms`,
  ];
  if (report.requestId) lines.push(`  request  : ${report.requestId}`);
  if (report.ok) {
    if (report.snippet) lines.push(`  reply    : ${JSON.stringify(report.snippet)}`);
    const usage = formatUsage(report);
    if (usage) lines.push(`  usage    : ${usage}`);
    if (report.hint) lines.push(`  note     : ${report.hint}`);
  } else {
    if (report.errorCode) {
      lines.push(
        `  error    : [${report.errorCode}${report.status ? ` ${report.status}` : ""}] ${report.errorMessage ?? ""}`.trimEnd(),
      );
    }
    if (report.hint) lines.push(`  fix      : ${report.hint}`);
  }
  return lines.join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const prompt = argv
    .filter((a) => !a.startsWith("-"))
    .join(" ")
    .trim();
  const config = loadConfig();
  if (!config.apiKey) {
    process.stderr.write(
      "Fugu smoke test: NOT CONFIGURED\n" +
        "  SAKANA_API_KEY is not set. Get a key at https://console.sakana.ai/get-started, then:\n" +
        "    cp .env.example .env   # and fill in SAKANA_API_KEY\n" +
        "    npm run smoke\n",
    );
    return SMOKE_EXIT.notConfigured;
  }
  const client = new FuguClient(config);
  const report = await runSmoke(client, {
    baseUrl: config.baseUrl,
    model: config.model,
    prompt: prompt || undefined,
  });
  (report.ok ? process.stdout : process.stderr).write(`${formatSmoke(report)}\n`);
  return report.ok ? SMOKE_EXIT.pass : SMOKE_EXIT.fail;
}

// Run only when executed directly (not when imported by tests). Mirrors src/cli.ts.
const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().then((code) => {
    process.exitCode = code;
  });
}
