/**
 * Multi-provider router: try an ordered list of OpenAI-compatible providers, failing
 * over to the next on transient/auth errors. Mirrors Fugu's own swappable-pool ethos
 * at the app layer (if `api.sakana.ai` itself is down, fall back to another endpoint).
 * Zero dependencies — each provider is just a configured FuguClient.
 */

import { FuguError } from "./errors.ts";
import { noopLogger } from "./observe.ts";
import type { Logger } from "./observe.ts";
import type { FuguClient, GenerateOptions, ChatMessage, FuguStreamEvent } from "./fugu-client.ts";
import type { FuguResult } from "./types.ts";

export interface RouterProvider {
  name: string;
  client: FuguClient;
  /** Model id to use for this provider (overrides the per-call model). */
  model?: string;
}

export type RoutedResult = FuguResult & { provider: string };

export interface FuguRouterOptions {
  providers: RouterProvider[];
  /** Whether to fail over to the next provider for this error (default: retryable + auth/permission). */
  shouldFailover?: (error: FuguError) => boolean;
  logger?: Logger;
}

const defaultShouldFailover = (error: FuguError): boolean =>
  error.isRetryable || error.code === "auth" || error.code === "permission";

export class FuguRouter {
  private readonly providers: RouterProvider[];
  private readonly shouldFailover: (error: FuguError) => boolean;
  private readonly logger: Logger;

  constructor(options: FuguRouterOptions) {
    if (!options.providers.length) {
      throw new FuguError("FuguRouter requires at least one provider.", "config");
    }
    this.providers = options.providers;
    this.shouldFailover = options.shouldFailover ?? defaultShouldFailover;
    this.logger = options.logger ?? noopLogger;
  }

  async respond(input: string, opts: GenerateOptions = {}): Promise<RoutedResult> {
    return this.run((p) => p.client.respond(input, withModel(opts, p)));
  }

  async chat(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<RoutedResult> {
    return this.run((p) => p.client.chat(messages, withModel(opts, p)));
  }

  /** Streams from the FIRST provider only — no mid-stream failover (content is committed once emitted). */
  async *respondStream(input: string, opts: GenerateOptions = {}): AsyncGenerator<FuguStreamEvent> {
    const p = this.providers[0];
    yield* p.client.respondStream(input, withModel(opts, p));
  }

  async *chatStream(messages: ChatMessage[], opts: GenerateOptions = {}): AsyncGenerator<FuguStreamEvent> {
    const p = this.providers[0];
    yield* p.client.chatStream(messages, withModel(opts, p));
  }

  private async run(call: (provider: RouterProvider) => Promise<FuguResult>): Promise<RoutedResult> {
    let lastError: unknown;
    for (let i = 0; i < this.providers.length; i += 1) {
      const provider = this.providers[i];
      try {
        const result = await call(provider);
        return { ...result, provider: provider.name };
      } catch (err) {
        lastError = err;
        const isLast = i === this.providers.length - 1;
        if (isLast || !(err instanceof FuguError) || !this.shouldFailover(err)) throw err;
        this.logger.warn("fugu-router: failing over", {
          from: provider.name,
          to: this.providers[i + 1].name,
          code: err.code,
        });
      }
    }
    throw lastError; // unreachable: the loop returns or throws on the last provider
  }
}

function withModel(opts: GenerateOptions, provider: RouterProvider): GenerateOptions {
  return provider.model ? { ...opts, model: provider.model } : opts;
}
