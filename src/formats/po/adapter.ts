import path from "node:path";
import type { Catalog, Entry, Issue, Message, PluralSpec } from "../../core/model.js";
import {
  expandPattern,
  inferLocaleStyle,
  matchPattern,
  parseLocaleSegment,
} from "../../core/paths.js";
import { findPlaceholders, type PlaceholderSyntax } from "../../core/placeholders.js";
import { pluralCategories } from "../../core/plurals.js";
import type { FormatAdapter, Target, WriteResult } from "../types.js";
import {
  defaultPluralForms,
  gettextPluralSpec,
  outOfRangeForms,
  type PluralForms,
  PluralFormsError,
  parsePluralForms,
} from "./plural-forms.js";
import { entryKey, type PoEntry, PoFile, PoParseError } from "./po-file.js";

export interface PoTarget {
  id?: string;
  format: "po";
  /** Path pattern with `{locale}`, e.g. `locale/{locale}/LC_MESSAGES/django.po` or `po/{locale}.po`. */
  path: string;
  /** Optional `.pot` template holding the source strings. */
  template?: string;
  /** Placeholder syntax for entries without a `*-format` flag. Default: `none`. */
  placeholders?: PlaceholderSyntax;
  /** `Plural-Forms` for locales whose files don't declare one (and for new files). */
  pluralForms?: Record<string, string>;
}

/** gettext `*-format` flags → the syntax that finds their arguments. */
const FLAG_SYNTAX: Record<string, PlaceholderSyntax> = {
  "c-format": "c",
  "objc-format": "c",
  "php-format": "c",
  "javascript-format": "c",
  "java-printf-format": "java",
  "python-format": "python",
  "python-brace-format": "python-brace",
  "perl-brace-format": "python-brace",
  "java-format": "java-message",
  "qt-format": "qt",
  "kde-format": "qt",
  "ruby-format": "ruby",
};

export function syntaxForFlags(
  flags: string[] | undefined,
  fallback: PlaceholderSyntax,
): PlaceholderSyntax {
  for (const f of flags ?? []) {
    if (f.startsWith("no-") && f.endsWith("-format")) return "none";
    const s = FLAG_SYNTAX[f];
    if (s) return s;
  }
  return fallback;
}

export const poAdapter: FormatAdapter<PoTarget> = {
  format: "po",

  async open(config, { fs, root, sourceLocale, id }) {
    const issues: Issue[] = [];
    const source: Catalog = { locale: sourceLocale, entries: new Map() };
    const locales = new Map<string, Catalog>();
    const files = new Map<string, { file: string; po: PoFile; byKey: Map<string, PoEntry> }>();
    const plural = new Map<string, PluralForms>();
    /** Source entries as gettext entries, to copy comments and ids into new translations. */
    const sourcePo = new Map<string, PoEntry>();
    let template: PoFile | undefined;
    const rel = (abs: string) => path.relative(root, abs);

    const read = async (abs: string, locale: string): Promise<PoFile | undefined> => {
      try {
        return PoFile.parse(await fs.readFile(abs));
      } catch (e) {
        if (!(e instanceof PoParseError)) throw e;
        issues.push({
          severity: "error",
          code: "po-malformed",
          message: e.message.replace(/ \(line \d+\)$/, ""),
          target: id,
          locale,
          file: rel(abs),
          line: e.line,
        });
        return undefined;
      }
    };

    const indexEntries = (po: PoFile, abs: string, locale: string) => {
      const byKey = new Map<string, PoEntry>();
      for (const e of po.entries()) {
        const key = entryKey(e);
        const prior = byKey.get(key);
        if (prior) {
          issues.push({
            severity: "error",
            code: "duplicate-key",
            message: `Also defined at line ${prior.line}`,
            target: id,
            locale,
            key,
            file: rel(abs),
            line: e.line,
          });
          continue;
        }
        byKey.set(key, e);
      }
      return byKey;
    };

    const matches = await matchPattern(fs, root, config.path);
    const style = inferLocaleStyle(matches, "gettext");
    for (const m of matches) {
      const po = await read(m.file, m.locale);
      if (po) files.set(m.locale, { file: m.file, po, byKey: indexEntries(po, m.file, m.locale) });
    }

    // Source strings: the template, else the source locale's own file, else every msgid seen.
    if (config.template) {
      const abs = path.resolve(root, config.template);
      if (await fs.exists(abs)) {
        template = await read(abs, sourceLocale);
        if (template) {
          for (const [k, e] of indexEntries(template, abs, sourceLocale)) addSource(k, e, abs);
        }
      } else {
        issues.push({
          severity: "error",
          code: "target-missing",
          message: `Template not found: ${config.template}`,
          target: id,
        });
      }
    } else {
      const own = files.get(sourceLocale);
      const ordered = own
        ? [own, ...[...files.values()].filter((f) => f !== own)]
        : [...files.values()];
      for (const f of ordered)
        for (const [k, e] of f.byKey) if (!source.entries.has(k)) addSource(k, e, f.file);
    }

    function addSource(key: string, e: PoEntry, abs: string) {
      sourcePo.set(key, e);
      const message: Message =
        e.msgidPlural === undefined
          ? { kind: "text", value: e.msgid }
          : { kind: "plural", forms: { one: e.msgid, other: e.msgidPlural } };
      source.entries.set(key, {
        key,
        message,
        translatable: true,
        file: rel(abs),
        line: e.line,
        ...describe(e),
      });
    }

    for (const [locale, f] of files) {
      if (locale === sourceLocale) continue;
      checkHeader(locale, f.po, f.file);
      const catalog: Catalog = { locale, entries: new Map() };
      for (const [key, e] of f.byKey) {
        const message = translation(e);
        if (!message) continue;
        const entry: Entry = {
          key,
          message,
          translatable: true,
          file: rel(f.file),
          line: e.line,
          ...describe(e),
        };
        if (e.flags.includes("fuzzy")) entry.needsReview = true;
        catalog.entries.set(key, entry);
      }
      if (catalog.entries.size > 0) locales.set(locale, catalog);
    }

    function checkHeader(locale: string, po: PoFile, abs: string) {
      const fields = po.headerFields();
      const at = { target: id, locale, file: rel(abs), line: po.header()?.line ?? 1 };
      const lang = fields.get("Language");
      if (lang && !sameLanguage(parseLocaleSegment(lang), locale)) {
        issues.push({
          ...at,
          severity: "warning",
          code: "language-mismatch",
          message: `Header says Language: ${lang}, but the file is for ${locale}`,
        });
      }
      const header = fields.get("Plural-Forms");
      const hasPlurals = po.entries().some((e) => e.msgidPlural !== undefined);
      if (!header) {
        if (hasPlurals) {
          issues.push({
            ...at,
            severity: defaultFor(locale) ? "warning" : "error",
            code: "plural-forms-missing",
            message: defaultFor(locale)
              ? `No Plural-Forms header; assuming "${defaultFor(locale)}"`
              : `No Plural-Forms header, and no standard rule for ${locale}. Set pluralForms.${locale} in the config.`,
          });
        }
        return;
      }
      let forms: PluralForms;
      try {
        forms = parsePluralForms(header);
      } catch (e) {
        if (!(e instanceof PluralFormsError)) throw e;
        issues.push({ ...at, severity: "error", code: "plural-forms-invalid", message: e.message });
        return;
      }
      plural.set(locale, forms);
      const bad = outOfRangeForms(forms);
      if (bad.length) {
        issues.push({
          ...at,
          severity: "error",
          code: "plural-forms-invalid",
          message: `plural= returns ${bad.join(", ")}, but nplurals=${forms.nplurals}`,
        });
      }
      const standard = defaultFor(locale);
      if (standard) {
        const expected = parsePluralForms(standard).nplurals;
        // Transifex-style files add a form for fractions, matching CLDR's category count.
        const cldr = pluralCategories(locale).length;
        if (expected !== forms.nplurals && cldr !== forms.nplurals) {
          issues.push({
            ...at,
            severity: "warning",
            code: "plural-forms-unexpected",
            message: `${locale} usually has ${expected} plural forms, this file declares ${forms.nplurals}. Standard: ${standard}`,
          });
        }
      }
    }

    function defaultFor(locale: string): string | undefined {
      return config.pluralForms?.[locale] ?? defaultPluralForms(locale);
    }

    function formsFor(locale: string): PluralForms | undefined {
      const declared = plural.get(locale);
      if (declared) return declared;
      const fallback = defaultFor(locale);
      return fallback ? parsePluralForms(fallback) : undefined;
    }

    async function writeLocale(catalog: Catalog): Promise<WriteResult> {
      const locale = catalog.locale;
      let f = files.get(locale);
      if (!f) {
        const abs = path.resolve(root, expandPattern(config.path, locale, style));
        const po = newFile(locale);
        f = { file: abs, po, byKey: new Map(po.entries().map((e) => [entryKey(e), e])) };
        files.set(locale, f);
      }
      const nplurals = formsFor(locale)?.nplurals;
      for (const entry of catalog.entries.values()) {
        let po = f.byKey.get(entry.key);
        if (!po) {
          const src = sourcePo.get(entry.key);
          if (!src) continue;
          po = blankFrom(src, nplurals);
          f.po.add(po);
          f.byKey.set(entry.key, po);
        }
        f.po.update(po, toMsgstr(entry.message, nplurals), entry.needsReview === true);
      }
      await fs.writeFile(f.file, f.po.toString());
      return { files: [rel(f.file)] };
    }

    function newFile(locale: string): PoFile {
      const base = template ?? files.get(sourceLocale)?.po;
      const po = PoFile.create({ eol: base?.eol, wrap: base?.wrap });
      const fields = new Map(base?.headerFields() ?? []);
      fields.set("Language", locale.replace(/-/g, "_"));
      fields.set("MIME-Version", fields.get("MIME-Version") ?? "1.0");
      fields.set("Content-Type", "text/plain; charset=UTF-8");
      fields.set("Content-Transfer-Encoding", "8bit");
      const forms = defaultFor(locale);
      if (forms) fields.set("Plural-Forms", forms);
      po.setHeader(fields);
      const nplurals = forms ? parsePluralForms(forms).nplurals : undefined;
      for (const src of sourcePo.values()) po.add(blankFrom(src, nplurals));
      return po;
    }

    return {
      id,
      format: "po",
      label: config.path,
      source,
      locales,
      issues,
      strictNewlines: true,
      analyze(value, entry) {
        const syntax = syntaxForFlags(entry.flags, config.placeholders ?? "none");
        return { text: value, placeholders: findPlaceholders(value, syntax), tags: [], lints: [] };
      },
      pluralSpec(locale): PluralSpec | undefined {
        const declared = plural.get(locale);
        if (declared) return gettextPluralSpec(declared, "Plural-Forms header");
        const fallback = defaultFor(locale);
        if (!fallback) return undefined;
        const from = config.pluralForms?.[locale] ? "config pluralForms" : "standard rule";
        return gettextPluralSpec(parsePluralForms(fallback), from);
      },
      writeLocale,
    } satisfies Target;
  },
};

/** `zh_CN` and `zh-Hans` name the same written language: compare after adding likely subtags. */
function sameLanguage(a: string | undefined, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  try {
    const x = new Intl.Locale(a).maximize();
    const y = new Intl.Locale(b).maximize();
    return x.language === y.language && x.script === y.script;
  } catch {
    return false;
  }
}

function describe(e: PoEntry): Partial<Entry> {
  const out: Partial<Entry> = {};
  if (e.extractedComments.length) out.comment = e.extractedComments.join("\n");
  if (e.msgctxt !== undefined) out.context = e.msgctxt;
  if (e.references.length) out.references = [...e.references];
  const flags = e.flags.filter((f) => f !== "fuzzy");
  if (flags.length) out.flags = flags;
  return out;
}

/** The translation in a gettext entry, or undefined when it has none yet. */
function translation(e: PoEntry): Message | undefined {
  if (e.msgidPlural === undefined) {
    const v = e.msgstr[0] ?? "";
    return v === "" ? undefined : { kind: "text", value: v };
  }
  if (e.msgstr.every((v) => v === "")) return undefined;
  return { kind: "plural", forms: Object.fromEntries(e.msgstr.map((v, i) => [String(i), v])) };
}

function toMsgstr(message: Message, nplurals: number | undefined): string[] {
  if (message.kind === "text") return [message.value];
  if (message.kind === "array") return [message.items.join("\n")];
  const indexes = Object.keys(message.forms)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  const count = nplurals ?? (indexes.length ? Math.max(...indexes) + 1 : 2);
  return Array.from({ length: count }, (_, i) => message.forms[String(i)] ?? "");
}

function blankFrom(src: PoEntry, nplurals: number | undefined): PoEntry {
  return {
    translatorComments: [],
    extractedComments: [...src.extractedComments],
    references: [...src.references],
    flags: src.flags.filter((f) => f !== "fuzzy"),
    msgctxt: src.msgctxt,
    msgid: src.msgid,
    msgidPlural: src.msgidPlural,
    msgstr: src.msgidPlural === undefined ? [""] : Array.from({ length: nplurals ?? 2 }, () => ""),
    line: 0,
  };
}
