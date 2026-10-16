#!/usr/bin/env node
// Starts the Localship MCP server for the Claude Code plugin.
//
// A local checkout that has been built (`claude --plugin-dir <checkout>`) runs that build, so
// changes can be tried without publishing. An installed plugin has no build, so it runs the
// package from npm instead.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const local = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

if (existsSync(local)) {
  // The CLI reads its command from process.argv.
  process.argv = [process.argv[0], local, "mcp", ...args];
  await import(pathToFileURL(local).href);
} else {
  const windows = process.platform === "win32";
  const child = spawn(windows ? "npx.cmd" : "npx", ["-y", "localship", "mcp", ...args], {
    stdio: "inherit",
    shell: windows,
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
