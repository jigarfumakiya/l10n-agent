import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { memoryFs } from "../src/core/fs.js";
import { plan, resolveLocale, start } from "../src/core/plan.js";

const STRINGS = `<resources>
    <string name="app_name">Jotter</string>
    <string name="save">Save</string>
    <string name="cancel">Cancel</string>
</resources>`;

const app = (extra: Record<string, string> = {}) =>
  memoryFs({
    "/a/build.gradle.kts": "",
    "/a/app/src/main/AndroidManifest.xml": "<manifest/>",
    "/a/app/src/main/res/values/strings.xml": STRINGS,
    ...extra,
  });

describe("resolveLocale", () => {
  it.each([
    ["Hindi", "hi"],
    ["arabic", "ar"],
    ["pt_BR", "pt-BR"],
    ["Brazilian Portuguese", "pt-BR"],
    ["zh-Hant", "zh-Hant"],
  ])("%s → %s", (input, code) => {
    expect(resolveLocale(input)).toBe(code);
  });
  it("rejects what isn't a language", () => {
    expect(() => resolveLocale("Klingon please")).toThrow(/language name or code/);
  });
});

describe("plan", () => {
  it("is ready to go for an app with strings and no translations", async () => {
    const p = await plan(app(), "/a", { locales: ["Hindi"] });
    expect(p).toMatchObject({
      ready: true,
      configured: false,
      confirm: "start translating",
      locales: [{ code: "hi", name: "Hindi", isNew: true }],
      targets: [{ format: "android-xml", path: "app/src/main/res", strings: 3 }],
      work: { hi: 3 },
      blockers: [],
    });
    expect(p.defaults.voice.hi).toMatch(/आप/);
    expect(p.defaults.keepAsWritten).toEqual(["Jotter"]);
    expect(p.steps[0]).toMatch(/Set up Localship .* Hindi/);
    expect(p.steps.at(-1)).toMatch(/drafts/);
  });

  it("puts extraction first when most text is in the code", async () => {
    const code = Array.from({ length: 15 }, (_, i) => `Text("Line number ${i}")`).join("\n");
    const p = await plan(app({ "/a/app/src/main/java/Main.kt": code }), "/a", { locales: ["hi"] });
    expect(p.ready).toBe(false);
    expect(p.confirm).toBe("start");
    expect(p.blockers.map((b) => b.kind)).toEqual(["mostly-hardcoded"]);
    expect(p.steps[0]).toMatch(/localship-extract/);
    expect(p.work.hi).toBe(18);
  });

  it("asks for languages, and stops at formats it can't handle", async () => {
    const noLang = await plan(app(), "/a");
    expect(noLang.confirm).toBe("");
    expect(noLang.blockers.map((b) => b.kind)).toEqual(["no-locales"]);
    const flutter = await plan(memoryFs({ "/f/lib/l10n/app_en.arb": "{}" }), "/f", {
      locales: ["hi"],
    });
    expect(flutter.confirm).toBe("");
    expect(flutter.blockers[0]?.message).toMatch(/Flutter ARB/);
  });

  it("counts only what's left in a set-up project, and all of a new language", async () => {
    const fs = app({
      "/a/localship.yaml":
        "locales: [hi]\ntargets:\n  - format: android-xml\n    path: app/src/main/res\n",
      "/a/app/src/main/res/values-hi/strings.xml":
        '<resources><string name="save">सहेजें</string></resources>',
    });
    const p = await plan(fs, "/a", { locales: ["hi", "French"] });
    expect(p.configured).toBe(true);
    expect(p.work).toEqual({ hi: 2, fr: 3 });
    expect(p.locales.map((l) => [l.code, l.isNew])).toEqual([
      ["hi", false],
      ["fr", true],
    ]);
    expect(p.steps[0]).toMatch(/Add French/);
  });
});

describe("start", () => {
  it("sets up in one call with default voice and the app name kept", async () => {
    const fs = app();
    const r = await start(fs, "/a", { locales: ["Hindi", "ar"] });
    expect(r).toMatchObject({ createdConfig: true, addedLocales: ["hi", "ar"], warnings: [] });
    expect(r.wrote.sort()).toEqual(["glossary.yaml", "voice/ar.md", "voice/hi.md"]);
    expect(fs.files.get("/a/.localship/voice/hi.md")).toMatch(/आप/);
    expect(parseYaml(fs.files.get("/a/.localship/glossary.yaml") ?? "")).toEqual({
      terms: [{ term: "Jotter", translate: false }],
    });
  });

  it("adds languages to an existing setup and never overwrites a person's context", async () => {
    const fs = app();
    await start(fs, "/a", { locales: ["hi"] });
    fs.files.set("/a/.localship/voice/hi.md", "Use तुम, it's a casual app.\n");
    const r = await start(fs, "/a", { locales: ["hi", "de"], voice: { de: "Use Sie." } });
    expect(r).toMatchObject({ createdConfig: false, addedLocales: ["de"] });
    expect(r.wrote).toEqual(["voice/de.md"]);
    expect(fs.files.get("/a/.localship/voice/hi.md")).toBe("Use तुम, it's a casual app.\n");
    expect(fs.files.get("/a/.localship/voice/de.md")).toBe("Use Sie.\n");
  });
});
