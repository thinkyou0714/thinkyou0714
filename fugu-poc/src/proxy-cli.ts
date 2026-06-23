#!/usr/bin/env node
/**
 * `fugu-proxy` — start the OpenAI-compatible proxy from environment config.
 *
 *   SAKANA_API_KEY=... fugu-proxy            # listens on :4141
 *   FUGU_PROXY_PORT=8080 FUGU_PROXY_TOKEN=local-secret fugu-proxy
 *
 * Then point any OpenAI-SDK tool at  http://localhost:4141/v1
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadConfig } from "./config.ts";
import { FuguClient } from "./fugu-client.ts";
import { createProxyServer } from "./proxy.ts";

export function startProxyFromEnv(env: NodeJS.ProcessEnv = process.env): import("node:http").Server {
  const parsedPort = Number.parseInt(env.FUGU_PROXY_PORT ?? "", 10);
  const port = Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 4141;
  const token = env.FUGU_PROXY_TOKEN || undefined;
  const client = new FuguClient(loadConfig({ env }));
  const server = createProxyServer({ backend: client, token });
  server.listen(port, () => {
    process.stderr.write(
      `fugu proxy listening on http://localhost:${port}/v1${token ? " (token required)" : ""}\n`,
    );
  });
  return server;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  startProxyFromEnv();
}
