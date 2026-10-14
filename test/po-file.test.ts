import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyEntry, entryKey, formatString, PoFile } from "../src/formats/po/po-file.js";
import { fixture } from "./helpers.js";

const FILES = [
  "po/django/locale/django.pot",
  "po/django/locale/hi/LC_MESSAGES/django.po",
  "po/django/locale/ar/LC_MESSAGES/django.po",
  "po/django/locale/ru/LC_MESSAGES/django.po",
];
const read = (f: string) => readFileSync(fixture(f), "utf8");
const hasMsgcat = (() => {
  try {
    execFileSync("msgcat", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

describe("PoFile", () => {
  it.each(FILES)("round-trips %s byte for byte", (f) => {
    expect(PoFile.parse(read(f)).toString()).toBe(read(f));
  });

  it("reads entries, context, plurals, comments and flags", () => {
    const po = PoFile.parse(read("po/django/locale/hi/LC_MESSAGES/django.po"));
    const entries = po.entries();
    expect(entries.map(entryKey)).toContain("button\u0004Save");
    const plural = entries.find((e) => e.msgidPlural);
    expect(plural?.msgstr).toEqual(["%(count)d दिन बाकी", "%(count)d दिन बाकी"]);
    const paywall = entries.find((e) => e.msgid === "Unlock Pro");
    expect(paywall?.flags).toEqual(["fuzzy"]);
    expect(paywall?.extractedComments).toEqual([
      "Translators: shown on the paywall, keep it short.",
    ]);
    expect(paywall?.references).toEqual(["app/templates/paywall.html:5"]);
    const long = entries.at(-1);
    expect(long?.msgid).toBe(
      "Your safe-to-spend amount updates every time you log an expense, so you always know what is left for today.",
    );
    expect(entries.some((e) => e.msgid === "Old feature")).toBe(false);
    expect(po.headerFields().get("Plural-Forms")).toBe("nplurals=2; plural=(n > 1);");
  });

  it("rewrites only the entry that changed", () => {
    const src = read("po/django/locale/hi/LC_MESSAGES/django.po");
    const po = PoFile.parse(src);
    const long = po.entries().at(-1);
    if (!long) throw new Error("no entry");
    po.update(
      long,
      [
        "आपकी सुरक्षित खर्च राशि हर बार खर्च दर्ज करने पर अपडेट होती है, ताकि आपको हमेशा पता रहे कि आज के लिए कितना बचा है।",
      ],
      false,
    );
    const out = po.toString();
    const changed = diffLines(src, out);
    // `msgstr ""` stays as the first line of the wrapped value; only its lines are added.
    expect(changed.removed).toEqual([]);
    expect(changed.added.length).toBeGreaterThan(1);
    expect(changed.added.every((l) => l.startsWith('"'))).toBe(true);
    expect(out).toContain(
      'msgid ""\n"Your safe-to-spend amount updates every time you log an expense, so you "\n"always know what is left for today."\nmsgstr ""\n"आपकी',
    );
  });

  it("clearing fuzzy also drops the previous msgid", () => {
    const po = PoFile.parse(read("po/django/locale/hi/LC_MESSAGES/django.po"));
    const paywall = po.entries().find((e) => e.msgid === "Unlock Pro");
    if (!paywall) throw new Error("no entry");
    po.update(paywall, ["प्रो अनलॉक करें"], false);
    const out = po.toString();
    expect(out).not.toContain("#| msgid");
    expect(out).toContain(
      '#. Translators: shown on the paywall, keep it short.\n#: app/templates/paywall.html:5\nmsgid "Unlock Pro"',
    );
  });

  it("decodes C escapes", () => {
    const po = PoFile.parse('msgid "a\\tb\\n\\"q\\" \\\\ \\101\\x42"\nmsgstr ""\n');
    expect(po.entries()[0]?.msgid).toBe('a\tb\n"q" \\ AB');
  });

  it("reports the line of a malformed entry", () => {
    expect(() => PoFile.parse('msgid "a"\nmsgstr "b"\nnonsense\n')).toThrow(/line 3/);
  });

  it.skipIf(!hasMsgcat)("wraps exactly like msgcat, including Devanagari and long words", () => {
    const words = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do".split(" ");
    const samples: string[] = [
      "Line one\nLine two\n",
      'Tab\tand "quotes"',
      "x".repeat(120),
      "a ".repeat(70),
    ];
    for (let len = 60; len <= 90; len += 3) {
      let s = "";
      for (let i = 0; s.length < len; i++) s += (s ? " " : "") + words[i % words.length];
      samples.push(s.slice(0, len));
    }
    samples.push("आज खर्च करने के लिए सुरक्षित राशि बहुत अधिक है और यह संदेश बहुत लंबा है ताकि लपेटा जाए");
    const po = PoFile.create();
    po.setHeader(new Map([["Content-Type", "text/plain; charset=UTF-8"]]));
    samples.forEach((s, i) => {
      po.add({ ...emptyEntry(`id${i} ${s}`), msgstr: [s] });
    });
    const ours = po.toString();
    expect(execFileSync("msgcat", ["-"], { input: ours }).toString()).toBe(ours);
  });

  it("keeps --no-wrap files unwrapped", () => {
    expect(formatString("msgstr", "x ".repeat(60), false)).toEqual([`msgstr "${"x ".repeat(60)}"`]);
    const po = PoFile.parse(`msgid "a"\nmsgstr "${"long ".repeat(20)}"\n`);
    expect(po.wrap).toBe(false);
  });
});

function diffLines(a: string, b: string) {
  const al = a.split("\n");
  const bl = b.split("\n");
  let start = 0;
  while (start < al.length && al[start] === bl[start]) start++;
  let endA = al.length - 1;
  let endB = bl.length - 1;
  while (endA >= start && endB >= start && al[endA] === bl[endB]) {
    endA--;
    endB--;
  }
  return { removed: al.slice(start, endA + 1), added: bl.slice(start, endB + 1) };
}
