import path from "node:path";
import { CONFIG_FILE, LEGACY_CONFIG_FILE, ROOT_CONFIG_FILE } from "../core/config.js";
import type { FileSystem } from "../core/fs.js";
import { detect, mostlyHardcoded } from "../detect/detect.js";
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

/** `localship init`. Returns the process exit code. */
export async function runInit(fs: FileSystem, opts: InitOptions, io: Io): Promise<number> {
  const root = path.resolve(opts.cwd);
  const file = path.join(root, CONFIG_FILE);
  if ((await fs.exists(file)) && !opts.force) {
    io.error(`${CONFIG_FILE} already exists in ${root}. Use --force to replace it.`);
    return 2;
  }
  for (const older of [ROOT_CONFIG_FILE, LEGACY_CONFIG_FILE]) {
    if (await fs.exists(path.join(root, older))) {
      io.error(
        `${older} already sets this project up, and Localship still reads it. Move it to ${CONFIG_FILE} if you like; nothing else needs to change.`,
      );
      return 2;
    }
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
    // Setting up is fine, but translating now would leave most of the app in English.
    const warnings = accept.flatMap((n) => {
      const c = result.candidates[n - 1];
      if (!c?.codeLiterals || !mostlyHardcoded(c.codeLiterals, c.strings)) return [];
      return [
        `${c.target.path}: about ${c.codeLiterals} pieces of UI text are still written in the code, against ${c.strings} string${c.strings === 1 ? "" : "s"} in resources. Make the app localizable first (the localship-extract skill), or translations will cover only part of it.`,
      ];
    });

    if (opts.json) {
      io.log(JSON.stringify({ file, config, warnings, detected: result }, null, 2));
    } else {
      const shown = path.relative(process.cwd(), file);
      io.log(`Wrote ${shown.startsWith("..") ? file : shown}:`);
      io.log("");
      for (const line of text.trimEnd().split("\n")) io.log(`  ${line}`);
      io.log("");
      if (config.locales.length === 0) {
        io.log("No target languages yet: add some under `locales:`.");
      }
      for (const w of warnings) io.log(`▲ ${w}`);
      io.log(
        warnings.length
          ? "Next: move the text into resources (the localship-extract skill), then translate."
          : "Next: `localship status` to see progress, `localship validate` to check translations.",
      );
    }
    return 0;
  } catch (e) {
    if (!(e instanceof InitError)) throw e;
    io.error(e.message);
    return 2;
  }
}
