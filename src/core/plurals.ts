import { PLURAL_CATEGORIES, type PluralCategory } from "./model.js";

/** Plural categories a locale needs, from CLDR via the runtime's ICU data. */
export function pluralCategories(locale: string): PluralCategory[] {
  const found = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
  return PLURAL_CATEGORIES.filter((c) => found.includes(c));
}

/**
 * Categories whose form may leave out the number, because the word alone says it
 * ("one day", Arabic dual "يومان"). A missing placeholder there is only a warning.
 */
export const COUNT_IMPLIED_CATEGORIES: ReadonlySet<PluralCategory> = new Set([
  "zero",
  "one",
  "two",
]);
