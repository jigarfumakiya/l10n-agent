import path from "node:path";
import type { Catalog, Entry, Issue, Message } from "../../core/model.js";
import { relativePath } from "../../core/paths.js";
import { findPlaceholders } from "../../core/placeholders.js";
import { cldrPluralSpec } from "../../core/plurals.js";
import type { FormatAdapter, Target, WriteResult } from "../types.js";
import {
  child,
  detectStyle,
  fromJs,
  type JObject,
  JsonError,
  type JsonStyle,
  parseJson,
  setPath,
  stringifyJson,
  toJs,
  XCODE_STYLE,
} from "./json.js";

export interface XcstringsTarget {
  id?: string;
  format: "xcstrings";
  /** The String Catalog, e.g. `App/Localizable.xcstrings`. Every language lives in this one file. */
  path: string;
}

/** Xcode sorts catalog keys the way Finder sorts names; object keys come out alphabetical too. */
const order = (a: string, b: string) => a.localeCompare(b, "en");

/** States that mean "a translation exists but nobody has confirmed it". */
const UNREVIEWED = new Set(["needs_review", "new", "stale"]);

interface StringUnit {
  state?: string;
  value?: string;
}
interface Localization {
  stringUnit?: StringUnit;
  variations?: { plural?: Record<string, { stringUnit?: StringUnit }>; device?: unknown };
  substitutions?: unknown;
}

export const xcstringsAdapter: FormatAdapter<XcstringsTarget> = {
  format: "xcstrings",

  async open(config, { fs, root, sourceLocale, id }) {
    const abs = path.resolve(root, config.path);
    const rel = relativePath(root, abs);
    const issues: Issue[] = [];
    const source: Catalog = { locale: sourceLocale, entries: new Map() };
    const locales = new Map<string, Catalog>();
    let doc: JObject | undefined;
    let style: JsonStyle = XCODE_STYLE;

    const target: Target = {
      id,
      format: "xcstrings",
      marksDrafts: true,
      label: config.path,
      source,
      locales,
      issues,
      translationsMayReorder: true,
      analyze: (value) => ({
        text: value,
        placeholders: findPlaceholders(value, "apple"),
        tags: [],
        lints: [],
      }),
      pluralSpec: (locale) => {
        const spec = cldrPluralSpec(locale);
        // Apple lets every language add a `zero` form for the count 0.
        if (!spec.forms.some((f) => f.id === "zero")) {
          spec.forms.unshift({ id: "zero", examples: "0", countImplied: true, optional: true });
          spec.source = "CLDR + Apple zero";
        }
        return spec;
      },
      writeLocale: (catalog) => writeLocale(catalog),
    };

    if (!(await fs.exists(abs))) {
      issues.push({
        severity: "error",
        code: "target-missing",
        message: `String Catalog not found: ${config.path}`,
        target: id,
      });
      return target;
    }

    const text = await fs.readFile(abs);
    try {
      const parsed = parseJson(text);
      if (parsed.kind !== "object") throw new JsonError("Expected an object at the top", 1);
      doc = parsed;
      style = detectStyle(text);
    } catch (e) {
      if (!(e instanceof JsonError)) throw e;
      issues.push({
        severity: "error",
        code: "json-malformed",
        message: e.message.replace(/ \(line \d+\)$/, ""),
        target: id,
        file: rel,
        line: e.line,
      });
      return target;
    }

    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    const lineOf = (offset = 0) => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((lineStarts[mid] as number) <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    };

    const fileSource = toJs(child(doc, "sourceLanguage"));
    const sourceLanguage = typeof fileSource === "string" ? fileSource : sourceLocale;
    if (sourceLanguage !== sourceLocale) {
      issues.push({
        severity: "warning",
        code: "source-language-mismatch",
        message: `The catalog's sourceLanguage is ${sourceLanguage}, the config says ${sourceLocale}`,
        target: id,
        file: rel,
      });
    }

    const strings = child(doc, "strings");
    let unsupported = 0;
    for (const e of strings?.kind === "object" ? strings.entries : []) {
      const key = e.key;
      const info = (toJs(e.value) ?? {}) as {
        comment?: string;
        extractionState?: string;
        shouldTranslate?: boolean;
        localizations?: Record<string, Localization>;
      };
      const locs = info.localizations ?? {};
      const variant = Object.values(locs).some((l) => l.substitutions || l.variations?.device);
      if (variant) unsupported++;
      const line = lineOf(e.offset);
      const base: Omit<Entry, "message"> = {
        key,
        // "" is Xcode's placeholder for empty Text(""); stale strings are gone from the code.
        translatable:
          key !== "" &&
          info.shouldTranslate !== false &&
          info.extractionState !== "stale" &&
          !variant,
        file: rel,
        line,
      };
      if (info.comment) base.comment = info.comment;
      const own = read(locs[sourceLanguage]);
      source.entries.set(key, { ...base, message: own?.message ?? { kind: "text", value: key } });

      // Skipped strings (unsupported variations, stale, shouldTranslate false) keep their
      // translations in the file untouched and out of checks.
      if (!base.translatable) continue;
      for (const [locale, loc] of Object.entries(locs)) {
        if (locale === sourceLanguage) continue;
        const found = read(loc);
        if (!found) continue;
        let catalog = locales.get(locale);
        if (!catalog) {
          catalog = { locale, entries: new Map() };
          locales.set(locale, catalog);
        }
        const entry: Entry = { ...base, message: found.message };
        if (found.unreviewed) entry.needsReview = true;
        catalog.entries.set(key, entry);
      }
    }
    if (unsupported > 0) {
      issues.push({
        severity: "info",
        code: "variation-unsupported",
        message: `${unsupported} string${unsupported === 1 ? " uses" : "s use"} device variations or substitutions, which aren't supported yet; skipped`,
        target: id,
        file: rel,
      });
    }

    async function writeLocale(catalog: Catalog): Promise<WriteResult> {
      if (!doc) throw new Error(`${rel} could not be read, so it can't be written`);
      for (const entry of catalog.entries.values()) {
        if (!source.entries.has(entry.key)) continue;
        const next = toLocalization(entry.message, entry.needsReview === true);
        const current = toJs(
          child(child(child(child(doc, "strings"), entry.key), "localizations"), catalog.locale),
        );
        if (JSON.stringify(sortDeep(current)) === JSON.stringify(sortDeep(next))) continue;
        setPath(
          doc,
          ["strings", entry.key, "localizations", catalog.locale],
          fromJs(next, order),
          order,
        );
      }
      await fs.writeFile(abs, stringifyJson(doc, style));
      return { files: [rel] };
    }

    return target;
  },
};

function read(
  loc: Localization | undefined,
): { message: Message; unreviewed: boolean } | undefined {
  if (!loc) return undefined;
  const plural = loc.variations?.plural;
  if (plural) {
    const forms: Record<string, string> = {};
    let unreviewed = false;
    for (const [category, v] of Object.entries(plural)) {
      const value = v.stringUnit?.value;
      if (value === undefined || value === "") continue;
      forms[category] = value;
      if (UNREVIEWED.has(v.stringUnit?.state ?? "")) unreviewed = true;
    }
    return Object.keys(forms).length
      ? { message: { kind: "plural", forms }, unreviewed }
      : undefined;
  }
  const unit = loc.stringUnit;
  if (!unit?.value) return undefined;
  return {
    message: { kind: "text", value: unit.value },
    unreviewed: UNREVIEWED.has(unit.state ?? ""),
  };
}

function toLocalization(message: Message, needsReview: boolean): Localization {
  const state = needsReview ? "needs_review" : "translated";
  if (message.kind === "plural") {
    const plural: Record<string, { stringUnit: StringUnit }> = {};
    for (const [category, value] of Object.entries(message.forms))
      plural[category] = { stringUnit: { state, value } };
    return { variations: { plural } };
  }
  const value = message.kind === "text" ? message.value : message.items.join("\n");
  return { stringUnit: { state, value } };
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.keys(v)
      .sort(order)
      .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]),
  );
}
