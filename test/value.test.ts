import { describe, expect, it } from "vitest";
import { analyzeAndroidValue, findPlaceholders } from "../src/formats/android/value.js";

const codes = (raw: string) => analyzeAndroidValue(raw).lints.map((l) => l.code);

describe("analyzeAndroidValue", () => {
  it("resolves escapes, entities and whitespace like aapt2", () => {
    expect(analyzeAndroidValue("Don\\'t  stop\\n now &amp; ever ").text).toBe(
      "Don't stop\n now & ever",
    );
    expect(analyzeAndroidValue('"  keep   spaces  "').text).toBe("  keep   spaces  ");
    expect(analyzeAndroidValue("\\u0041\\@").text).toBe("A@");
    expect(analyzeAndroidValue("<![CDATA[<b>x</b>]]>").text).toBe("<b>x</b>");
  });

  it("collects markup tags, naming xliff:g by id", () => {
    const a = analyzeAndroidValue('Read <b>terms</b> <xliff:g id="date">%1$s</xliff:g>');
    expect(a.tags).toEqual(["b", "xliff:g#date"]);
    expect(a.text).toBe("Read terms %1$s");
  });

  it.each([
    ["Don't", "escape-apostrophe"],
    ['Say "hi" now', "escape-quote"],
    ['Odd " quote', "escape-quote"],
    ["@home", "escape-leading-reference"],
    ["?attr", "escape-leading-reference"],
    ["bad \\q", "escape-unknown"],
    ["\\u12", "escape-invalid"],
    ["<b>open", "xml-malformed"],
  ])("flags %s", (raw, code) => {
    expect(codes(raw)).toContain(code);
  });

  it("accepts correct values", () => {
    for (const raw of ["Don\\'t", '"It\'s fine"', "\\@home", 'Say \\"hi\\"'])
      expect(codes(raw)).toEqual([]);
  });

  it("skips placeholders when formatted=false", () => {
    expect(analyzeAndroidValue("100%d", { formatted: false }).placeholders).toEqual([]);
  });
});

describe("findPlaceholders", () => {
  it("numbers positional and ordinal arguments", () => {
    expect(findPlaceholders("%2$d of %1$s").map((p) => [p.index, p.type])).toEqual([
      [2, "d"],
      [1, "s"],
    ]);
    expect(findPlaceholders("%s spent %.2f").map((p) => [p.index, p.type, p.positional])).toEqual([
      [1, "s", false],
      [2, "f", false],
    ]);
  });

  it("ignores %%, %n and prose like 50% off", () => {
    expect(findPlaceholders("100%% sure%n 50% off")).toEqual([]);
  });
});

describe("resource references", () => {
  it("treats a whole-value reference as an alias, not an escaping mistake", () => {
    for (const raw of ["@string/ok", "@android:string/ok", "?attr/label", " @string/a.b "]) {
      expect(analyzeAndroidValue(raw).lints).toEqual([]);
    }
    expect(codes("@ home")).toContain("escape-leading-reference");
  });
});
