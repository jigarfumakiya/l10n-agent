import path from "node:path";
import { Document, parse as parseYaml } from "yaml";
import { z } from "zod";
import { UserError } from "./errors.js";
import type { FileSystem } from "./fs.js";

/**
 * What translators need beyond the strings: the product brief, voice per locale and the
 * glossary. All plain files in the context folder (`.localship/` by default), kept in git.
 */
export interface ProjectContext {
  dir: string;
  /** What the app is, who it's for, its tone. */
  brief?: string;
  /** Voice for every locale (`voice/all.md`), then per locale (`voice/hi.md`). */
  voice: Record<string, string>;
  glossary: GlossaryTerm[];
}

const TermSchema = z.strictObject({
  term: z.string().min(1),
  /** false: keep as written in every language (brand and product names). */
  translate: z.boolean().default(true),
  /** Fixed translations per locale. */
  translations: z.record(z.string(), z.string()).optional(),
  /** Guidance for translators. */
  note: z.string().optional(),
  caseSensitive: z.boolean().default(false),
});
const GlossarySchema = z.strictObject({ terms: z.array(TermSchema).default([]) });

export type GlossaryTerm = z.infer<typeof TermSchema>;

export const CONTEXT_FILES = {
  brief: "brief.md",
  voiceDir: "voice",
  allVoice: "all",
  glossary: "glossary.yaml",
} as const;

export async function loadContext(fs: FileSystem, dir: string): Promise<ProjectContext> {
  const read = async (file: string) =>
    (await fs.exists(file)) ? (await fs.readFile(file)).trim() || undefined : undefined;
  const brief = await read(path.join(dir, CONTEXT_FILES.brief));
  const voice: Record<string, string> = {};
  const voiceDir = path.join(dir, CONTEXT_FILES.voiceDir);
  if (await fs.exists(voiceDir)) {
    for (const e of await fs.listDir(voiceDir)) {
      if (e.isDirectory || !e.name.endsWith(".md")) continue;
      const text = await read(path.join(voiceDir, e.name));
      if (text) voice[e.name.slice(0, -3)] = text;
    }
  }
  const glossaryFile = path.join(dir, CONTEXT_FILES.glossary);
  let glossary: GlossaryTerm[] = [];
  const raw = await read(glossaryFile);
  if (raw) {
    let data: unknown;
    try {
      data = parseYaml(raw);
    } catch (e) {
      throw new UserError(`${glossaryFile}: ${(e as Error).message}`);
    }
    const parsed = GlossarySchema.safeParse(data ?? {});
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
      throw new UserError(`${glossaryFile} is invalid:\n${details.join("\n")}`);
    }
    glossary = parsed.data.terms;
  }
  return { dir, ...(brief ? { brief } : {}), voice, glossary };
}

/** Voice guidance for a locale: shared voice first, then the locale's own and its language's. */
export function voiceFor(context: ProjectContext, locale: string): string | undefined {
  const language = locale.split("-")[0] as string;
  const parts = [context.voice[CONTEXT_FILES.allVoice]];
  if (language !== locale) parts.push(context.voice[language]);
  parts.push(context.voice[locale]);
  const text = parts.filter(Boolean).join("\n\n");
  return text || undefined;
}

const WORD = "[\\p{L}\\p{M}\\p{N}]";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Glossary terms that appear in a source text, as whole words. */
export function glossaryHits(glossary: GlossaryTerm[], text: string): GlossaryTerm[] {
  return glossary.filter((t) =>
    new RegExp(`(?<!${WORD})${escapeRegExp(t.term)}(?!${WORD})`, t.caseSensitive ? "u" : "iu").test(
      text,
    ),
  );
}

export interface GlossaryFinding {
  severity: "warning";
  code: "glossary-keep" | "glossary-term";
  message: string;
}

/**
 * Checks a translation against the terms its source uses. Fixed translations are matched
 * as substrings, since many languages inflect or attach particles (Arabic ال, Hindi का).
 */
export function checkGlossary(
  glossary: GlossaryTerm[],
  locale: string,
  sourceText: string,
  targetText: string,
): GlossaryFinding[] {
  const out: GlossaryFinding[] = [];
  const has = (needle: string, caseSensitive: boolean) =>
    caseSensitive
      ? targetText.includes(needle)
      : targetText.toLocaleLowerCase(locale).includes(needle.toLocaleLowerCase(locale));
  for (const t of glossaryHits(glossary, sourceText)) {
    if (!t.translate) {
      if (!has(t.term, t.caseSensitive)) {
        out.push({
          severity: "warning",
          code: "glossary-keep",
          message: `Keep "${t.term}" as written (glossary)`,
        });
      }
      continue;
    }
    const fixed = fixedTranslation(t, locale);
    if (fixed && !has(fixed, false)) {
      out.push({
        severity: "warning",
        code: "glossary-term",
        message: `Translate "${t.term}" as "${fixed}" (glossary)`,
      });
    }
  }
  return out;
}

export function fixedTranslation(term: GlossaryTerm, locale: string): string | undefined {
  return term.translations?.[locale] ?? term.translations?.[locale.split("-")[0] as string];
}

/** True when a text is only glossary terms kept as written, so a copy isn't "untranslated". */
export function onlyKeptTerms(glossary: GlossaryTerm[], text: string): boolean {
  let rest = text;
  for (const t of glossary) {
    if (t.translate) continue;
    rest = rest.replace(
      new RegExp(`(?<!${WORD})${escapeRegExp(t.term)}(?!${WORD})`, t.caseSensitive ? "gu" : "giu"),
      "",
    );
  }
  return rest !== text && !/\p{L}{2,}/u.test(rest);
}

export interface ContextUpdate {
  brief?: string;
  /** Locale (or `all`) → voice guidance. */
  voice?: Record<string, string>;
  /** Replaces the whole glossary. */
  glossary?: Array<z.input<typeof TermSchema>>;
}

/** Writes context files. Returns the files written, relative to the context folder. */
export async function writeContext(
  fs: FileSystem,
  dir: string,
  update: ContextUpdate,
): Promise<string[]> {
  const written: string[] = [];
  const write = async (rel: string, content: string) => {
    await fs.writeFile(path.join(dir, rel), content.endsWith("\n") ? content : `${content}\n`);
    written.push(rel);
  };
  if (update.brief !== undefined) await write(CONTEXT_FILES.brief, update.brief.trim());
  for (const [locale, text] of Object.entries(update.voice ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(locale)) throw new UserError(`"${locale}" is not a locale`);
    await write(`${CONTEXT_FILES.voiceDir}/${locale}.md`, text.trim());
  }
  if (update.glossary !== undefined) {
    const parsed = GlossarySchema.safeParse({ terms: update.glossary });
    if (!parsed.success) {
      throw new UserError(
        `Glossary is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
    }
    // Defaults are left out so the file stays short.
    const terms = update.glossary.map((t) =>
      Object.fromEntries(
        Object.entries(t).filter(
          ([k, v]) =>
            v !== undefined &&
            !(k === "translate" && v === true) &&
            !(k === "caseSensitive" && v === false),
        ),
      ),
    );
    await write(CONTEXT_FILES.glossary, new Document({ terms }).toString({ lineWidth: 0 }));
  }
  return written;
}
