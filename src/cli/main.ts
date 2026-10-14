import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { addLocales, loadConfig } from "../core/config.js";
import { UserError } from "../core/errors.js";
import { nodeFs } from "../core/fs.js";
import { openProject } from "../core/project.js";
import { computeStatus, ENTRY_STATES, type EntryState } from "../core/status.js";
import { validateProject } from "../core/validate.js";
import {
  approve,
  nextBatch,
  parseSubmitInput,
  prune,
  removeTranslations,
  submit,
} from "../core/workflow.js";
import { detect } from "../detect/detect.js";
import { translateProject } from "../translate/translate.js";
import { runInit } from "./init-command.js";
import {
  describeDetect,
  describeNone,
  printApprove,
  printIssues,
  printStatus,
  printSubmit,
} from "./output.js";

declare const __VERSION__: string | undefined;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

const program = new Command()
  .name("l10n")
  .description("Local-first, agent-native localization for apps")
  // Filled in by the build; `npm run dev` runs unbundled source.
  .version(VERSION)
  .option("-c, --config <file>", "path to l10n.config.yaml (default: nearest one)")
  .option("-C, --cwd <dir>", "directory to run in", process.cwd());

const globals = () => program.opts<{ config?: string; cwd: string }>();
const locales = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const list = locales;
const states = (v: string) => {
  const out = list(v);
  const bad = out.filter((s) => !ENTRY_STATES.includes(s as EntryState));
  if (bad.length) {
    throw new InvalidArgumentError(
      `Unknown state ${bad.join(", ")}; use ${ENTRY_STATES.join(", ")}`,
    );
  }
  return out as EntryState[];
};
const count = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("Use a whole number");
  return n;
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

program
  .command("status")
  .description("Translation progress per locale")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("--json", "machine-readable output")
  .action(async (opts: { locale?: string[]; json?: boolean }) => {
    const project = await openProject(nodeFs, globals());
    const status = computeStatus(project, opts.locale);
    if (opts.json) {
      console.log(JSON.stringify({ status }, null, 2));
    } else {
      printStatus(project, status);
    }
  });

program
  .command("validate")
  .description("Check source strings and translations; exits 1 on errors")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("--strict", "untranslated strings and missing locales are errors")
  .option("--json", "machine-readable output")
  .action(async (opts: { locale?: string[]; strict?: boolean; json?: boolean }) => {
    const project = await openProject(nodeFs, globals());
    const issues = validateProject(project, { locales: opts.locale, strict: opts.strict });
    const errors = issues.filter((i) => i.severity === "error").length;
    if (opts.json) {
      console.log(JSON.stringify({ ok: errors === 0, issues }, null, 2));
    } else {
      printIssues(issues);
    }
    process.exitCode = errors > 0 ? 1 : 0;
  });

program
  .command("detect")
  .description("Find the translation files in this repo (writes nothing)")
  .option("--json", "machine-readable output")
  .action(async (opts: { json?: boolean }) => {
    const result = await detect(nodeFs, globals().cwd);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.candidates.length === 0) {
      for (const line of describeNone(result)) console.log(line);
    } else {
      for (const line of describeDetect(result)) console.log(line);
      console.log("\nNext: `l10n init` writes these into l10n.config.yaml.");
    }
  });

program
  .command("add-locale")
  .description("Add languages to translate into, e.g. l10n add-locale hi,ar")
  .argument("<locales>", "comma-separated language codes", locales)
  .action(async (requested: string[]) => {
    const g = globals();
    const { file } = await loadConfig(nodeFs, g.cwd, g.config);
    const { added, locales: all } = await addLocales(nodeFs, file, requested);
    console.log(
      added.length
        ? `Added ${added.join(", ")}. Languages now: ${all.join(", ")}.`
        : `Nothing to add. Languages: ${all.join(", ") || "none"}.`,
    );
    if (added.length) console.log("Next: translate them with your agent, or `l10n translate`.");
  });

program
  .command("next-batch")
  .description("Strings that need translating, with context, as JSON for an agent")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("-t, --target <list>", "only these target ids", list)
  .option("-k, --keys <list>", "only these keys", list)
  .option("--states <list>", "which entries (default: missing,stale)", states)
  .option("-n, --limit <n>", "entries per batch", count, 40)
  .option("--offset <n>", "skip this many entries", count, 0)
  .action(
    async (opts: {
      locale?: string[];
      target?: string[];
      keys?: string[];
      states?: EntryState[];
      limit: number;
      offset: number;
    }) => {
      const project = await openProject(nodeFs, globals());
      const batch = await nextBatch(project, {
        locales: opts.locale,
        targets: opts.target,
        keys: opts.keys,
        states: opts.states,
        limit: opts.limit,
        offset: opts.offset,
      });
      console.log(JSON.stringify(batch, null, 2));
    },
  );

program
  .command("submit")
  .description("Check translations and write the good ones as drafts; exits 1 if any are rejected")
  .argument(
    "[file]",
    'JSON file, or - for stdin: {"translations": [{"locale", "key", "value"}]}',
    "-",
  )
  .option("-m, --model <name>", "model that made the translations, kept in the lockfile")
  .option("--force", "replace hand edits and reviewed or approved translations")
  .option("--dry-run", "check without writing")
  .option("--json", "machine-readable output")
  .action(
    async (
      file: string,
      opts: { model?: string; force?: boolean; dryRun?: boolean; json?: boolean },
    ) => {
      const g = globals();
      const text =
        file === "-" ? await readStdin() : await nodeFs.readFile(path.resolve(g.cwd, file));
      const input = parseSubmitInput(text);
      const project = await openProject(nodeFs, g);
      const result = await submit(project, input.translations, {
        model: opts.model ?? input.model,
        force: opts.force,
        dryRun: opts.dryRun,
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else printSubmit(result);
      process.exitCode = result.rejected.length > 0 ? 1 : 0;
    },
  );

program
  .command("approve")
  .description("Mark drafts approved (or reviewed)")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("-t, --target <list>", "only these target ids", list)
  .option("-k, --keys <list>", "only these keys", list)
  .option(
    "--from <list>",
    "which entries (default: draft,reviewed). Add untracked to adopt existing translations, edited to accept hand edits",
    states,
  )
  .option("--reviewed", "mark reviewed instead of approved")
  .option("--dry-run", "show what would change")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      locale?: string[];
      target?: string[];
      keys?: string[];
      from?: EntryState[];
      reviewed?: boolean;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const project = await openProject(nodeFs, globals());
      const to = opts.reviewed ? "reviewed" : "approved";
      const result = await approve(project, {
        locales: opts.locale,
        targets: opts.target,
        keys: opts.keys,
        states: opts.from,
        to,
        dryRun: opts.dryRun,
      });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else printApprove(result, to);
    },
  );

program
  .command("remove")
  .description("Make translations untranslated again, e.g. to reject bad drafts")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("-t, --target <list>", "only these target ids", list)
  .option("-k, --keys <list>", "these keys", list)
  .option("--states <list>", "entries in these states, e.g. draft", states)
  .option("--force", "also remove hand edits and reviewed, approved or untracked translations")
  .option("--dry-run", "show what would be removed")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      locale?: string[];
      target?: string[];
      keys?: string[];
      states?: EntryState[];
      force?: boolean;
      dryRun?: boolean;
      json?: boolean;
    }) => {
      const project = await openProject(nodeFs, globals());
      const result = await removeTranslations(project, {
        locales: opts.locale,
        targets: opts.target,
        keys: opts.keys,
        states: opts.states,
        force: opts.force,
        dryRun: opts.dryRun,
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const verb = result.dryRun ? "Would remove" : "Removed";
      console.log(
        `${verb} ${result.removed.length} translation${result.removed.length === 1 ? "" : "s"}.`,
      );
      for (const r of result.refused) {
        console.log(`  kept ${r.locale} ${r.key}: ${r.state} (pass --force to remove)`);
      }
      for (const f of result.files) console.log(`  ${f}`);
    },
  );

program
  .command("prune")
  .description("Remove translations of strings that were deleted, renamed or made untranslatable")
  .option("-t, --target <list>", "only these target ids", list)
  .option("--dry-run", "show what would be removed")
  .option("--json", "machine-readable output")
  .action(async (opts: { target?: string[]; dryRun?: boolean; json?: boolean }) => {
    const project = await openProject(nodeFs, globals());
    const result = await prune(project, { targets: opts.target, dryRun: opts.dryRun });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.removed.length === 0 && result.lockEntries === 0) {
      console.log("Nothing to clean up.");
      return;
    }
    const verb = result.dryRun ? "Would remove" : "Removed";
    console.log(
      `${verb} ${result.removed.length} leftover translation${result.removed.length === 1 ? "" : "s"} and ${result.lockEntries} lockfile record${result.lockEntries === 1 ? "" : "s"}.`,
    );
    for (const r of result.removed) {
      console.log(
        `  ${r.locale} ${r.key}: ${r.reason === "orphan" ? "no longer in the source" : "marked not translatable"}`,
      );
    }
    for (const f of result.files) console.log(`  ${f}`);
  });

program
  .command("translate")
  .description("Translate missing and stale strings with a model API, as drafts")
  .option("-l, --locale <list>", "comma-separated locales", locales)
  .option("-t, --target <list>", "only these target ids", list)
  .option("-k, --keys <list>", "only these keys", list)
  .option("--states <list>", "which entries (default: missing,stale)", states)
  .option("-m, --model <provider:model>", "model for every locale (default: models in the config)")
  .option("-n, --batch-size <n>", "strings per model call", count, 30)
  .option("-p, --parallel <n>", "model calls at once", count, 4)
  .option("--force", "replace hand edits and reviewed or approved translations")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      locale?: string[];
      target?: string[];
      keys?: string[];
      states?: EntryState[];
      model?: string;
      batchSize: number;
      parallel: number;
      force?: boolean;
      json?: boolean;
    }) => {
      const project = await openProject(nodeFs, globals());
      const result = await translateProject(project, {
        locales: opts.locale,
        targets: opts.target,
        keys: opts.keys,
        states: opts.states,
        model: opts.model,
        batchSize: opts.batchSize,
        concurrency: opts.parallel,
        force: opts.force,
        log: (line) => console.error(line),
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`${result.translated} strings translated as drafts.`);
        for (const f of result.failed) {
          console.log(`  ✖ ${f.locale} ${f.key}: ${f.errors.join("; ")}`);
        }
        for (const f of result.files) console.log(`  ${f}`);
        if (result.translated > 0) {
          console.log("Next: `l10n validate`, review the drafts, then `l10n approve`.");
        }
      }
      process.exitCode = result.failed.length > 0 ? 1 : 0;
    },
  );

program
  .command("mcp")
  .description("Run the MCP server over stdio, for Claude, Cursor, Codex and other MCP clients")
  .action(async () => {
    const { runServer } = await import("../mcp/server.js");
    // Claude Code doesn't promise to start servers in the project; it says where the project is.
    const explicit = program.getOptionValueSource("cwd") !== "default";
    const cwd = explicit ? globals().cwd : (process.env.CLAUDE_PROJECT_DIR ?? globals().cwd);
    await runServer({ cwd, version: VERSION });
  });

const setupNumbers = (v: string) => {
  const list = v.split(",").map((s) => Number(s.trim()));
  if (list.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new InvalidArgumentError("Use setup numbers from `l10n detect`, e.g. 1,2");
  }
  return list;
};

program
  .command("init")
  .description("Detect translation files and write l10n.config.yaml")
  .option("-y, --yes", "accept the detected setups without asking")
  .option("--accept <numbers>", "only these setups from `l10n detect`, e.g. 1,2", setupNumbers)
  .option("--source <locale>", "source language (default: detected, else en)")
  .option("-l, --locales <list>", "languages to translate into, e.g. hi,ar", locales)
  .option("--force", "replace an existing l10n.config.yaml")
  .option("--json", "machine-readable output")
  .action(
    async (opts: {
      yes?: boolean;
      accept?: number[];
      source?: string;
      locales?: string[];
      force?: boolean;
      json?: boolean;
    }) => {
      const rl = process.stdin.isTTY
        ? createInterface({ input: process.stdin, output: process.stdout })
        : undefined;
      try {
        process.exitCode = await runInit(
          nodeFs,
          { ...opts, cwd: globals().cwd },
          {
            interactive: rl !== undefined && !opts.json,
            log: (line) => console.log(line),
            error: (line) => console.error(line),
            ask: async (question, fallback) => {
              const answer = await rl?.question(`${question} [${fallback}] `);
              return answer?.trim() || fallback;
            },
          },
        );
      } finally {
        rl?.close();
      }
    },
  );

program.parseAsync().catch((e: unknown) => {
  if (e instanceof UserError) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  throw e;
});
