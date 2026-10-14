import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError } from "commander";
import { ConfigError } from "../core/config.js";
import { nodeFs } from "../core/fs.js";
import { openProject } from "../core/project.js";
import { computeStatus } from "../core/status.js";
import { validateProject } from "../core/validate.js";
import { detect } from "../detect/detect.js";
import { runInit } from "./init-command.js";
import { describeDetect, describeNone, printIssues, printStatus } from "./output.js";

declare const __VERSION__: string | undefined;

const program = new Command()
  .name("l10n")
  .description("Local-first, agent-native localization for apps")
  // Filled in by the build; `npm run dev` runs unbundled source.
  .version(typeof __VERSION__ === "string" ? __VERSION__ : "dev")
  .option("-c, --config <file>", "path to l10n.config.yaml (default: nearest one)")
  .option("-C, --cwd <dir>", "directory to run in", process.cwd());

const globals = () => program.opts<{ config?: string; cwd: string }>();
const locales = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

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
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  throw e;
});
