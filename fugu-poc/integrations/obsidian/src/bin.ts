#!/usr/bin/env node
/**
 * `fugu-obsidian` — ask Sakana Fugu about your current Obsidian note and append the answer.
 *
 *   SAKANA_API_KEY=... OBSIDIAN_API_KEY=... fugu-obsidian "What's missing from this plan?"
 *   fugu-obsidian --path "Projects/Fugu.md" --model fugu-ultra --effort high
 *
 * Reads the target note via the Local REST API plugin, sends it to Fugu, and appends the
 * reply under a "## 🐡 Fugu" heading (non-destructive).
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfig, FuguClient } from "../../../src/index.ts";
import { ObsidianClient } from "./obsidian-api.ts";
import { runFuguOnNote } from "./command.ts";
import type { FuguNoteOptions, NoteTarget } from "./command.ts";
import type { ReasoningEffort } from "../../../src/index.ts";

interface ParsedArgs extends FuguNoteOptions {
  help?: boolean;
}

const EFFORTS = new Set(["high", "xhigh", "max"]);

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  const questionParts: string[] = [];
  let target: NoteTarget = "active";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--path") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--path requires a value");
      target = { path: value };
    } else if (arg === "--model") out.model = argv[++i];
    else if (arg === "--heading") out.heading = argv[++i];
    else if (arg === "--effort") {
      const v = argv[++i];
      if (!v || !EFFORTS.has(v))
        throw new Error(`--effort must be one of high|xhigh|max (got ${v ?? "nothing"})`);
      out.effort = v as ReasoningEffort;
    } else if (arg.startsWith("--")) throw new Error(`Unknown flag: ${arg}`);
    else questionParts.push(arg);
  }
  out.target = target;
  if (questionParts.length) out.question = questionParts.join(" ");
  return out;
}

const HELP = `fugu-obsidian — ask Fugu about your Obsidian note

Usage:
  fugu-obsidian [question...] [--path <vault/path.md>] [--model fugu|fugu-ultra]
                [--effort high|xhigh|max] [--heading "## ..."]

Env:
  SAKANA_API_KEY     Fugu API key (required)
  OBSIDIAN_API_KEY   Local REST API key (required)
  OBSIDIAN_API_URL   plugin base URL (default https://127.0.0.1:27124)
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey)
    throw new Error("OBSIDIAN_API_KEY is required (Obsidian → Settings → Local REST API → API Key).");

  const notes = new ObsidianClient({ apiKey, baseUrl: process.env.OBSIDIAN_API_URL });
  const fugu = new FuguClient(loadConfig());
  const answer = await runFuguOnNote({ notes, fugu }, args);
  process.stdout.write(`${answer}\n`);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
