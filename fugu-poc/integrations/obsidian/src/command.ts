/**
 * Pure orchestration for the "ask Fugu about this note" command — no env, no process,
 * no SDK; just a NoteStore + a Responder. This keeps it unit-testable and lets the bin
 * inject a real ObsidianClient + FuguClient (which structurally satisfies Responder).
 */

import type { ReasoningEffort } from "../../../src/index.ts";
import type { NoteStore } from "./obsidian-api.ts";

/** The slice of FuguClient this command needs (FuguClient satisfies it structurally). */
export interface Responder {
  respond(
    input: string,
    opts?: { model?: string; reasoningEffort?: ReasoningEffort },
  ): Promise<{ text: string }>;
}

export type NoteTarget = "active" | { path: string };

export interface FuguNoteOptions {
  /** Which note to read/write — the active note (default) or a vault path. */
  target?: NoteTarget;
  /** Optional instruction; when omitted, a default "read and respond" instruction is used. */
  question?: string;
  model?: string;
  effort?: ReasoningEffort;
  /** Heading the answer is appended under (default `## 🐡 Fugu`). */
  heading?: string;
}

const DEFAULT_INSTRUCTION =
  "You are an assistant embedded in Obsidian. Read the note below and respond helpfully and concisely.";
const DEFAULT_HEADING = "## 🐡 Fugu";

/** Build the prompt sent to Fugu from the note body and the optional question. */
export function buildPrompt(note: string, question?: string): string {
  const instruction = question?.trim() ? question.trim() : DEFAULT_INSTRUCTION;
  return `${instruction}\n\n--- NOTE ---\n${note}`;
}

/**
 * Read the target note, ask Fugu, and append the answer back under a heading.
 * Returns the answer text. Appending (never overwriting) keeps the command non-destructive.
 */
export async function runFuguOnNote(
  deps: { notes: NoteStore; fugu: Responder },
  opts: FuguNoteOptions = {},
): Promise<string> {
  const target = opts.target ?? "active";
  const note = target === "active" ? await deps.notes.getActiveNote() : await deps.notes.getNote(target.path);

  const prompt = buildPrompt(note, opts.question);
  const result = await deps.fugu.respond(prompt, { model: opts.model, reasoningEffort: opts.effort });
  const answer = result.text?.trim() ? result.text : "(Fugu returned an empty response.)";

  const heading = opts.heading ?? DEFAULT_HEADING;
  const block = `\n\n${heading}\n\n${answer}\n`;
  if (target === "active") await deps.notes.appendToActiveNote(block);
  else await deps.notes.appendToNote(target.path, block);

  return answer;
}
