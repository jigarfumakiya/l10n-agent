import path from "node:path";
import { runInit } from "../cli/init-command.js";
import { type DetectResult, detect, mostlyHardcoded } from "../detect/detect.js";
import { hardcodedNotes } from "../detect/hardcoded.js";
import { defaultSelection } from "../detect/init.js";
import { findOtherSystems } from "../detect/others.js";
import { walk } from "../detect/walk.js";
import { addLocales, CONFIG_FILE, loadConfig } from "./config.js";
import { conventionalVoice, voiceFor } from "./context.js";
import { UserError } from "./errors.js";
import type { FileSystem } from "./fs.js";
import { openProject, type Project, projectGlossary, projectLocales } from "./project.js";
import { computeStatus } from "./status.js";
import { languageName } from "./workflow.js";

/**
 * A read-only look at what a request involves ("translate this app to Hindi"): the files,
 * how much there is to translate, anything in the way, and what translators will go by.
 * It decides nothing for the user and needs no confirmation; the agent does what was asked.
 */
export interface Plan {
  /** Nothing stands in the way of translating. */
  ready: boolean;
  configured: boolean;
  sourceLocale: string;
  locales: Array<{ code: string; name: string; isNew: boolean }>;
  /** Translation files Localship will work on. */
  targets: Array<{ format: string; path: string; strings: number }>;
  /** Strings in the translation files to translate (missing or stale), per locale. */
  work: Record<string, number>;
  /** Another tool already manages translations: ask the user before writing any. */
  warnings: string[];
  /** Text still in the code: moved when the user wants the app in a language, else only mentioned. */
  notes: string[];
  /** What stops translation, and what would get past it. */
  blockers: Array<{ kind: Blocker; message: string; fix: string }>;
  /** Voice per locale: the project's own, or the usual convention for that language. */
  voice: Record<string, { text: string; fromProject: boolean }>;
  /** Names kept as written: the glossary's, plus the app name. */
  keepAsWritten: string[];
  /** Whether the project has a brief. */
  brief: boolean;
}

export type Blocker =
  | "no-translation-files"
  | "unsupported-format"
  | "empty-catalog"
  | "no-locales";

const COMMON_LANGUAGES = (
  "af am ar az be bg bn bs ca cs cy da de el en es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ms my nb ne nl or pa pl ps pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh zu " +
  "pt-BR pt-PT zh-Hans zh-Hant es-419 fr-CA en-GB"
).split(" ");
const NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/** "Hindi" → hi, "Brazilian Portuguese" → pt-BR, "pt_BR" → pt-BR. */
export function resolveLocale(input: string): string {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  for (const code of COMMON_LANGUAGES) {
    const name = NAMES.of(code)?.toLowerCase();
    if (name === lower || code.toLowerCase() === lower) return code;
  }
  try {
    const [code] = Intl.getCanonicalLocales(raw.replace(/_/g, "-"));
    if (code && /^[a-z]{2,3}(-|$)/i.test(code)) return code;
  } catch {
    // Not a code either.
  }
  throw new UserError(
    `"${input}" isn't a language name or code Localship knows; try a code like hi or pt-BR`,
  );
}

/** The app's name, from the Android default strings, to keep as written in every language. */
async function appNames(fs: FileSystem, root: string, result: DetectResult): Promise<string[]> {
  const names = new Set<string>();
  for (const c of result.candidates) {
    if (c.target.format !== "android-xml") continue;
    try {
      const xml = await fs.readFile(path.join(root, c.target.path, "values", "strings.xml"));
      const m = /<string\s+name="app_name"[^>]*>([^<]+)<\/string>/.exec(xml);
      if (m?.[1]) names.add(m[1].trim());
    } catch {
      // No strings.xml at the usual place.
    }
  }
  return [...names];
}

export interface PlanOptions {
  /** Languages the user asked for, as codes or names. */
  locales?: string[];
}

export async function plan(fs: FileSystem, cwd: string, opts: PlanOptions = {}): Promise<Plan> {
  const requested = (opts.locales ?? []).map(resolveLocale);
  let project: Project | undefined;
  try {
    project = await openProject(fs, { cwd });
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  return project ? planConfigured(project, requested) : planNew(fs, cwd, requested);
}

const EXTRACT =
  "They won't be translated until they're moved into string resources (the localship-extract skill): part of making the app work in a language, otherwise only when the user asks.";

async function planNew(fs: FileSystem, cwd: string, requested: string[]): Promise<Plan> {
  const result = await detect(fs, path.resolve(cwd));
  const picked = defaultSelection(result).map((n) => result.candidates[n - 1]);
  const chosen = picked.filter((c): c is NonNullable<typeof c> => c !== undefined);
  const locales = requested.length ? requested : result.locales;
  const blockers: Plan["blockers"] = [];
  const notes: string[] = [];

  if (chosen.length === 0) {
    const unsupported = result.unsupported.map((u) => u.format).join(", ");
    blockers.push(
      unsupported
        ? {
            kind: "unsupported-format",
            message: `This app uses ${unsupported}, which Localship can't translate yet.`,
            fix: "None yet: Localship supports Android strings.xml, Apple String Catalogs and gettext .po files.",
          }
        : {
            kind: "no-translation-files",
            message: `No translation files yet. ${result.hints[0] ?? ""}`.trim(),
            fix: "Move the UI text out of the code into string resources (the localship-extract skill): part of making the app work in a language, otherwise only when the user asks.",
          },
    );
  }
  for (const c of chosen) {
    if (c.codeLiterals !== undefined && mostlyHardcoded(c.codeLiterals, c.strings)) {
      notes.push(
        `About ${c.codeLiterals} pieces of UI text are still in the code, against ${c.strings} strings in ${c.target.path}. ${EXTRACT}`,
      );
    }
    if (c.target.format === "xcstrings" && c.strings === 0) {
      blockers.push({
        kind: "empty-catalog",
        message: `${c.target.path} is empty.`,
        fix: "Build the app in Xcode once so it collects your strings into the catalog.",
      });
    }
  }
  if (locales.length === 0) blockers.push(noLocales);

  const strings = chosen.reduce((n, c) => n + c.strings, 0);
  return build({
    warnings: result.otherSystems.map((o) => o.message),
    notes,
    configured: false,
    sourceLocale: result.sourceLocale.value,
    locales: locales.map((code) => ({ code, name: languageName(code), isNew: true })),
    targets: chosen.map((c) => ({
      format: c.target.format,
      path: c.target.path,
      strings: c.strings,
    })),
    work: Object.fromEntries(locales.map((l) => [l, strings])),
    blockers,
    keep: await appNames(fs, path.resolve(cwd), result),
    brief: false,
    voice: () => undefined,
  });
}

const noLocales: Plan["blockers"][number] = {
  kind: "no-locales",
  message: "No languages chosen yet.",
  fix: "Ask the user which languages to translate into.",
};

async function planConfigured(project: Project, requested: string[]): Promise<Plan> {
  const configured = projectLocales(project);
  const locales = [...new Set([...configured, ...requested])].filter(
    (l) => l !== project.config.sourceLocale,
  );
  const focus = requested.length ? requested : locales;
  const status = computeStatus(project, locales);
  const work: Record<string, number> = {};
  for (const l of focus) {
    work[l] = status
      .filter((s) => s.locale === l)
      .reduce((n, s) => n + s.counts.missing + s.counts.stale, 0);
    // A new language isn't in the status yet: everything is missing.
    if (!configured.includes(l)) {
      work[l] = project.targets.reduce(
        (n, t) => n + [...t.target.source.entries.values()].filter((e) => e.translatable).length,
        0,
      );
    }
  }
  const notes = (await hardcodedNotes(project)).map((n) => `${n.message} ${EXTRACT}`);
  const { files } = await walk(project.fs, project.root);
  const others = await findOtherSystems(project.fs, project.root, files);
  return build({
    warnings: others.map((o) => o.message),
    notes,
    configured: true,
    sourceLocale: project.config.sourceLocale,
    locales: focus.map((code) => ({
      code,
      name: languageName(code),
      isNew: !configured.includes(code),
    })),
    targets: project.targets.map((t) => ({
      format: t.target.format,
      path: t.target.label,
      strings: [...t.target.source.entries.values()].filter((e) => e.translatable).length,
    })),
    work,
    blockers: focus.length ? [] : [noLocales],
    keep: projectGlossary(project)
      .filter((t) => !t.translate)
      .map((t) => t.term),
    brief: !!project.context.brief,
    voice: (l) => voiceFor(project.context, l),
  });
}

function build(p: {
  warnings: string[];
  notes: string[];
  configured: boolean;
  sourceLocale: string;
  locales: Plan["locales"];
  targets: Plan["targets"];
  work: Record<string, number>;
  blockers: Plan["blockers"];
  keep: string[];
  brief: boolean;
  voice: (locale: string) => string | undefined;
}): Plan {
  const voice = Object.fromEntries(
    p.locales.map((l) => {
      const own = p.voice(l.code);
      return [l.code, { text: own ?? conventionalVoice(l.code), fromProject: !!own }];
    }),
  );
  return {
    ready: p.blockers.length === 0,
    configured: p.configured,
    sourceLocale: p.sourceLocale,
    locales: p.locales,
    targets: p.targets,
    work: p.work,
    warnings: p.warnings,
    notes: p.notes,
    blockers: p.blockers,
    voice,
    keepAsWritten: p.keep,
    brief: p.brief,
  };
}

export interface StartResult {
  config: string;
  createdConfig: boolean;
  addedLocales: string[];
  warnings: string[];
}

/**
 * Writes the config translation needs (or adds the languages to it), and nothing else: brief,
 * voice and glossary files are written only when the user asks for them.
 */
export async function start(
  fs: FileSystem,
  cwd: string,
  opts: { locales: string[] },
): Promise<StartResult> {
  const locales = opts.locales.map(resolveLocale);
  if (locales.length === 0) throw new UserError("Say which languages to translate into");
  const root = path.resolve(cwd);
  const result: StartResult = { config: "", createdConfig: false, addedLocales: [], warnings: [] };

  let existing: string | undefined;
  try {
    existing = (await loadConfig(fs, root)).file;
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  if (existing) {
    result.config = existing;
    result.addedLocales = (await addLocales(fs, existing, locales)).added;
    return result;
  }
  const out: string[] = [];
  const code = await runInit(
    fs,
    { cwd: root, yes: true, locales },
    {
      interactive: false,
      log: (l) => out.push(l),
      error: (l) => out.push(l),
      ask: async (_q, f) => f,
    },
  );
  if (code !== 0) throw new UserError(out.join("\n"));
  result.config = path.join(root, CONFIG_FILE);
  result.createdConfig = true;
  result.addedLocales = locales;
  result.warnings = out.filter((l) => l.startsWith("▲ ")).map((l) => l.slice(2));
  return result;
}
