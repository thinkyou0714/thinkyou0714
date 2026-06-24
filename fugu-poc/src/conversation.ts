/**
 * Stateful Responses-API conversation: threads each reply's `id` into the next call
 * via `previous_response_id` (with `store: true`). Verify Fugu supports stateful
 * Responses before relying on this in production.
 */

import type { FuguClient, GenerateOptions } from "./fugu-client.ts";
import type { FuguResult } from "./types.ts";

export class Conversation {
  private readonly client: FuguClient;
  private lastResponseId?: string;

  constructor(client: FuguClient) {
    this.client = client;
  }

  /** Id of the most recent response, if any. */
  get lastId(): string | undefined {
    return this.lastResponseId;
  }

  /** Reset the thread (forget the previous response id). */
  reset(): void {
    this.lastResponseId = undefined;
  }

  /** Send a turn, automatically chaining from the previous response. */
  async send(input: string, opts: GenerateOptions = {}): Promise<FuguResult> {
    const result = await this.client.respond(input, {
      ...opts,
      previousResponseId: opts.previousResponseId ?? this.lastResponseId,
      store: opts.store ?? true,
    });
    if (result.id) this.lastResponseId = result.id;
    return result;
  }
}
