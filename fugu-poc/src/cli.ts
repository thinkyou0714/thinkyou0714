/**
 * Tiny CLI for the Fugu PoC.
 *
 *   npm start -- "your prompt" --model fugu-ultra
 *   node --env-file-if-exists=.env --experimental-strip-types src/cli.ts "your prompt"
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { FuguClient, FuguError } from "./fugu-client.ts";
import type { ChatMessage } from "./fugu-client.ts";

export interface CliArgs {
  prompt: string;
  model?: string;
  baseUrl?: string;
  chat: boolean;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { prompt: "", chat: false, json: false, help: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") args.help = true;
    else if (a === "--chat") args.chat = true;
    else if (a === "--json") args.json = true;
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--base-url") args.baseUrl = argv[++i];
    else if (a.startsWith("--model=")) args.model = a.slice("--model=".length);
    else if (a.startsWith("--base-url=")) args.baseUrl = a.slice("--base-url=".length);
    else positionals.push(a);
  }
  args.prompt = positionals.join(" ").trim();
  return args;
}

const HELP = `fugu-poc — minimal Sakana Fugu client

Usage:
  npm start -- "<prompt>" [--model fugu|fugu-ultra] [--chat] [--json]
  node --env-file-if-exists=.env --experimental-strip-types src/cli.ts "<prompt>"

Options:
  --model <id>      fugu (fast) or fugu-ultra (max quality). Default: fugu-ultra
  --chat            Use the Chat Completions API instead of the Responses API
  --base-url <url>  Override the API base URL (default https://api.sakana.ai/v1)
  --json            Print the raw JSON response
  -h, --help        Show this help

Environment (see .env.example):
  SAKANA_API_KEY    required — get one at https://console.sakana.ai/get-started
  SAKANA_BASE_URL   optional — defaults to https://api.sakana.ai/v1
  FUGU_MODEL        optional — defaults to fugu-ultra
`;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let prompt = args.prompt;
  if (!prompt && !process.stdin.isTTY) {
    prompt = (await readStdin()).trim();
  }
  if (!prompt) {
    process.stderr.write("Error: no prompt provided.\n\n" + HELP);
    return 1;
  }

  const config = loadConfig();
  if (args.baseUrl) config.baseUrl = args.baseUrl;
  if (args.model) config.model = args.model;
  if (!config.apiKey) {
    process.stderr.write(
      "Error: SAKANA_API_KEY is not set.\n" +
        "Get a key at https://console.sakana.ai/get-started, then:\n" +
        "  export SAKANA_API_KEY=sk-...   (or copy .env.example to .env)\n",
    );
    return 1;
  }

  const client = new FuguClient(config);
  try {
    const messages: ChatMessage[] = [{ role: "user", content: prompt }];
    const result = args.chat ? await client.chat(messages) : await client.respond(prompt);
    process.stdout.write((args.json ? JSON.stringify(result.raw, null, 2) : result.text) + "\n");
    return 0;
  } catch (err) {
    if (err instanceof FuguError) {
      process.stderr.write(`Fugu request failed: ${err.message}\n`);
      if (err.status) process.stderr.write(`HTTP ${err.status}\n`);
      if (err.body) process.stderr.write(err.body.slice(0, 2000) + "\n");
    } else {
      process.stderr.write(String(err) + "\n");
    }
    return 1;
  }
}

// Run only when executed directly (not when imported by the tests).
const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  // Set exitCode and let the event loop drain so buffered stdout (e.g. large
  // --json output to a pipe) is never truncated by an eager process.exit().
  main().then((code) => {
    process.exitCode = code;
  });
}
