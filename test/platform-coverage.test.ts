import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { statusNotes } from "../src/core/status.js";
import { validateProject } from "../src/core/validate.js";
import { approve, nextBatch, submit } from "../src/core/workflow.js";

const open = (fs: ReturnType<typeof memoryFs>) => openProject(fs, { cwd: "/app" });
const unit = (value: string) => ({ stringUnit: { state: "translated", value } });
const catalogFile = "/app/Localizable.xcstrings";

function apple(variation: object, extra: object = {}) {
  return memoryFs({
    "/app/localship.yaml":
      "locales: [de]\ntargets:\n  - format: xcstrings\n    path: Localizable.xcstrings\n",
    [catalogFile]: JSON.stringify(
      {
        sourceLanguage: "en",
        version: "1.0",
        strings: {
          Save: { localizations: { de: unit("Speichern") } },
          Complex: { localizations: { en: variation }, ...extra },
        },
      },
      null,
      2,
    ),
  });
}

describe("Apple catalog coverage", () => {
  it.each([
    ["device", { variations: { device: { iphone: unit("Tap here"), other: unit("Click here") } } }],
    [
      "substitution",
      {
        ...unit("%#@items@"),
        substitutions: {
          items: {
            argNum: 1,
            formatSpecifier: "lld",
            variations: { plural: { one: unit("%lld item"), other: unit("%lld items") } },
          },
        },
      },
    ],
    [
      "nested",
      {
        variations: {
          plural: {
            one: { variations: { device: { iphone: unit("One item") } } },
            other: unit("%lld items"),
          },
        },
      },
    ],
    ["unknown axis", { variations: { futureAxis: { other: unit("Text") } } }],
  ])("blocks strict/release checks for %s while preserving the key", async (_name, variation) => {
    const fs = apple(variation as object);
    await approve(await open(fs), { states: ["untracked"] });
    const p = await open(fs);
    const before = new Map(fs.files);
    expect(validateProject(p)).toEqual([
      expect.objectContaining({
        code: "variation-unsupported",
        severity: "warning",
        blocksCompleteness: true,
        key: "Complex",
        file: "Localizable.xcstrings",
        line: expect.any(Number),
      }),
    ]);
    for (const opts of [{ strict: true }, { requireApproved: true }]) {
      expect(validateProject(p, opts)).toEqual([
        expect.objectContaining({
          code: "variation-unsupported",
          severity: "error",
          key: "Complex",
        }),
      ]);
    }
    // Strict validation does not mutate the adapter's warning for later normal validation.
    expect(validateProject(p)[0]?.severity).toBe("warning");
    expect(statusNotes(p)).toContainEqual(
      expect.objectContaining({ code: "variation-unsupported", severity: "warning" }),
    );
    expect((await nextBatch(p)).items).toEqual([]);
    expect(fs.files).toEqual(before);
    const result = await submit(
      p,
      [{ locale: "de", key: "Complex", value: "Do not flatten this" }],
      { force: true },
    );
    expect(result.rejected).toHaveLength(1);
    expect(fs.files).toEqual(before);
    await submit(p, [{ locale: "de", key: "Save", value: "Sichern" }], { force: true });
    expect(JSON.parse(await fs.readFile(catalogFile)).strings.Complex).toEqual(
      JSON.parse(before.get(catalogFile) ?? "{}").strings.Complex,
    );
  });

  it.each([{ shouldTranslate: false }, { extractionState: "stale" }])(
    "does not block intentionally excluded keys: %j",
    async (extra) => {
      const fs = apple({ variations: { device: { other: unit("Sample") } } }, extra);
      await approve(await open(fs), { states: ["untracked"] });
      expect(validateProject(await open(fs), { requireApproved: true })).toEqual([]);
    },
  );
});

function android(extra: Record<string, string> = {}) {
  return memoryFs({
    "/app/localship.yaml": "locales: [de]\ntargets:\n  - format: android-xml\n    path: res\n",
    "/app/res/values/strings.xml": '<resources><string name="title">Title</string></resources>',
    "/app/res/values-de/strings.xml": '<resources><string name="title">Titel</string></resources>',
    ...extra,
  });
}

describe("Android resource coverage", () => {
  it.each([
    "values-de-night",
    "values-b+zh+Hans-night",
    "values-night",
    "values-mcc404-hi",
    "values-v31",
  ])("reports strings in %s without flattening their configuration", async (folder) => {
    const file = `/app/res/${folder}/labels.xml`;
    const fs = android({
      [file]: '<resources><string name="title">Broken %1$s</string></resources>',
    });
    await approve(await open(fs), { states: ["untracked"] });
    const before = new Map(fs.files);
    const p = await open(fs);
    expect(validateProject(p)).toEqual([
      expect.objectContaining({
        code: "resource-configuration-unsupported",
        severity: "warning",
        blocksCompleteness: true,
        file: `res/${folder}/labels.xml`,
        line: 1,
      }),
    ]);
    for (const opts of [{ strict: true }, { requireApproved: true }]) {
      expect(validateProject(p, opts)).toEqual([
        expect.objectContaining({ code: "resource-configuration-unsupported", severity: "error" }),
      ]);
    }
    expect(statusNotes(p)).toContainEqual(
      expect.objectContaining({ code: "resource-configuration-unsupported" }),
    );
    expect(fs.files).toEqual(before);
    await submit(p, [{ locale: "de", key: "title", value: "Überschrift" }], { force: true });
    expect(await fs.readFile(file)).toBe(before.get(file));
  });

  it("ignores non-string files and intentionally non-translatable configuration overrides", async () => {
    const fs = android({
      "/app/res/values-night/colors.xml":
        '<resources><color name="surface">#000000</color></resources>',
      "/app/res/values-sw600dp/dimens.xml":
        '<resources><dimen name="spacing">16dp</dimen></resources>',
      "/app/res/values-de-night/strings.xml":
        '<resources><string name="alias">@string/title</string><string name="brand" translatable="false">Localship</string></resources>',
    });
    await approve(await open(fs), { states: ["untracked"] });
    expect(validateProject(await open(fs), { requireApproved: true })).toEqual([]);
  });

  it("reports malformed XML in a configuration that it cannot model", async () => {
    const fs = android({
      "/app/res/values-de-night/strings.xml":
        '<resources><string name="title">Bad & text</string></resources>',
    });
    expect(validateProject(await open(fs))).toContainEqual(
      expect.objectContaining({
        code: "xml-malformed",
        severity: "error",
        file: "res/values-de-night/strings.xml",
      }),
    );
  });

  it.each([undefined, "<resources/>"])(
    "fails when all default strings are absent: %s",
    async (content) => {
      const fs = android();
      if (content === undefined) fs.files.delete("/app/res/values/strings.xml");
      else fs.files.set("/app/res/values/strings.xml", content);
      const before = new Map(fs.files);
      expect(validateProject(await open(fs))).toContainEqual(
        expect.objectContaining({ code: "default-resources-missing", severity: "error" }),
      );
      expect(validateProject(await open(fs), { requireApproved: true })).toContainEqual(
        expect.objectContaining({ code: "default-resources-missing", severity: "error" }),
      );
      expect(fs.files).toEqual(before);
    },
  );

  it("does not reject a new empty target with no localized strings", async () => {
    const fs = android({ "/app/res/values/strings.xml": "<resources/>" });
    fs.files.delete("/app/res/values-de/strings.xml");
    expect(
      validateProject(await open(fs)).some((i) => i.code === "default-resources-missing"),
    ).toBe(false);
  });

  it("fails strict checks for a locale-only key and accepts defaults split across XML files", async () => {
    const fs = android({
      "/app/res/values-de/strings.xml":
        '<resources><string name="title">Titel</string><string name="subtitle">Untertitel</string></resources>',
    });
    let p = await open(fs);
    expect(validateProject(p)).toContainEqual(
      expect.objectContaining({ code: "orphan", severity: "warning", key: "subtitle" }),
    );
    expect(validateProject(p, { strict: true })).toContainEqual(
      expect.objectContaining({ code: "orphan", severity: "error", key: "subtitle" }),
    );
    fs.files.set(
      "/app/res/values/labels.xml",
      '<resources><string name="subtitle">Subtitle</string></resources>',
    );
    p = await open(fs);
    expect(validateProject(p, { strict: true })).toEqual([]);
  });
});
