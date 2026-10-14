import { describe, expect, it } from "vitest";
import {
  defaultPluralForms,
  gettextPluralSpec,
  outOfRangeForms,
  parsePluralForms,
} from "../src/formats/po/plural-forms.js";

describe("Plural-Forms", () => {
  it("evaluates C expressions with the right precedence", () => {
    const ar = parsePluralForms(defaultPluralForms("ar") as string);
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102, 103].map(ar.select)).toEqual([
      0, 1, 2, 3, 3, 4, 4, 5, 5, 3,
    ]);
    const ru = parsePluralForms(defaultPluralForms("ru") as string);
    expect([1, 2, 5, 11, 21, 22, 25, 111].map(ru.select)).toEqual([0, 1, 2, 2, 0, 1, 2, 2]);
    const cs = parsePluralForms("nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;");
    expect([1, 3, 5].map(cs.select)).toEqual([0, 1, 2]);
    expect(parsePluralForms("nplurals=2; plural=!(n == 1);").select(1)).toBe(0);
  });

  it("rejects anything that isn't a plural expression", () => {
    expect(() => parsePluralForms("nplurals=2; plural=process.exit();")).toThrow(/Unsupported/);
    expect(() => parsePluralForms("nplurals=INTEGER; plural=EXPRESSION;")).toThrow();
    expect(() => parsePluralForms("nplurals=2; plural=(n > ;")).toThrow();
  });

  it("finds rules that return a form beyond nplurals", () => {
    expect(outOfRangeForms(parsePluralForms("nplurals=2; plural=n%3;"))).toEqual([2]);
  });

  it.each([
    ["en", "nplurals=2; plural=(n != 1);"],
    ["de", "nplurals=2; plural=(n != 1);"],
    ["hi", "nplurals=2; plural=(n > 1);"],
    ["fr", "nplurals=2; plural=(n > 1);"],
    ["ja", "nplurals=1; plural=0;"],
    ["pt-BR", "nplurals=2; plural=(n > 1);"],
  ])("derives a default rule for %s", (locale, rule) => {
    expect(defaultPluralForms(locale)).toBe(rule);
  });

  it("has no guess for languages it can't derive", () => {
    expect(defaultPluralForms("he")).toBeUndefined();
  });

  it("describes each form with sample counts", () => {
    const spec = gettextPluralSpec(parsePluralForms(defaultPluralForms("ru") as string), "test");
    expect(spec.forms.map((f) => [f.id, f.examples, f.countImplied])).toEqual([
      ["0", "1, 21, 31, 41, 51…", false],
      ["1", "2, 3, 4, 22, 23…", false],
      ["2", "0, 5, 6, 7, 8…", false],
    ]);
    const ar = gettextPluralSpec(parsePluralForms(defaultPluralForms("ar") as string), "test");
    expect(ar.forms.filter((f) => f.countImplied).map((f) => f.id)).toEqual(["0", "1", "2"]);
  });
});
