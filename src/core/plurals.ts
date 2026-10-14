import { PLURAL_CATEGORIES, type PluralCategory, type PluralSpec } from "./model.js";

/** Counts used to describe and compare plural rules: every integer up to 1000, plus a few large and fractional ones. */
export const SAMPLE_INTEGERS = [...Array.from({ length: 1001 }, (_, i) => i), 10_000, 1_000_000];
export const SAMPLE_DECIMALS = [0.5, 1.5, 2.5];

/** Plural categories a locale needs, from CLDR via the runtime's ICU data. */
export function pluralCategories(locale: string): PluralCategory[] {
  const found = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
  return PLURAL_CATEGORIES.filter((c) => found.includes(c));
}

/** CLDR plural forms for a locale, with sample counts for each. */
export function cldrPluralSpec(locale: string): PluralSpec {
  const rules = new Intl.PluralRules(locale);
  return {
    scheme: "cldr",
    source: "CLDR",
    forms: pluralCategories(locale).map((id) => {
      const ints = SAMPLE_INTEGERS.filter((n) => rules.select(n) === id);
      const decimals = SAMPLE_DECIMALS.filter((n) => rules.select(n) === id);
      return {
        id,
        examples: describeSamples(ints, decimals),
        countImplied: ints.length === 1 && decimals.length === 0,
      };
    }),
  };
}

/** `[1, 21, 31, 41, 51, 61]` → `1, 21, 31, 41, 51…` */
export function describeSamples(ints: number[], decimals: number[] = []): string {
  const shown = ints.slice(0, 5).map(String);
  if (ints.length > 5) shown[shown.length - 1] += "…";
  if (ints.length === 0) shown.push(...decimals.map(String));
  return shown.join(", ");
}
