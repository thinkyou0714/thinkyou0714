/**
 * Thin OpenAI-compatible HTTP proxy: expose one local endpoint that any
 * OpenAI-SDK tool (Cursor, n8n, scripts) can target, forwarding to a FuguClient or
 * FuguRouter. Injects the upstream key server-side so clients hold only a local token.
 * Zero dependencies (built-in node:http).
 *
 * Routes (with or without a `/v1` prefix):
 *   GET  /v1/models
 *   POST /v1/chat/completions   (stream:true -> SSE chunks + [DONE])
 *   POST /v1/responses          (stream:true -> response.* SSE + [DONE])
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import type { GenerateOptions, ChatMessage, FuguStreamEvent } from "./fugu-client.ts";
import type { FuguResult, FuguUsage } from "./types.ts";

export interface ProxyBackend {
  respond(input: string, opts?: GenerateOptions): Promise<FuguResult>;
  chat(messages: ChatMessage[], opts?: GenerateOptions): Promise<FuguResult>;
  respondStream(input: string, opts?: GenerateOptions): AsyncGenerator<FuguStreamEvent>;
  chatStream(messages: ChatMessage[], opts?: GenerateOptions): AsyncGenerator<FuguStreamEvent>;
}

export interface ProxyOptions {
  backend: ProxyBackend;
  /** Require this bearer token from clients (optional; if unset, no auth is enforced). */
  token?: string;
  /** Model ids advertised on GET /models. */
  models?: string[];
}

export function createProxyServer(options: ProxyOptions): http.Server {
  const models = options.models ?? ["fugu", "fugu-ultra"];
  return http.createServer((req, res) => {
    handle(req, res, options, models).catch((err) => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: { message: errMessage(err), type: "proxy_error" } });
      } else {
        res.end();
      }
    });
  });
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: ProxyOptions,
  models: string[],
): Promise<void> {
  const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "");

  if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
    return sendJson(res, 401, { error: { message: "Unauthorized", type: "auth" } });
  }

  if (req.method === "GET" && path.endsWith("/models")) {
    return sendJson(res, 200, {
      object: "list",
      data: models.map((id) => ({ id, object: "model", owned_by: "sakana" })),
    });
  }
  if (req.method === "POST" && path.endsWith("/chat/completions")) {
    return handleChat(res, options.backend, await readJson(req));
  }
  if (req.method === "POST" && path.endsWith("/responses")) {
    return handleResponses(res, options.backend, await readJson(req));
  }
  return sendJson(res, 404, { error: { message: `Not found: ${req.method} ${path}`, type: "not_found" } });
}

async function handleChat(
  res: http.ServerResponse,
  backend: ProxyBackend,
  body: Record<string, unknown>,
): Promise<void> {
  const messages = (Array.isArray(body.messages) ? body.messages : []) as ChatMessage[];
  const opts = optsFromBody(body);
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    startSSE(res);
    try {
      for await (const ev of backend.chatStream(messages, opts)) {
        if (ev.type === "delta") {
          writeSSE(res, chunk(id, created, ev.result?.model ?? opts.model, { content: ev.textDelta }, null));
        } else {
          writeSSE(
            res,
            chunk(id, created, ev.result?.model ?? opts.model, {}, ev.result?.finishReason ?? "stop"),
          );
        }
      }
    } catch (err) {
      writeSSE(res, { error: { message: errMessage(err) } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const result = await backend.chat(messages, opts);
  sendJson(res, 200, {
    id: result.requestId ?? id,
    object: "chat.completion",
    created,
    model: result.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: result.text },
        finish_reason: result.finishReason ?? "stop",
      },
    ],
    usage: toOpenAIUsage(result.usage),
  });
}

async function handleResponses(
  res: http.ServerResponse,
  backend: ProxyBackend,
  body: Record<string, unknown>,
): Promise<void> {
  const input = typeof body.input === "string" ? body.input : JSON.stringify(body.input ?? "");
  const opts = optsFromBody(body);

  if (body.stream) {
    startSSE(res);
    try {
      for await (const ev of backend.respondStream(input, opts)) {
        if (ev.type === "delta") writeSSE(res, { type: "response.output_text.delta", delta: ev.textDelta });
        else
          writeSSE(res, {
            type: "response.completed",
            response: ev.result?.raw ?? { output_text: ev.result?.text },
          });
      }
    } catch (err) {
      writeSSE(res, { error: { message: errMessage(err) } });
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const result = await backend.respond(input, opts);
  sendJson(res, 200, result.raw ?? { output_text: result.text });
}

function optsFromBody(body: Record<string, unknown>): GenerateOptions {
  return typeof body.model === "string" ? { model: body.model } : {};
}

function chunk(
  id: string,
  created: number,
  model: string | undefined,
  delta: Record<string, unknown>,
  finishReason: string | null,
): Record<string, unknown> {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function toOpenAIUsage(usage: FuguUsage): Record<string, unknown> {
  const prompt = usage.inputTokens ?? 0;
  const completion = usage.outputTokens ?? 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.totalTokens ?? prompt + completion,
  };
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
    });
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  const text = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

function startSSE(res: http.ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
}

function writeSSE(res: http.ServerResponse, obj: unknown): void {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
