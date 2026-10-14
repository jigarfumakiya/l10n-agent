import path from "node:path";
import { stringify as toYaml } from "yaml";
import { runInit } from "../cli/init-command.js";
import { type DetectResult, detect, mostlyHardcoded } from "../detect/detect.js";
import { hardcodedNotes } from "../detect/hardcoded.js";
import { defaultSelection } from "../detect/init.js";
import { addLocales, CONFIG_FILE, loadConfig } from "./config.js";
import { CONTEXT_FILES } from "./context.js";
import { UserError } from "./errors.js";
import type { FileSystem } from "./fs.js";
import { openProject, type Project, projectLocales } from "./project.js";
import { computeStatus } from "./status.js";
import { languageName } from "./workflow.js";

/**
 * The fast path for direct requests ("translate this app to Hindi"): look at the project,
 * decide everything that has a sensible default, and return one plan the user confirms once.
 * After that, `start` does the setup and the agent translates without more questions.
 */
export interface Plan {
  /** Nothing stands in the way: the user can say the confirm phrase and translation starts. */
  ready: boolean;
  configured: boolean;
  sourceLocale: string;
  locales: Array<{ code: string; name: string; isNew: boolean }>;
  /** Translation files Localship will work on. */
  targets: Array<{ format: string; path: string; strings: number }>;
  /** Strings to translate (missing or stale), per locale. */
  work: Record<string, number>;
  /** Things to fix first, each with what the agent will do about it. */
  blockers: Array<{ kind: Blocker; message: string; fix: string }>;
  /** Choices made for the user, which they can change in their reply. */
  defaults: {
    voice: Record<string, string>;
    keepAsWritten: string[];
    brief: "exists" | "will be drafted";
  };
  /** What will happen, in order, once confirmed. */
  steps: string[];
  /** What the user says to go ahead. */
  confirm: string;
}

export type Blocker =
  | "mostly-hardcoded"
  | "no-translation-files"
  | "unsupported-format"
  | "empty-catalog"
  | "no-locales";

/** Formality and tone most apps use, per language. Stated in the plan so the user can change it. */
const VOICE_DEFAULTS: Record<string, string> = {
  hi: "Address the user as आप (polite). Everyday Hindi over Sanskritized words; common English tech words (app, sync) may stay in English.",
  ar: "Modern Standard Arabic, addressing the user neutrally. Short sentences.",
  de: "Address the user as du, as most consumer apps do.",
  fr: "Address the user as vous.",
  es: "Address the user as tú. Neutral Spanish that works in Spain and Latin America.",
  it: "Address the user as tu.",
  pt: "Address the user as você (Brazilian Portuguese conventions).",
  nl: "Address the user as je.",
  ru: "Address the user as вы (lowercase).",
  ja: "Polite です/ます form. Short, natural UI phrasing.",
  ko: "Polite 해요체. Short, natural UI phrasing.",
  zh: "Neutral, concise UI language; no honorifics needed.",
  tr: "Address the user as siz.",
  pl: "Address the user informally (ty), as most consumer apps do.",
  id: "Address the user as Anda.",
  vi: "Address the user as bạn.",
  th: "Polite, neutral tone; use ครับ/ค่ะ only where a sentence needs it.",
};

export function defaultVoice(locale: string): string {
  return (
    VOICE_DEFAULTS[locale] ??
    VOICE_DEFAULTS[locale.split("-")[0] as string] ??
    "Polite, neutral tone, as a well-made app in this language would use."
  );
}

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

/** The app's name, to keep as written in every language. */
async function appNames(fs: FileSystem, root: string, result?: DetectResult): Promise<string[]> {
  const names = new Set<string>();
  for (const c of result?.candidates ?? []) {
    if (c.target.format !== "android-xml") continue;
    try {
      const xml = await fs.readFile(path.join(root, c.target.path, "values", "strings.xml"));
      const m = /<string\s+name="app_name"[^>]*>([^<]+)<\/string>/.exec(xml);
      if (m?.[1]) names.add(m[1].trim());
    } catch {
      // No strings.xml at the usual place.
    }
  }
  try {
    const readme = await fs.readFile(path.join(root, "README.md"));
    const heading = /^#\s+(.+)$/m
      .exec(readme)?.[1]
      ?.replace(/[^\p{L}\p{N} .-]/gu, "")
      .trim();
    if (heading && heading.split(/\s+/).length <= 3) names.add(heading);
  } catch {
    // No README.
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

async function planNew(fs: FileSystem, cwd: string, requested: string[]): Promise<Plan> {
  const result = await detect(fs, path.resolve(cwd));
  const picked = defaultSelection(result).map((n) => result.candidates[n - 1]);
  const chosen = picked.filter((c): c is NonNullable<typeof c> => c !== undefined);
  const locales = requested.length ? requested : result.locales;
  const blockers: Plan["blockers"] = [];

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
            fix: "Move the UI text out of the code into string resources (the localship-extract skill), on a new branch, then set up translation.",
          },
    );
  }
  for (const c of chosen) {
    if (c.codeLiterals !== undefined && mostlyHardcoded(c.codeLiterals, c.strings)) {
      blockers.push({
        kind: "mostly-hardcoded",
        message: `About ${c.codeLiterals} pieces of UI text are still in the code, against ${c.strings} in ${c.target.path}. Translating now would leave most of the app in English.`,
        fix: `First move that text into ${c.target.path}/values/strings.xml on a new branch (the localship-extract skill), building as it goes, then translate.`,
      });
    }
    if (c.target.format === "xcstrings" && c.strings === 0) {
      blockers.push({
        kind: "empty-catalog",
        message: `${c.target.path} is empty.`,
        fix: "Build the app in Xcode once so it collects your strings into the catalog.",
      });
    }
  }
  if (locales.length === 0) {
    blockers.push({
      kind: "no-locales",
      message: "No languages chosen yet.",
      fix: "Tell me which languages to translate into (for example: Hindi and Arabic).",
    });
  }

  // Text still in the code will be translated too, once it's moved into resources.
  const strings = chosen.reduce(
    (n, c) =>
      n +
      c.strings +
      (c.codeLiterals !== undefined && mostlyHardcoded(c.codeLiterals, c.strings)
        ? c.codeLiterals
        : 0),
    0,
  );
  const keep = await appNames(fs, path.resolve(cwd), result);
  return build({
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
    keep,
    hasBrief: false,
  });
}

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
  const blockers: Plan["blockers"] = (await hardcodedNotes(project)).map((n) => ({
    kind: "mostly-hardcoded" as const,
    message: n.message,
    fix: "First move that text into strings.xml on a new branch (the localship-extract skill), then translate.",
  }));
  if (focus.length === 0) {
    blockers.push({
      kind: "no-locales",
      message: "No languages chosen yet.",
      fix: "Tell me which languages to translate into.",
    });
  }
  return build({
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
    blockers,
    keep: project.context.glossary.filter((t) => !t.translate).map((t) => t.term),
    hasBrief: !!project.context.brief,
    voices: project.context.voice,
  });
}

function build(p: {
  configured: boolean;
  sourceLocale: string;
  locales: Plan["locales"];
  targets: Plan["targets"];
  work: Record<string, number>;
  blockers: Plan["blockers"];
  keep: string[];
  hasBrief: boolean;
  voices?: Record<string, string>;
}): Plan {
  const voice = Object.fromEntries(
    p.locales.map((l) => [l.code, p.voices?.[l.code] ?? defaultVoice(l.code)]),
  );
  const fixFirst = p.blockers.filter((b) => b.kind !== "no-locales");
  const names = p.locales.map((l) => l.name).join(" and ");
  // Per language: the same strings go into each.
  const total = Math.max(0, ...Object.values(p.work));
  const steps: string[] = [];
  for (const b of fixFirst) steps.push(b.fix);
  if (!p.configured) {
    steps.push(
      `Set up Localship for ${p.targets.map((t) => t.path).join(", ") || "the app"} with ${names || "your languages"} (localship_start).`,
    );
  } else if (p.locales.some((l) => l.isNew)) {
    steps.push(
      `Add ${p.locales
        .filter((l) => l.isNew)
        .map((l) => l.name)
        .join(" and ")} (localship_start).`,
    );
  }
  if (!p.hasBrief) {
    steps.push(
      "Draft a short brief from your README and strings, so translations match the app's tone.",
    );
  }
  const about = fixFirst.some((b) => b.kind === "mostly-hardcoded") ? "about " : "";
  steps.push(
    `Translate ${total ? `${about}${total}` : "the"} strings${names ? ` into ${names}` : ""}, checking each one (localship_next_batch → localship_submit until nothing remains).`,
    "Run all checks (localship_validate) and report what was done.",
    "Leave everything as drafts for you to review; nothing is approved without you.",
  );
  const blocked = p.blockers.some(
    (b) => b.kind === "unsupported-format" || b.kind === "no-locales",
  );
  return {
    ready: p.blockers.length === 0,
    configured: p.configured,
    sourceLocale: p.sourceLocale,
    locales: p.locales,
    targets: p.targets,
    work: p.work,
    blockers: p.blockers,
    defaults: {
      voice,
      keepAsWritten: p.keep,
      brief: p.hasBrief ? "exists" : "will be drafted",
    },
    steps,
    confirm: blocked ? "" : fixFirst.length ? "start" : "start translating",
  };
}

export interface StartResult {
  config: string;
  createdConfig: boolean;
  addedLocales: string[];
  /** Context files written, relative to the context folder. */
  wrote: string[];
  warnings: string[];
}

/**
 * Does the setup part of a plan in one call: writes the config (or adds languages to it), and
 * fills in default voice notes and the glossary where none exist. Never overwrites a person's
 * context files. The brief is left to the agent, which can read the README.
 */
export async function start(
  fs: FileSystem,
  cwd: string,
  opts: { locales: string[]; voice?: Record<string, string>; keepAsWritten?: string[] },
): Promise<StartResult> {
  const locales = opts.locales.map(resolveLocale);
  if (locales.length === 0) throw new UserError("Say which languages to translate into");
  const root = path.resolve(cwd);
  const result: StartResult = {
    config: "",
    createdConfig: false,
    addedLocales: [],
    wrote: [],
    warnings: [],
  };

  let existing: string | undefined;
  try {
    existing = (await loadConfig(fs, root)).file;
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
  }
  if (existing) {
    result.config = existing;
    result.addedLocales = (await addLocales(fs, existing, locales)).added;
  } else {
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
  }

  const project = await openProject(fs, { cwd: root });
  const dir = project.context.dir;
  const write = async (rel: string, content: string) => {
    const file = path.join(dir, rel);
    if (await fs.exists(file)) return;
    await fs.writeFile(file, content.endsWith("\n") ? content : `${content}\n`);
    result.wrote.push(rel);
  };
  for (const l of projectLocales(project)) {
    await write(`${CONTEXT_FILES.voiceDir}/${l}.md`, opts.voice?.[l] ?? defaultVoice(l));
  }
  const keep = opts.keepAsWritten ?? (await appNames(fs, root, await detect(fs, root)));
  if (keep.length) {
    await write(
      CONTEXT_FILES.glossary,
      toYaml({ terms: keep.map((term) => ({ term, translate: false })) }, { lineWidth: 0 }),
    );
  }
  return result;
}
