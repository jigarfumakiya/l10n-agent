import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import {
  expandPattern,
  formatLocaleSegment,
  inferLocaleStyle,
  matchPattern,
  parseLocaleSegment,
} from "../src/core/paths.js";

describe("locale segments", () => {
  it.each([
    ["pt_BR", "pt-BR"],
    ["sr@latin", "sr-Latn"],
    ["zh_Hans", "zh-Hans"],
    ["hi", "hi"],
    ["en-GB", "en-GB"],
    ["iw", "he"],
    ["fil", "fil"],
  ])("reads %s as %s", (segment, locale) => {
    expect(parseLocaleSegment(segment)).toBe(locale);
  });

  it("rejects names that are not locales", () => {
    for (const s of ["__pycache__", "LC_MESSAGES", "templates", "x", "src", "res", "lib"])
      expect(parseLocaleSegment(s)).toBeUndefined();
  });

  it.each([
    ["pt-BR", "pt_BR"],
    ["sr-Latn", "sr@latin"],
    ["zh-Hans", "zh_Hans"],
    ["hi", "hi"],
  ])("writes %s in gettext style as %s", (locale, segment) => {
    expect(formatLocaleSegment(locale, "gettext")).toBe(segment);
  });
});

describe("path patterns", () => {
  const fs = memoryFs({
    "/p/locale/hi/LC_MESSAGES/django.po": "",
    "/p/locale/pt_BR/LC_MESSAGES/django.po": "",
    "/p/locale/ar/LC_MESSAGES/other.po": "",
    "/p/locale/__pycache__/x": "",
    "/p/po/de.po": "",
    "/p/po/messages.pot": "",
  });

  it("matches a locale directory", async () => {
    const m = await matchPattern(fs, "/p", "locale/{locale}/LC_MESSAGES/django.po");
    expect(m.map((x) => [x.locale, x.segment])).toEqual([
      ["hi", "hi"],
      ["pt-BR", "pt_BR"],
    ]);
    expect(inferLocaleStyle(m, "bcp47")).toBe("gettext");
  });

  it("matches a locale in a file name", async () => {
    const m = await matchPattern(fs, "/p", "po/{locale}.po");
    expect(m.map((x) => x.locale)).toEqual(["de"]);
  });

  it("expands for new locales", () => {
    expect(expandPattern("locale/{locale}/LC_MESSAGES/django.po", "pt-BR", "gettext")).toBe(
      "locale/pt_BR/LC_MESSAGES/django.po",
    );
  });
});
