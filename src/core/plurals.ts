import { PLURAL_CATEGORIES, type PluralCategory, type PluralSpec } from "./model.js";

/** Counts used to describe and compare plural rules: every integer up to 1000, plus a few large and fractional ones. */
export const SAMPLE_INTEGERS = [...Array.from({ length: 1001 }, (_, i) => i), 10_000, 1_000_000];
export const SAMPLE_DECIMALS = [0.5, 1.5, 2.5];

// Bounded for long-lived MCP servers. Callers receive copies: Apple adds an optional zero.
const specs = new Map<string, PluralSpec>();
const copySpec = (spec: PluralSpec): PluralSpec => ({
  ...spec,
  forms: spec.forms.map((form) => ({ ...form })),
});

/** Plural categories a locale needs, from CLDR via the runtime's ICU data. */
export function pluralCategories(locale: string): PluralCategory[] {
  const found = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
  return PLURAL_CATEGORIES.filter((c) => found.includes(c));
}

/** CLDR plural forms for a locale, with sample counts for each. */
export function cldrPluralSpec(locale: string): PluralSpec {
  const key = Intl.getCanonicalLocales(locale)[0] ?? locale;
  const cached = specs.get(key);
  if (cached) return copySpec(cached);
  const rules = new Intl.PluralRules(locale);
  const integers = new Map<string, number[]>();
  const fractions = new Map<string, number[]>();
  for (const [samples, grouped] of [
    [SAMPLE_INTEGERS, integers],
    [SAMPLE_DECIMALS, fractions],
  ] as const) {
    for (const n of samples) {
      const category = rules.select(n);
      const values = grouped.get(category) ?? [];
      values.push(n);
      grouped.set(category, values);
    }
  }
  const categories = rules.resolvedOptions().pluralCategories;
  const spec: PluralSpec = {
    scheme: "cldr",
    source: "CLDR",
    forms: PLURAL_CATEGORIES.filter((id) => categories.includes(id)).map((id) => {
      const ints = integers.get(id) ?? [];
      const decimals = fractions.get(id) ?? [];
      return {
        id,
        examples: describeSamples(ints, decimals),
        countImplied: ints.length === 1 && decimals.length === 0,
        ...(ints.length === 0 ? { decimalOnly: true } : {}),
      };
    }),
  };
  const oldest = specs.keys().next().value;
  if (specs.size >= 256 && oldest !== undefined) specs.delete(oldest);
  specs.set(key, spec);
  return copySpec(spec);
}

/** `[1, 21, 31, 41, 51, 61]` → `1, 21, 31, 41, 51…` */
export function describeSamples(ints: number[], decimals: number[] = []): string {
  const shown = ints.slice(0, 5).map(String);
  if (ints.length > 5) shown[shown.length - 1] += "…";
  if (ints.length === 0) shown.push(...decimals.map(String));
  return shown.join(", ");
}
