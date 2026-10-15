import { describe, expect, it } from "vitest";
import { checkGlossary, glossaryHits, onlyKeptTerms } from "../src/core/context.js";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { computeStatus } from "../src/core/status.js";
import { validateProject } from "../src/core/validate.js";
import { approve, nextBatch, prune, removeTranslations, submit } from "../src/core/workflow.js";
import { prepareAndroidValue } from "../src/formats/android/value.js";

const STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Button that saves the budget -->
    <string name="save">Save</string>
    <string name="welcome">Welcome to StillMoney, %1$s!</string>
    <string name="brand" translatable="false">StillMoney</string>
    <plurals name="days_left">
        <item quantity="one">%d day left</item>
        <item quantity="other">%d days left</item>
    </plurals>
    <string name="cancel">Cancel</string>
</resources>
`;

const IOS = JSON.stringify(
  {
    sourceLanguage: "en",
    strings: {
      Cancel: { comment: "Dismisses a sheet" },
    },
    version: "1.0",
  },
  null,
  2,
);

function project(files: Record<string, string> = {}) {
  return memoryFs({
    "/p/localship.yaml": [
      "locales: [hi, ar]",
      "targets:",
      "  - format: android-xml",
      "    path: app/src/main/res",
      "  - format: xcstrings",
      "    path: ios/Localizable.xcstrings",
    ].join("\n"),
    "/p/app/src/main/res/values/strings.xml": STRINGS,
    "/p/ios/Localizable.xcstrings": IOS,
    "/p/.localship/brief.md": "StillMoney is a calm budgeting app.",
    "/p/.localship/voice/hi.md": "Use तुम, not आप.",
    "/p/.localship/glossary.yaml": [
      "terms:",
      "  - term: StillMoney",
      "    translate: false",
      "  - term: budget",
      "    translations: { hi: बजट }",
    ].join("\n"),
    ...files,
  });
}
const open = (fs: ReturnType<typeof project>) => openProject(fs, { cwd: "/p" });

describe("nextBatch", () => {
  it("lists what needs translating with plural forms, placeholders, glossary and context", async () => {
    const batch = await nextBatch(await open(project()), { locales: ["ar"] });
    expect(batch.items.map((i) => `${i.target} ${i.key}`)).toEqual([
      "android save",
      "android welcome",
      "android days_left",
      "android cancel",
      "xcstrings Cancel",
    ]);
    expect(batch.brief).toContain("calm budgeting");
    expect(batch.locales).toEqual({ ar: { language: "Arabic" } });
    const [save, welcome, days] = batch.items;
    expect(save).toMatchObject({ comment: "Button that saves the budget", state: "missing" });
    expect(welcome).toMatchObject({
      placeholders: ["%1$s"],
      glossary: [{ term: "StillMoney", keep: true }],
    });
    expect(days?.pluralForms?.map((f) => f.form)).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "other",
    ]);
    expect(days?.source).toEqual({ one: "%d day left", other: "%d days left" });
  });

  it("includes voice per locale, limits and pages", async () => {
    const p = await open(project());
    const first = await nextBatch(p, { locales: ["hi"], limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.remaining).toBe(3);
    expect(first.locales.hi?.voice).toBe("Use तुम, not आप.");
    const second = await nextBatch(p, { locales: ["hi"], limit: 2, offset: 2 });
    expect(second.items.map((i) => i.key)).toEqual(["days_left", "cancel"]);
  });
});

describe("submit", () => {
  it("writes valid drafts, rejects broken ones and records the lockfile", async () => {
    const fs = project();
    const result = await submit(
      await open(fs),
      [
        { locale: "hi", key: "save", value: "सहेजें" },
        { locale: "hi", key: "welcome", value: "StillMoney में स्वागत है!" },
        { locale: "hi", target: "android", key: "cancel", value: "रद्द करें" },
        { locale: "hi", key: "days_left", value: { one: "%d दिन बाकी", other: "%d दिन बाकी" } },
      ],
      { model: "test-model" },
    );
    expect(result.rejected).toEqual([
      {
        target: "android",
        locale: "hi",
        key: "welcome",
        errors: [{ severity: "error", code: "placeholder-missing", message: "Missing %1$s" }],
      },
    ]);
    expect(result.accepted.map((a) => a.key)).toEqual(["save", "cancel", "days_left"]);
    expect(result.files).toEqual(["app/src/main/res/values-hi/strings.xml"]);
    const written = fs.files.get("/p/app/src/main/res/values-hi/strings.xml") ?? "";
    expect(written).toContain('<string name="save">सहेजें</string>');
    expect(written).toContain('<item quantity="other">%d दिन बाकी</item>');

    const lock = JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(lock.targets.android.hi.save).toMatchObject({ state: "draft", model: "test-model" });
    const status = computeStatus(await open(fs), ["hi"]).find((s) => s.target === "android");
    expect(status?.counts).toMatchObject({ draft: 3, missing: 1 });
    expect(validateProject(await open(fs)).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("needs a target when two have the same key, and escapes Android text", async () => {
    const fs = project();
    const r = await submit(await open(fs), [
      { locale: "ar", key: "Cancel", value: "إلغاء" },
      { locale: "ar", key: "save", value: 'احفظ "الآن" & لا تنتظر' },
    ]);
    expect(r.accepted.map((a) => `${a.target} ${a.key}`)).toEqual([
      "xcstrings Cancel",
      "android save",
    ]);
    expect(fs.files.get("/p/app/src/main/res/values-ar/strings.xml")).toContain(
      '<string name="save">احفظ \\"الآن\\" &amp; لا تنتظر</string>',
    );
    const catalog = JSON.parse(fs.files.get("/p/ios/Localizable.xcstrings") ?? "{}");
    expect(catalog.strings.Cancel.localizations.ar.stringUnit).toEqual({
      state: "needs_review",
      value: "إلغاء",
    });
  });

  it("asks for every plural form and refuses forms the language doesn't have", async () => {
    const r = await submit(await open(project()), [
      { locale: "ar", key: "days_left", value: { one: "يوم", other: "%d يومًا", dual: "%d x" } },
    ]);
    expect(r.rejected[0]?.errors.map((e) => e.code)).toEqual([
      "plural-missing-category",
      "plural-extra-category",
    ]);
    expect(r.rejected[0]?.errors[0]?.message).toMatch(/zero.*two.*few.*many/);
  });

  it("needs the number in a form that covers more than one count, even if English drops it", async () => {
    const fs = project({
      "/p/app/src/main/res/values/strings.xml": `<resources>
    <plurals name="months">
        <item quantity="one">average of the last month</item>
        <item quantity="other">average of the last %d months</item>
    </plurals>
</resources>`,
    });
    const r = await submit(await open(fs), [
      // Hindi "one" is used for 0 and 1; Arabic "one" only for 1.
      {
        locale: "hi",
        key: "months",
        value: { one: "बीते महीने का औसत", other: "बीते %d महीनों का औसत" },
      },
      {
        locale: "ar",
        key: "months",
        value: {
          zero: "لا أشهر",
          one: "متوسط الشهر الماضي",
          two: "متوسط الشهرين الماضيين",
          few: "متوسط آخر %d أشهر",
          many: "متوسط آخر %d شهرًا",
          other: "متوسط آخر %d شهر",
        },
      },
    ]);
    expect(r.rejected.map((x) => x.locale)).toEqual(["hi"]);
    expect(r.rejected[0]?.errors.map((e) => [e.code, e.form])).toEqual([
      ["plural-count-missing", "one"],
    ]);
    expect(r.rejected[0]?.errors[0]?.message).toMatch(/0, 1.*%d/);
  });

  it("rejects unknown keys, untranslatable strings, the wrong shape and other locales", async () => {
    const r = await submit(await open(project()), [
      { locale: "hi", key: "nope", value: "x" },
      { locale: "hi", key: "brand", value: "x" },
      { locale: "hi", key: "save", value: ["x"] },
      { locale: "de", key: "save", value: "Speichern" },
      { locale: "en", key: "save", value: "Save" },
    ]);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.errors[0]?.code)).toEqual([
      "key-unknown",
      "key-unknown",
      "kind-mismatch",
      "locale-invalid",
      "locale-invalid",
    ]);
  });

  it("never replaces a hand edit or an approved translation unless forced", async () => {
    const fs = project();
    await submit(await open(fs), [{ locale: "hi", key: "save", value: "सहेजें" }]);
    const file = "/p/app/src/main/res/values-hi/strings.xml";
    fs.files.set(file, (fs.files.get(file) ?? "").replace("सहेजें", "सेव करें"));
    const p = await open(fs);
    expect(computeStatus(p, ["hi"])[0]?.entries.find((e) => e.key === "save")?.state).toBe(
      "edited",
    );
    const blocked = await submit(p, [{ locale: "hi", key: "save", value: "बचाएं" }]);
    expect(blocked.rejected[0]?.errors[0]?.code).toBe("state-edited");
    const forced = await submit(p, [{ locale: "hi", key: "save", value: "बचाएं" }], { force: true });
    expect(forced.accepted).toHaveLength(1);
  });

  it("dry runs write nothing", async () => {
    const fs = project();
    const r = await submit(await open(fs), [{ locale: "hi", key: "save", value: "सहेजें" }], {
      dryRun: true,
    });
    expect(r.accepted).toHaveLength(1);
    expect(fs.files.has("/p/app/src/main/res/values-hi/strings.xml")).toBe(false);
    expect(fs.files.has("/p/.localship/lock.json")).toBe(false);
  });

  it("offers translations of the same text from other targets", async () => {
    const fs = project();
    await submit(await open(fs), [{ locale: "hi", key: "Cancel", value: "रद्द करें" }]);
    const batch = await nextBatch(await open(fs), { locales: ["hi"], keys: ["cancel"] });
    expect(batch.items[0]?.memory).toEqual([{ value: "रद्द करें", from: "xcstrings:Cancel" }]);
  });

  it("warns when the glossary isn't followed", async () => {
    const fs = project({
      "/p/app/src/main/res/values/strings.xml": STRINGS.replace(
        "</resources>",
        '    <string name="edit_budget">Edit budget</string>\n</resources>',
      ),
    });
    const r = await submit(await open(fs), [
      { locale: "hi", key: "edit_budget", value: "बजट बदलें" },
      { locale: "ar", key: "edit_budget", value: "تعديل الميزانية" },
      { locale: "ar", key: "welcome", value: "مرحبًا بك في ستيل موني، %1$s!" },
    ]);
    expect(r.accepted.map((a) => a.warnings.map((w) => w.code))).toEqual([
      [],
      [],
      ["glossary-keep"],
    ]);
  });
});

describe("approve", () => {
  it("approves drafts and clears the String Catalog's needs_review", async () => {
    const fs = project();
    await submit(await open(fs), [
      { locale: "hi", key: "save", value: "सहेजें" },
      { locale: "hi", key: "Cancel", value: "रद्द करें" },
    ]);
    const r = await approve(await open(fs), { locales: ["hi"] });
    expect(r.changed.map((c) => `${c.target} ${c.key} ${c.from}`)).toEqual([
      "android save draft",
      "xcstrings Cancel draft",
    ]);
    expect(r.files).toEqual(["ios/Localizable.xcstrings"]);
    const catalog = JSON.parse(fs.files.get("/p/ios/Localizable.xcstrings") ?? "{}");
    expect(catalog.strings.Cancel.localizations.hi.stringUnit.state).toBe("translated");
    const states = computeStatus(await open(fs), ["hi"]).flatMap((s) =>
      s.entries.filter((e) => e.state !== "missing").map((e) => e.state),
    );
    expect(states).toEqual(["approved", "approved"]);
    const lock = JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(lock.targets.android.hi.save.state).toBe("approved");
  });

  it("adopts existing translations and hand edits only when asked", async () => {
    const fs = project({
      "/p/app/src/main/res/values-hi/strings.xml":
        '<resources><string name="save">सहेजें</string></resources>',
    });
    expect((await approve(await open(fs))).changed).toEqual([]);
    const r = await approve(await open(fs), { states: ["untracked"] });
    expect(r.changed).toEqual([
      { target: "android", locale: "hi", key: "save", from: "untracked" },
    ]);
  });
});

describe("prepareAndroidValue", () => {
  it.each([
    ["Don't", "Don\\'t"],
    ["Don\\'t", "Don\\'t"],
    ['Say "hi"', 'Say \\"hi\\"'],
    ["Tom & Jerry", "Tom &amp; Jerry"],
    ["a &amp; b", "a &amp; b"],
    [
      '<b>Bold</b> & <xliff:g id="n">%1$s</xliff:g>',
      '<b>Bold</b> &amp; <xliff:g id="n">%1$s</xliff:g>',
    ],
    ["1 < 2", "1 &lt; 2"],
    ["line\nbreak", "line\\nbreak"],
    ["@home", "\\@home"],
  ])("%s → %s", (input, expected) => {
    expect(prepareAndroidValue(input, "plain")).toBe(expected);
  });

  it("leaves quotes alone when the source uses a quoted region", () => {
    expect(prepareAndroidValue('"  indented"', '"  indented"')).toBe('"  indented"');
  });
});

describe("glossary", () => {
  const glossary = [
    { term: "StillMoney", translate: false, caseSensitive: false },
    { term: "budget", translate: true, caseSensitive: false, translations: { ar: "ميزانية" } },
  ];
  it("matches whole words only", () => {
    expect(glossaryHits(glossary, "Budgets and budget").map((t) => t.term)).toEqual(["budget"]);
    expect(glossaryHits(glossary, "Budgeting")).toEqual([]);
  });
  it("accepts fixed terms inside inflected words", () => {
    expect(checkGlossary(glossary, "ar", "Your budget", "الميزانية الخاصة بك")).toEqual([]);
    expect(checkGlossary(glossary, "ar", "Your budget", "مصروفك")[0]?.code).toBe("glossary-term");
  });
  it("knows a text of kept terms is not untranslated", () => {
    expect(onlyKeptTerms(glossary, "StillMoney")).toBe(true);
    expect(onlyKeptTerms(glossary, "StillMoney Pro plan")).toBe(false);
  });
});

describe("gettext removal", () => {
  it("empties msgstr for strings still in the template and deletes ones that left it", async () => {
    const files = memoryFs({
      "/g/localship.yaml":
        "locales: [de]\ntargets:\n  - format: po\n    path: po/{locale}.po\n    template: po/app.pot\n",
      "/g/po/app.pot":
        'msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hello"\nmsgstr ""\n',
      "/g/po/de.po": [
        'msgid ""',
        'msgstr "Content-Type: text/plain; charset=UTF-8\\n"',
        "",
        "#, fuzzy",
        'msgid "Hello"',
        'msgstr "Hallo"',
        "",
        'msgid "Gone"',
        'msgstr "Weg"',
        "",
      ].join("\n"),
    });
    const p = await openProject(files, { cwd: "/g" });
    expect((await removeTranslations(p, { keys: ["Hello"] })).removed).toHaveLength(1);
    expect((await prune(await openProject(files, { cwd: "/g" }))).removed).toHaveLength(1);
    expect(files.files.get("/g/po/de.po")).toBe(
      'msgid ""\nmsgstr "Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Hello"\nmsgstr ""\n',
    );
  });
});

describe("submit to gettext", () => {
  const fs = () =>
    memoryFs({
      "/g/localship.yaml":
        "locales: [ru]\ntargets:\n  - format: po\n    path: po/{locale}.po\n    template: po/app.pot\n",
      "/g/po/app.pot": [
        'msgid ""',
        'msgstr "Content-Type: text/plain; charset=UTF-8\\n"',
        "",
        "#, python-format",
        'msgid "%(n)d file"',
        'msgid_plural "%(n)d files"',
        'msgstr[0] ""',
        'msgstr[1] ""',
        "",
      ].join("\n"),
    });

  it("asks for numbered forms with examples and writes a new file without fuzzy", async () => {
    const files = fs();
    const p = await openProject(files, { cwd: "/g" });
    const [item] = (await nextBatch(p)).items;
    expect(item?.pluralForms?.map((f) => [f.form, f.examples.split(",")[0]])).toEqual([
      ["0", "1"],
      ["1", "2"],
      ["2", "0"],
    ]);
    const r = await submit(p, [
      {
        locale: "ru",
        key: "%(n)d file",
        value: { 0: "%(n)d файл", 1: "%(n)d файла", 2: "%(n)d файлов" },
      },
    ]);
    expect(r.rejected).toEqual([]);
    const po = files.files.get("/g/po/ru.po") ?? "";
    expect(po).toContain('msgstr[2] "%(n)d файлов"');
    expect(po).not.toContain("fuzzy");
    expect(computeStatus(await openProject(files, { cwd: "/g" }))[0]?.counts.draft).toBe(1);
  });
});

describe("stale entries", () => {
  it("show the source text the old translation was made from", async () => {
    const fs = project();
    await submit(await open(fs), [{ locale: "hi", key: "save", value: "सहेजें" }]);
    const lock = JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(lock.targets.android.hi.save.sourceText).toBe("Save");
    const src = "/p/app/src/main/res/values/strings.xml";
    fs.files.set(src, (fs.files.get(src) ?? "").replace(">Save<", ">Save budget<"));
    const [item] = (await nextBatch(await open(fs), { locales: ["hi"], keys: ["save"] })).items;
    expect(item).toMatchObject({
      state: "stale",
      source: "Save budget",
      previousSource: "Save",
      current: "सहेजें",
    });
  });
});

describe("removeTranslations", () => {
  it("rejects drafts so they come back as missing, and keeps the rest of the file", async () => {
    const fs = project();
    await submit(await open(fs), [
      { locale: "hi", key: "save", value: "सहेजें" },
      { locale: "hi", key: "cancel", value: "रद्द करें" },
      { locale: "hi", key: "Cancel", value: "रद्द करें" },
    ]);
    const r = await removeTranslations(await open(fs), {
      locales: ["hi"],
      keys: ["save", "Cancel"],
    });
    expect(r.removed.map((x) => `${x.target} ${x.key} ${x.from}`)).toEqual([
      "android save draft",
      "xcstrings Cancel draft",
    ]);
    expect(fs.files.get("/p/app/src/main/res/values-hi/strings.xml")).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="cancel">रद्द करें</string>\n</resources>\n',
    );
    const catalog = JSON.parse(fs.files.get("/p/ios/Localizable.xcstrings") ?? "{}");
    expect(catalog.strings.Cancel).toEqual({ comment: "Dismisses a sheet" });
    const lock = JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(Object.keys(lock.targets.android.hi)).toEqual(["cancel"]);
    const states = computeStatus(await open(fs), ["hi"])[0]?.entries;
    expect(states?.find((e) => e.key === "save")?.state).toBe("missing");
  });

  it("keeps a person's work unless forced, and needs keys or states", async () => {
    const fs = project({
      "/p/app/src/main/res/values-hi/strings.xml":
        '<resources>\n  <string name="save">सहेजें</string>\n</resources>\n',
    });
    const kept = await removeTranslations(await open(fs), { states: ["untracked"] });
    expect(kept.removed).toEqual([]);
    expect(kept.refused).toEqual([
      { target: "android", locale: "hi", key: "save", state: "untracked" },
    ]);
    const forced = await removeTranslations(await open(fs), { keys: ["save"], force: true });
    expect(forced.removed).toHaveLength(1);
    expect(fs.files.get("/p/app/src/main/res/values-hi/strings.xml")).toBe(
      "<resources>\n</resources>\n",
    );
    await expect(removeTranslations(await open(fs), {})).rejects.toThrow(/keys, states/);
  });
});

describe("prune", () => {
  it("removes translations of deleted and untranslatable strings, and their lock records", async () => {
    const fs = project({
      "/p/app/src/main/res/values-ar/strings.xml": [
        "<resources>",
        "    <!-- Old screen -->",
        '    <string name="old_key">قديم</string>',
        '    <string name="brand">ستيل موني</string>',
        '    <string name="cancel">إلغاء</string>',
        "</resources>",
        "",
      ].join("\n"),
      "/p/.localship/lock.json": JSON.stringify({
        version: 1,
        targets: {
          android: { ar: { old_key: { source: "x", target: "y", state: "draft" } } },
          gone: {},
        },
      }),
    });
    const dry = await prune(await open(fs), { dryRun: true });
    expect(dry.removed.map((r) => `${r.key} ${r.reason}`)).toEqual([
      "old_key orphan",
      "brand not-translatable",
    ]);
    expect(dry.lockEntries).toBe(1);
    expect(fs.files.get("/p/app/src/main/res/values-ar/strings.xml")).toContain("old_key");

    const r = await prune(await open(fs));
    expect(r.files).toEqual(["app/src/main/res/values-ar/strings.xml"]);
    expect(fs.files.get("/p/app/src/main/res/values-ar/strings.xml")).toBe(
      '<resources>\n    <!-- Old screen -->\n    <string name="cancel">إلغاء</string>\n</resources>\n',
    );
    expect(JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}").targets).toEqual({
      android: { ar: {} },
    });
    expect((await prune(await open(fs))).removed).toEqual([]);
  });
});

describe("a source change after a hand edit", () => {
  // The release test: change source strings, one of which a person had edited, and check
  // that both are flagged but the hand edit survives every path that writes.
  async function setup() {
    const fs = project();
    await submit(await open(fs), [
      { locale: "hi", key: "save", value: "सहेजें" },
      { locale: "hi", key: "cancel", value: "रद्द करें" },
    ]);
    const hi = "/p/app/src/main/res/values-hi/strings.xml";
    fs.files.set(hi, (fs.files.get(hi) ?? "").replace("सहेजें", "सेव करें"));
    const src = "/p/app/src/main/res/values/strings.xml";
    fs.files.set(
      src,
      (fs.files.get(src) ?? "")
        .replace(">Save<", ">Save budget<")
        .replace(">Cancel<", ">Cancel edit<"),
    );
    return { fs, hi };
  }

  it("flags both as stale and marks the hand-edited one", async () => {
    const { fs } = await setup();
    const states = computeStatus(await open(fs), ["hi"]).find((s) => s.target === "android");
    expect(states?.entries.filter((e) => e.state === "stale").map((e) => e.key)).toEqual([
      "save",
      "cancel",
    ]);
    const batch = await nextBatch(await open(fs), { locales: ["hi"], targets: ["android"] });
    const save = batch.items.find((i) => i.key === "save");
    expect(save).toMatchObject({ current: "सेव करें", previousSource: "Save", editedByHand: true });
    expect(batch.items.find((i) => i.key === "cancel")?.editedByHand).toBeUndefined();
  });

  it("won't replace or remove the hand edit without force", async () => {
    const { fs, hi } = await setup();
    const r = await submit(await open(fs), [
      { locale: "hi", key: "save", value: "बजट सहेजें" },
      { locale: "hi", key: "cancel", value: "बदलाव रद्द करें" },
    ]);
    expect(r.accepted.map((a) => a.key)).toEqual(["cancel"]);
    expect(r.rejected[0]?.errors[0]?.code).toBe("state-stale-edited");
    expect(fs.files.get(hi)).toContain("सेव करें");
    const removed = await removeTranslations(await open(fs), { locales: ["hi"], keys: ["save"] });
    expect(removed.refused).toEqual([
      { target: "android", locale: "hi", key: "save", state: "stale" },
    ]);
    const forced = await submit(await open(fs), [{ locale: "hi", key: "save", value: "बजट सहेजें" }], {
      force: true,
    });
    expect(forced.accepted).toHaveLength(1);
  });

  it("is held for review by unattended translation", async () => {
    const { fs, hi } = await setup();
    const model = () => async (req: { user: string }) => {
      const items = JSON.parse(
        req.user.slice(req.user.indexOf("Items to translate:") + 19),
      ) as Array<{
        target: string;
        locale: string;
        key: string;
        kind: string;
      }>;
      return JSON.stringify(
        items.map((i) => ({
          ...i,
          value:
            i.kind === "plural"
              ? { one: "%d दिन", other: "%d दिन" }
              : i.key === "welcome"
                ? "StillMoney, %1$s"
                : "अनुवाद",
        })),
      );
    };
    const { translateProject } = await import("../src/translate/translate.js");
    const r = await translateProject(await open(fs), {
      locales: ["hi"],
      targets: ["android"],
      model: "fake:m",
      completion: model,
    });
    expect(r.heldForReview).toEqual([{ target: "android", locale: "hi", key: "save" }]);
    expect(fs.files.get(hi)).toContain("सेव करें");
    expect(fs.files.get(hi)).not.toContain("रद्द करें");
  });
});
