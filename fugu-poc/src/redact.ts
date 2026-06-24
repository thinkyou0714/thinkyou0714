/**
 * Zero-dependency secret redaction.
 *
 * Anything that could carry the API key — the `Authorization` header, a stray
 * `Bearer …` / `sk-…` token in an error body or log line — is scrubbed before it
 * can reach stdout/stderr, a logger, or an error message.
 */

/** Header/field names whose values must never be surfaced. */
const DENY_KEYS = new Set([
  "authorization",
  "apikey",
  "api_key",
  "x-api-key",
  "sakana_api_key",
  "cookie",
  "set-cookie",
]);

/** Scrub key-shaped tokens from a free-text string. */
export function redactString(input: string): string {
  return (
    input
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
      // OpenAI-style keys with a hyphen or underscore prefix (e.g. "sk" + "-"/"_" + token).
      .replace(/\bsk[-_][A-Za-z0-9._-]{6,}/gi, "[REDACTED]")
      // Labelled secrets in free text: api_key=…, token: …, password=…, etc.
      // (The Authorization header is covered by the Bearer rule above + the object deny-list.)
      .replace(
        /\b(api[-_]?key|api[-_]?token|access[-_]?token|secret|password)\b(\s*[=:]\s*)("?)[^\s"',}]+/gi,
        "$1$2$3[REDACTED]",
      )
  );
}

/** Deep-redact an arbitrary value: deny-listed keys are censored, strings scrubbed. */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = DENY_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v, seen);
    }
    return out;
  }
  return value;
}
