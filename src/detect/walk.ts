import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { FileSystem } from "../core/fs.js";

/** Never localization sources: dependencies, build output, caches, VCS. */
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "bower_components",
  "vendor",
  "Pods",
  "Carthage",
  "DerivedData",
  ".build",
  "build",
  "dist",
  "out",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
  ".dart_tool",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "site-packages",
]);

export interface WalkResult {
  /** File paths relative to the root, with `/` separators. */
  files: string[];
  /** True when the walk stopped early at the file limit. */
  truncated: boolean;
}

/**
 * Lists the repo's files, skipping well-known output folders and anything matched by
 * `.gitignore` files (root and nested).
 */
export async function walk(
  fs: FileSystem,
  root: string,
  opts: { maxFiles?: number; maxDepth?: number } = {},
): Promise<WalkResult> {
  const maxFiles = opts.maxFiles ?? 50_000;
  const maxDepth = opts.maxDepth ?? 12;
  const files: string[] = [];
  let truncated = false;

  async function visit(rel: string, depth: number, rules: Array<{ base: string; ig: Ignore }>) {
    if (truncated) return;
    const abs = path.join(root, rel);
    let entries: Array<{ name: string; isDirectory: boolean }>;
    try {
      entries = await fs.listDir(abs);
    } catch {
      return;
    }
    const local = entries.some((e) => e.name === ".gitignore" && !e.isDirectory)
      ? [...rules, { base: rel, ig: ignore().add(await fs.readFile(path.join(abs, ".gitignore"))) }]
      : rules;
    const ignored = (child: string, isDir: boolean) =>
      local.some(({ base, ig }) => {
        const relToBase = base ? path.posix.relative(base, child) : child;
        return (
          relToBase !== "" &&
          !relToBase.startsWith("..") &&
          ig.ignores(isDir ? `${relToBase}/` : relToBase)
        );
      });

    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (SKIP_DIRS.has(e.name) || ignored(child, true) || depth >= maxDepth) continue;
        await visit(child, depth + 1, local);
      } else {
        if (ignored(child, false)) continue;
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push(child);
      }
    }
  }

  await visit("", 0, []);
  return { files, truncated };
}
