/**
 * Optional adapter for the official `openai` SDK — subpath `fugu-poc/openai`.
 *
 * `openai` is an OPTIONAL peer dependency: install it yourself to use this. It is
 * imported lazily so the zero-dependency core never requires it.
 */

import { loadConfig } from "./config.ts";

export interface FuguOpenAIOptions {
  apiKey?: string;
  baseURL?: string;
}

interface OpenAICtor {
  new (opts: { apiKey?: string; baseURL?: string }): unknown;
}

/**
 * Build a pre-configured official OpenAI client pointed at Fugu, reusing the same
 * `SAKANA_API_KEY` / `SAKANA_BASE_URL` resolution as the core client.
 * Requires `openai` to be installed (peer dependency); throws otherwise.
 */
export async function createFuguOpenAI(options: FuguOpenAIOptions = {}): Promise<unknown> {
  // Non-literal specifier keeps `openai` out of the type graph so the core stays dep-free.
  const specifier = "openai";
  const mod = (await import(specifier)) as { default: OpenAICtor };
  const config = loadConfig();
  return new mod.default({
    apiKey: options.apiKey ?? config.apiKey,
    baseURL: options.baseURL ?? config.baseUrl,
  });
}
