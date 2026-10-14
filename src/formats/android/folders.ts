/**
 * Maps BCP 47 locales to Android resource folders and back.
 *   hi → values-hi · pt-BR → values-pt-rBR · sr-Latn → values-b+sr+Latn · es-419 → values-b+es+419
 */

/** Android Studio still writes the pre-1989 codes for these, and every Android version reads them. */
const LEGACY_CODES: Record<string, string> = { he: "iw", id: "in", yi: "ji" };

export function localeToFolder(locale: string): string {
  const [lang = "", ...rest] = locale.split("-");
  const region = rest.find((p) => /^[A-Za-z]{2}$/.test(p));
  const simple = /^[a-z]{2}$/i.test(lang) && rest.length === (region ? 1 : 0);
  if (simple) {
    const code = LEGACY_CODES[lang.toLowerCase()] ?? lang.toLowerCase();
    return region ? `values-${code}-r${region.toUpperCase()}` : `values-${code}`;
  }
  return `values-b+${locale.split("-").join("+")}`;
}

/** Returns the locale for a folder, `null` for the default `values`, or `undefined` if it isn't a plain locale folder. */
export function folderToLocale(folder: string): string | null | undefined {
  if (folder === "values") return null;
  let tag: string | undefined;
  const legacy = /^values-([a-z]{2,3})(?:-r([A-Z]{2}))?$/.exec(folder);
  // `values-car` is the car UI-mode qualifier, not the Carib language.
  if (legacy && legacy[1] !== "car") tag = legacy[2] ? `${legacy[1]}-${legacy[2]}` : legacy[1];
  const bcp = /^values-b\+([A-Za-z0-9+]+)$/.exec(folder);
  if (bcp?.[1]) tag = bcp[1].split("+").join("-");
  if (!tag) return undefined;
  try {
    // Also turns legacy codes into current ones: in → id, iw → he, ji → yi.
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}
