import { describe, expect, it } from "vitest";
import { folderToLocale, localeToFolder } from "../src/formats/android/folders.js";

describe("locale folders", () => {
  it.each([
    ["hi", "values-hi"],
    ["ar", "values-ar"],
    ["pt-BR", "values-pt-rBR"],
    ["sr-Latn", "values-b+sr+Latn"],
    ["es-419", "values-b+es+419"],
    ["fil", "values-b+fil"],
  ])("%s ↔ %s", (locale, folder) => {
    expect(localeToFolder(locale)).toBe(folder);
    expect(folderToLocale(folder)).toBe(locale);
  });

  it("reads legacy three-letter folders and ignores other qualifiers", () => {
    expect(folderToLocale("values-fil")).toBe("fil");
    expect(folderToLocale("values")).toBeNull();
    for (const f of [
      "values-night",
      "values-v31",
      "values-sw600dp",
      "values-car",
      "values-hi-night",
    ]) {
      expect(folderToLocale(f)).toBeUndefined();
    }
  });
});

describe("legacy language codes", () => {
  it("reads values-in / values-iw as id / he and writes what Android Studio writes", () => {
    expect(folderToLocale("values-in")).toBe("id");
    expect(folderToLocale("values-iw-rIL")).toBe("he-IL");
    expect(localeToFolder("he")).toBe("values-iw");
    expect(localeToFolder("id-ID")).toBe("values-in-rID");
  });
});
