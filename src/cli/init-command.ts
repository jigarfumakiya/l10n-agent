import path from "node:path";
import { CONFIG_FILE } from "../core/config.js";
import type { FileSystem } from "../core/fs.js";
import { detect } from "../detect/detect.js";
import {
  buildConfig,
  canonicalLocales,
  defaultSelection,
  InitError,
  renderConfig,
} from "../detect/init.js";
import { describeDetect, describeNone } from "./output.js";

export interface InitOptions {
  cwd: string;
  yes?: boolean;
  /** 1-based setup numbers from `detect`. */
  accept?: number[];
  source?: string;
  locales?: string[];
  force?: boolean;
  json?: boolean;
}

export interface Io {
  interactive: boolean;
  log: (line: string) => void;
  error: (line: string) => void;
  ask: (question: string, fallback: string) => Promise<string>;
}

/** `l10n init`. Returns the process exit code. */
export async function runInit(fs: FileSystem, opts: InitOptions, io: Io): Promise<number> {
  const root = path.resolve(opts.cwd);
  const file = path.join(root, CONFIG_FILE);
  if ((await fs.exists(file)) && !opts.force) {
    io.error(`${CONFIG_FILE} already exists in ${root}. Use --force to replace it.`);
    return 2;
  }

  const result = await detect(fs, root);
  if (result.candidates.length === 0) {
    io.error(describeNone(result).join("\n"));
    return 1;
  }

  const unattended = opts.yes || opts.accept !== undefined;
  if (!unattended && !io.interactive) {
    if (!opts.json) for (const line of describeDetect(result)) io.log(line);
    io.error("Not a terminal: pass --yes, or --accept 1,2 to choose setups, to write the config.");
    return 2;
  }

  try {
    let accept = opts.accept ?? defaultSelection(result);
    let sourceLocale = opts.source ?? result.sourceLocale.value;
    let locales = opts.locales ?? result.locales;

    if (!unattended) {
      for (const line of describeDetect(result)) io.log(line);
      io.log("");
      const picked = await io.ask("Add which setups?", accept.join(","));
      accept = picked
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (!opts.source) sourceLocale = await io.ask("Source language", sourceLocale);
      if (!opts.locales) {
        const answer = await io.ask(
          "Translate into (comma-separated, e.g. hi,ar)",
          locales.join(","),
        );
        locales = answer.split(",").filter((s) => s.trim());
      }
    }
    if (accept.some((n) => !Number.isInteger(n)))
      throw new InitError("Setups are numbers, e.g. 1,2");
    locales = canonicalLocales(locales);

    const config = buildConfig(result, { accept, sourceLocale, locales });
    const text = renderConfig(config);
    await fs.writeFile(file, text);

    if (opts.json) {
      io.log(JSON.stringify({ file, config, detected: result }, null, 2));
    } else {
      const shown = path.relative(process.cwd(), file);
      io.log(`Wrote ${shown.startsWith("..") ? file : shown}:`);
      io.log("");
      for (const line of text.trimEnd().split("\n")) io.log(`  ${line}`);
      io.log("");
      if (config.locales.length === 0) {
        io.log("No target languages yet: add some under `locales:`.");
      }
      io.log("Next: `l10n status` to see progress, `l10n validate` to check translations.");
    }
    return 0;
  } catch (e) {
    if (!(e instanceof InitError)) throw e;
    io.error(e.message);
    return 2;
  }
}
