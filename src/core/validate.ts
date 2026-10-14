import type { FormatAdapter } from "../formats/types.js";
import { hashMessage } from "./hash.js";
import type { Entry, Issue, PluralCategory, ValueAnalysis } from "./model.js";
import { COUNT_IMPLIED_CATEGORIES, pluralCategories } from "./plurals.js";
import { type Project, projectLocales } from "./project.js";

export interface ValidateOptions {
  locales?: string[];
  /** Treat untranslated strings and missing locales as errors. */
  strict?: boolean;
}

/** Deterministic checks for every target, its source strings and each locale. */
export function validateProject(project: Project, opts: ValidateOptions = {}): Issue[] {
  const locales = opts.locales ?? projectLocales(project);
  const issues: Issue[] = [];
  for (const { loaded, adapter } of project.targets) {
    issues.push(...loaded.issues);
    const at = (e: Entry, locale: string) => ({
      target: loaded.id,
      locale,
      key: e.key,
      file: e.file,
      line: e.line,
    });

    for (const src of loaded.source.entries.values()) {
      if (!src.translatable) continue;
      issues.push(
        ...checkSource(adapter, src).map((i) => ({ ...at(src, loaded.source.locale), ...i })),
      );
    }

    for (const locale of locales) {
      const catalog = loaded.locales.get(locale);
      if (!catalog) {
        issues.push({
          severity: opts.strict ? "error" : "info",
          code: "locale-missing",
          message: `No ${locale} translations yet`,
          target: loaded.id,
          locale,
        });
        continue;
      }
      let missing = 0;
      for (const src of loaded.source.entries.values()) {
        if (src.translatable && !catalog.entries.has(src.key)) {
          missing++;
          if (opts.strict) {
            issues.push({
              ...at(src, locale),
              severity: "error",
              code: "missing",
              message: "Not translated",
            });
          }
        }
      }
      if (missing > 0 && !opts.strict) {
        issues.push({
          severity: "info",
          code: "missing",
          message: `${missing} string${missing === 1 ? "" : "s"} not translated yet`,
          target: loaded.id,
          locale,
        });
      }
      for (const tgt of catalog.entries.values()) {
        const src = loaded.source.entries.get(tgt.key);
        const where = at(tgt, locale);
        if (!src) {
          issues.push({
            ...where,
            severity: "warning",
            code: "orphan",
            message: "Not in the source strings any more",
          });
          continue;
        }
        // A copy of an untranslatable value (often an alias) is harmless.
        if (!src.translatable && hashMessage(src.message) !== hashMessage(tgt.message)) {
          issues.push({
            ...where,
            severity: "warning",
            code: "not-translatable",
            message: 'Source is marked translatable="false"; remove this translation',
          });
          continue;
        }
        if (!src.translatable) continue;
        issues.push(
          ...checkTranslation(adapter, src, tgt, locale, project.config.sourceLocale).map((i) => ({
            ...where,
            ...i,
          })),
        );
      }
    }
  }
  return issues;
}

type Found = Pick<Issue, "severity" | "code" | "message"> & { form?: string };

function checkSource(adapter: FormatAdapter<never>, src: Entry): Found[] {
  const out: Found[] = [];
  const each = (value: string, form?: string) => {
    const a = adapter.analyze(value, src);
    for (const l of a.lints) out.push({ ...l, ...(form ? { form } : {}) });
    const loose = a.placeholders.filter((p) => !p.positional);
    if (loose.length > 1) {
      out.push({
        severity: "warning",
        code: "placeholder-not-positional",
        message: `Use numbered placeholders (${loose.map((p, i) => `%${i + 1}$${p.type}`).join(", ")}) so translators can reorder them`,
        ...(form ? { form } : {}),
      });
    }
  };
  const m = src.message;
  if (m.kind === "text") each(m.value);
  else if (m.kind === "array") {
    for (const [i, v] of m.items.entries()) each(v, String(i));
  } else {
    if (m.forms.other === undefined) {
      out.push({
        severity: "error",
        code: "plural-missing-category",
        message: 'Plural has no "other" form',
      });
    }
    for (const [c, v] of Object.entries(m.forms)) each(v as string, c);
  }
  return out;
}

function checkTranslation(
  adapter: FormatAdapter<never>,
  src: Entry,
  tgt: Entry,
  locale: string,
  sourceLocale: string,
): Found[] {
  const s = src.message;
  const t = tgt.message;
  if (s.kind !== t.kind) {
    return [
      {
        severity: "error",
        code: "kind-mismatch",
        message: `Source is a ${s.kind}, translation is a ${t.kind}`,
      },
    ];
  }
  const sameLanguage = locale.split("-")[0] === sourceLocale.split("-")[0];
  const compare = (sv: string, tv: string, form?: string, countImplied = false) =>
    compareValues(adapter.analyze(sv, src), adapter.analyze(tv, tgt), {
      countImplied,
      sameLanguage,
    }).map((f) => (form ? { ...f, form } : f));

  if (s.kind === "text" && t.kind === "text") return compare(s.value, t.value);

  if (s.kind === "array" && t.kind === "array") {
    const out: Found[] = [];
    if (s.items.length !== t.items.length) {
      out.push({
        severity: "error",
        code: "array-length",
        message: `Source has ${s.items.length} items, translation has ${t.items.length}`,
      });
    }
    t.items.forEach((tv, i) => {
      const sv = s.items[i];
      if (sv !== undefined) out.push(...compare(sv, tv, String(i)));
    });
    return out;
  }

  if (s.kind === "plural" && t.kind === "plural") {
    const out: Found[] = [];
    const required = pluralCategories(locale);
    const missing = required.filter((c) => t.forms[c] === undefined);
    if (missing.length > 0) {
      out.push({
        severity: "error",
        code: "plural-missing-category",
        message: `${locale} needs plural forms ${required.join(", ")}; missing ${missing.join(", ")}`,
      });
    }
    for (const [c, tv] of Object.entries(t.forms) as Array<[PluralCategory, string]>) {
      if (!required.includes(c)) {
        out.push({
          severity: "warning",
          code: "plural-extra-category",
          message: `${locale} never uses the "${c}" form`,
          form: c,
        });
      }
      const sv = s.forms[c] ?? s.forms.other;
      if (sv !== undefined) out.push(...compare(sv, tv, c, COUNT_IMPLIED_CATEGORIES.has(c)));
    }
    return out;
  }
  return [];
}

export function compareValues(
  s: ValueAnalysis,
  t: ValueAnalysis,
  opts: { countImplied?: boolean; sameLanguage?: boolean } = {},
): Found[] {
  const out: Found[] = [...t.lints];

  const sp = new Map(s.placeholders.map((p) => [p.index, p]));
  const tp = new Map(t.placeholders.map((p) => [p.index, p]));
  for (const [i, p] of sp) {
    const other = tp.get(i);
    if (!other) {
      out.push({
        severity: opts.countImplied ? "warning" : "error",
        code: "placeholder-missing",
        message: `Missing ${p.raw}${p.positional ? "" : ` (argument ${i})`}`,
      });
    } else if (other.type !== p.type) {
      out.push({
        severity: "error",
        code: "placeholder-type",
        message: `${other.raw} should be a %${p.type} like ${p.raw}`,
      });
    }
  }
  for (const [i, p] of tp) {
    if (!sp.has(i))
      out.push({
        severity: "error",
        code: "placeholder-extra",
        message: `${p.raw} is not in the source`,
      });
  }

  const sx = s.tags
    .filter((x) => x.startsWith("xliff:g"))
    .sort()
    .join(",");
  const tx = t.tags
    .filter((x) => x.startsWith("xliff:g"))
    .sort()
    .join(",");
  if (sx !== tx)
    out.push({
      severity: "error",
      code: "xliff-mismatch",
      message: "<xliff:g> tags differ from the source",
    });
  const sm = s.tags
    .filter((x) => !x.startsWith("xliff:g"))
    .sort()
    .join(",");
  const tm = t.tags
    .filter((x) => !x.startsWith("xliff:g"))
    .sort()
    .join(",");
  if (sm !== tm) {
    out.push({
      severity: "warning",
      code: "markup-mismatch",
      message: `Markup differs: source has [${sm || "none"}], translation has [${tm || "none"}]`,
    });
  }

  if (t.text.trim() === "" && s.text.trim() !== "") {
    out.push({ severity: "error", code: "empty", message: "Translation is empty" });
  } else if (
    !opts.sameLanguage &&
    t.text === s.text &&
    // Single words ("Minute", "Dialog", "OK") are often the same across languages.
    /\p{L}+\s+\p{L}+/u.test(s.text)
  ) {
    out.push({ severity: "warning", code: "untranslated", message: "Same as the source text" });
  }
  const edge = (x: string) => [/^\s*/.exec(x)?.[0] ?? "", /\s*$/.exec(x)?.[0] ?? ""];
  const [sl, st] = edge(s.text);
  const [tl, tt] = edge(t.text);
  if (s.text.trim() !== "" && (sl !== tl || st !== tt)) {
    out.push({
      severity: "warning",
      code: "whitespace",
      message: "Leading or trailing whitespace differs from the source",
    });
  }
  return out;
}
