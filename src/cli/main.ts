import { Command } from "commander";
import { ConfigError } from "../core/config.js";
import { nodeFs } from "../core/fs.js";
import { openProject } from "../core/project.js";
import { computeStatus } from "../core/status.js";
import { validateProject } from "../core/validate.js";
import { printIssues, printStatus } from "./output.js";

declare const __VERSION__: string | undefined;

const program = new Command()
  .name("l10n")
  .description("Local-first, agent-native localization for mobile apps")
  .version(typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0")
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

program.parseAsync().catch((e: unknown) => {
  if (e instanceof ConfigError) {
    console.error(e.message);
    process.exitCode = 2;
    return;
  }
  throw e;
});
