/**
 * Tiny zero-dependency client for the Obsidian **Local REST API** community plugin
 * (https://github.com/coddingtonbear/obsidian-local-rest-api).
 *
 * The plugin exposes the active note and the vault over a localhost HTTP(S) endpoint
 * guarded by a bearer API key. We touch only the few routes the Fugu command needs and
 * keep the surface injectable (`fetch`) so it is unit-testable without a running Obsidian.
 * Errors never carry the API key or a raw body — the message is redacted at the boundary.
 */

import { redactString } from "../../../src/index.ts";

/** Default HTTPS endpoint of the Local REST API plugin (self-signed cert; see README). */
export const DEFAULT_OBSIDIAN_URL = "https://127.0.0.1:27124";

export interface ObsidianClientOptions {
  /** API key from Obsidian → Settings → Local REST API. */
  apiKey: string;
  /** Base URL of the plugin (default `https://127.0.0.1:27124`). */
  baseUrl?: string;
  /** Injectable fetch (defaults to the global) — set in tests. */
  fetch?: typeof fetch;
}

/** The note operations the Fugu command depends on (kept minimal for testability). */
export interface NoteStore {
  getActiveNote(): Promise<string>;
  appendToActiveNote(markdown: string): Promise<void>;
  getNote(path: string): Promise<string>;
  appendToNote(path: string, markdown: string): Promise<void>;
}

/**
 * Encode each path segment but keep the `/` separators (so nested notes work).
 * Rejects empty / `.` / `..` segments: `encodeURIComponent("..")` is `".."`, which the
 * WHATWG URL parser would then collapse, letting a path escape the `/vault/` namespace and
 * address an arbitrary server route — for a command that both reads AND appends, that is a
 * write primitive, so we refuse it rather than encode it.
 */
function encodeVaultPath(path: string): string {
  const segments = path.replace(/^\/+/, "").split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(`Invalid note path ${JSON.stringify(path)}: segments must not be empty, "." or "..".`);
    }
  }
  return segments.map((seg) => encodeURIComponent(seg)).join("/");
}

export class ObsidianClient implements NoteStore {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ObsidianClientOptions) {
    if (!opts.apiKey) {
      throw new Error("ObsidianClient: apiKey is required (Obsidian → Local REST API → API Key).");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_OBSIDIAN_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async getActiveNote(): Promise<string> {
    return this.readMarkdown("/active/");
  }

  async appendToActiveNote(markdown: string): Promise<void> {
    await this.send("POST", "/active/", markdown);
  }

  // `async` so the synchronous path validation in encodeVaultPath surfaces as a rejected
  // promise (a consistent contract) rather than a throw at the call site.
  async getNote(path: string): Promise<string> {
    return this.readMarkdown(`/vault/${encodeVaultPath(path)}`);
  }

  async appendToNote(path: string, markdown: string): Promise<void> {
    await this.send("POST", `/vault/${encodeVaultPath(path)}`, markdown);
  }

  private async readMarkdown(route: string): Promise<string> {
    const res = await this.send("GET", route, undefined, "text/markdown");
    return await res.text();
  }

  private async send(
    method: string,
    route: string,
    body?: string,
    accept = "application/json",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: accept,
    };
    if (body !== undefined) headers["Content-Type"] = "text/markdown";

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${route}`, { method, headers, body });
    } catch (err) {
      // Network/TLS failure — redact in case the message echoes the URL/headers.
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Obsidian request failed (${method} ${route}): ${redactString(detail)}`);
    }
    if (!res.ok) {
      // Read at most a little of the body for context, then redact it.
      let snippet = "";
      try {
        snippet = (await res.text()).slice(0, 200);
      } catch {
        snippet = "";
      }
      const detail = snippet ? `: ${redactString(snippet)}` : "";
      throw new Error(`Obsidian API error ${res.status} (${method} ${route})${detail}`);
    }
    return res;
  }
}
