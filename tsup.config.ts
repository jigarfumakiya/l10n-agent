import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: { cli: "src/cli/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  define: { __VERSION__: JSON.stringify(version) },
});
