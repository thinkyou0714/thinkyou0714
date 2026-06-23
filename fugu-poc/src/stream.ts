/**
 * Minimal Server-Sent-Events parsing for streaming responses, plus helpers to pull
 * text deltas / final payloads out of OpenAI-compatible stream events. Zero deps
 * (Web Streams + TextDecoderStream, built in on Node >= 22).
 */

export interface SSEMessage {
  event?: string;
  data: string;
}

function getProp(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Parse an SSE byte stream into messages (blank-line-separated, `data:` lines joined by \n). */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, "\n");
      let idx: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard buffer-drain loop
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const msg = parseBlock(block);
        if (msg) yield msg;
      }
    }
    const tail = parseBlock(buffer);
    if (tail) yield tail;
  } finally {
    // Cancel (not just releaseLock) so an early break by the consumer frees the
    // underlying connection instead of leaking it. No-op once the stream is done.
    await reader.cancel().catch(() => {});
  }
}

function parseBlock(block: string): SSEMessage | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0 && event === undefined) return undefined;
  return { event, data: data.join("\n") };
}

/** Extract an incremental text delta from a Responses or Chat stream event. */
export function extractStreamDelta(json: unknown): string {
  const type = getProp(json, "type");
  const delta = getProp(json, "delta");
  if (typeof delta === "string" && (typeof type !== "string" || type.endsWith(".delta"))) {
    return delta;
  }
  const choices = getProp(json, "choices");
  if (Array.isArray(choices) && choices[0]) {
    const content = getProp(getProp(choices[0], "delta"), "content");
    if (typeof content === "string") return content;
  }
  return "";
}

/** Extract a terminal/full payload (e.g. Responses `response.completed`) if present. */
export function extractStreamFinal(json: unknown): unknown {
  if (getProp(json, "type") === "response.completed") return getProp(json, "response");
  return undefined;
}

/** Extract a top-level `usage` object (Chat streams emit it in the final chunk). */
export function extractStreamUsage(json: unknown): unknown {
  const usage = getProp(json, "usage");
  return usage && typeof usage === "object" ? usage : undefined;
}

/** Extract `choices[0].finish_reason` from a Chat stream chunk, if present. */
export function extractStreamFinishReason(json: unknown): string | undefined {
  const choices = getProp(json, "choices");
  if (Array.isArray(choices) && choices[0]) {
    const fr = getProp(choices[0], "finish_reason");
    if (typeof fr === "string") return fr;
  }
  return undefined;
}
