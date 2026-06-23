import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/openai.ts", "src/proxy-cli.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  dts: true,
  clean: true,
  // `openai` (the ./openai adapter's optional peer) is loaded via a non-literal
  // dynamic import, so it is never bundled — nothing to externalize explicitly.
});
