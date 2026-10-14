import { promises as fsp } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type FileSystem, memoryFs, nodeFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { androidAdapter, serializeResources } from "../src/formats/android/adapter.js";
import { fixture } from "./helpers.js";

describe("android adapter", () => {
  it("loads the source and locale folders, skipping other qualifiers", async () => {
    const p = await openProject(nodeFs, { cwd: fixture("android/sample") });
    const t = p.targets[0]?.target;
    expect([...(t?.locales.keys() ?? [])].sort()).toEqual(["ar", "hi"]);
    expect([...(t?.source.entries.keys() ?? [])]).toEqual([
      "app_name",
      "home_title",
      "greeting",
      "loose_args",
      "discount",
      "quote",
      "tos",
      "days_left",
      "weekdays",
    ]);
    const home = t?.source.entries.get("home_title");
    expect(home?.comment).toBe("Home title. Shown at the top of the main screen.");
    expect(home?.file).toBe("res/values/strings.xml");
    expect(home?.line).toBe(6);
    expect(t?.source.entries.get("app_name")?.translatable).toBe(false);
    expect(t?.source.entries.get("days_left")?.message).toEqual({
      kind: "plural",
      forms: { one: "%d day left", other: "%d days left" },
    });
    expect(t?.issues).toEqual([]);
  });

  it("leaves an unchanged locale file alone, and generates the same bytes from scratch", async () => {
    const root = fixture("android/roundtrip");
    const p = await openProject(nodeFs, { cwd: root });
    const target = p.targets[0]?.target;
    if (!target) throw new Error("no target");
    const catalog = target.locales.get("ar");
    if (!catalog) throw new Error("no ar");
    expect(target.source.entries.has("label[tablet]")).toBe(true);

    const out = memoryFs();
    const reopened = await androidAdapter.open(
      { format: "android-xml", path: "res" },
      { fs: readThrough(out), root, sourceLocale: "en", id: "android" },
    );
    const result = await reopened.writeLocale(catalog);
    const file = path.join(root, "res", "values-ar", "strings.xml");
    expect(result.files).toEqual([]);
    expect(out.files.size).toBe(0);
    // A brand-new file in Android Studio's layout comes out identical to the fixture.
    const generated = serializeResources(
      [...catalog.entries.values()],
      [["xmlns:xliff", "urn:oasis:names:tc:xliff:document:1.2"]],
    );
    expect(generated).toBe(await fsp.readFile(file, "utf8"));
  });

  it("splices changes into an existing file, keeping comments and layout", async () => {
    const fs = memoryFs({
      "/app/l10n.config.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/app/res/values/strings.xml":
        '<resources>\n  <string name="a">A</string>\n  <string name="b">B</string>\n  <plurals name="d"><item quantity="one">%d day</item><item quantity="other">%d days</item></plurals>\n  <string name="c">C</string>\n</resources>\n',
      "/app/res/values-hi/strings.xml":
        '<?xml version="1.0" encoding="utf-8"?>\n<!-- Reviewed by the Hindi team -->\n<resources>\n\n  <!-- Home -->\n  <string name="a">ए</string>\n\n  <string msgid="123" name="c">सी</string> <!-- keep -->\n</resources>\n',
    });
    const t = (await openProject(fs, { cwd: "/app" })).targets[0]?.target;
    if (!t) throw new Error("no target");
    const src = (k: string) =>
      t.source.entries.get(k) as NonNullable<ReturnType<typeof t.source.entries.get>>;
    await t.writeLocale({
      locale: "hi",
      entries: new Map([
        ["c", { ...src("c"), message: { kind: "text", value: "सी२" } }],
        ["b", { ...src("b"), message: { kind: "text", value: "बी" } }],
        [
          "d",
          { ...src("d"), message: { kind: "plural", forms: { one: "%d दिन", other: "%d दिन" } } },
        ],
      ]),
    });
    expect(fs.files.get("/app/res/values-hi/strings.xml")).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\n<!-- Reviewed by the Hindi team -->\n<resources>\n\n  <!-- Home -->\n  <string name="a">ए</string>\n  <string name="b">बी</string>\n  <plurals name="d">\n    <item quantity="one">%d दिन</item>\n    <item quantity="other">%d दिन</item>\n  </plurals>\n\n  <string name="c" msgid="123">सी२</string> <!-- keep -->\n</resources>\n',
    );
  });

  it("adds new keys in source order and keeps keys it was not given", async () => {
    const root = "/app";
    const fs = memoryFs({
      "/app/l10n.config.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/app/res/values/strings.xml":
        '<resources>\n  <string name="a">A</string>\n  <string name="b">B</string>\n  <string name="c">C</string>\n</resources>\n',
      "/app/res/values-hi/strings.xml":
        '<resources>\n  <string name="c">सी</string>\n</resources>\n',
    });
    const p = await openProject(fs, { cwd: root });
    const t = p.targets[0]?.target;
    if (!t) throw new Error("no target");
    const a = t.source.entries.get("a");
    if (!a) throw new Error("no a");
    await t.writeLocale({
      locale: "hi",
      entries: new Map([["a", { ...a, message: { kind: "text", value: "ए" } }]]),
    });
    expect(fs.files.get("/app/res/values-hi/strings.xml")).toBe(
      '<resources>\n  <string name="a">ए</string>\n  <string name="c">सी</string>\n</resources>\n',
    );
  });

  it("reports malformed files and duplicate keys with lines", async () => {
    const fs = memoryFs({
      "/app/l10n.config.yaml": "targets:\n  - format: android-xml\n    path: res\n",
      "/app/res/values/strings.xml":
        '<resources>\n<string name="a">A</string>\n<string name="a">B</string>\n</resources>',
      "/app/res/values-hi/strings.xml":
        '<resources>\n<string name="a">Tom & Jerry</string>\n</resources>',
    });
    const p = await openProject(fs, { cwd: "/app" });
    expect(p.targets[0]?.target.issues.map((i) => [i.code, i.locale, i.line])).toEqual([
      ["duplicate-key", "en", 3],
      ["xml-malformed", "hi", 2],
    ]);
  });
});

/** Reads from disk, writes to memory. */
function readThrough(mem: FileSystem): FileSystem {
  return { ...nodeFs, writeFile: (f, c) => mem.writeFile(f, c) };
}

describe("android performance", () => {
  it("reads and checks 20,000 strings quickly", async () => {
    const { validateProject } = await import("../src/core/validate.js");
    const n = 20_000;
    const body = (f: (i: number) => string) =>
      `<resources>\n${Array.from({ length: n }, (_, i) => `    <string name="k${i}">${f(i)}</string>`).join("\n")}\n</resources>\n`;
    const fs = memoryFs({
      "/big/l10n.config.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/big/res/values/strings.xml": body((i) => `Value ${i} with %1$s`),
      "/big/res/values-hi/strings.xml": body((i) => `मान ${i} %1$s`),
    });
    const started = performance.now();
    const p = await openProject(fs, { cwd: "/big" });
    const issues = validateProject(p);
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(p.targets[0]?.target.source.entries.get(`k${n - 1}`)?.line).toBe(n + 1);
    // Was 39 s before line lookups were indexed.
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
