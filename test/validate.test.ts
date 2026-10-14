import { describe, expect, it } from "vitest";
import { nodeFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { validateProject } from "../src/core/validate.js";
import { fixture } from "./helpers.js";

describe("validate", async () => {
  const project = await openProject(nodeFs, { cwd: fixture("android/sample") });
  const issues = validateProject(project);
  const found = issues
    .filter((i) => i.severity !== "info")
    .map((i) => `${i.severity} ${i.locale} ${i.key}${i.form ? `[${i.form}]` : ""} ${i.code}`)
    .sort();

  it("finds exactly the planted problems", () => {
    expect(found).toEqual(
      [
        "warning en loose_args placeholder-not-positional",
        "error hi tos xliff-mismatch",
        "error hi weekdays array-length",
        "warning ar app_name not-translatable",
        "error ar greeting placeholder-type",
        "error ar quote escape-apostrophe",
        "error ar days_left plural-missing-category",
        "warning ar days_left[one] placeholder-missing",
        "warning ar old_key orphan",
      ].sort(),
    );
  });

  it("reports untranslated counts as info, or errors when strict", () => {
    expect(issues.filter((i) => i.code === "missing").map((i) => [i.locale, i.message])).toEqual([
      ["hi", "1 string not translated yet"],
      ["ar", "4 strings not translated yet"],
    ]);
    const strict = validateProject(project, { strict: true }).filter((i) => i.code === "missing");
    expect(strict.every((i) => i.severity === "error")).toBe(true);
    expect(strict).toHaveLength(5);
  });

  it("points at file and line", () => {
    const i = issues.find((x) => x.code === "placeholder-type");
    expect(i?.file).toMatch(/values-ar\/strings\.xml$/);
    expect(i?.line).toBe(5);
  });
});

describe("validate on library-style resources", () => {
  it("skips aliases and single identical words", async () => {
    const { memoryFs } = await import("../src/core/fs.js");
    const fs = memoryFs({
      "/app/l10n.config.yaml": "locales: [de]\ntargets:\n  - format: android-xml\n    res: res\n",
      "/app/res/values/strings.xml":
        '<resources><string name="alias">@string/other</string><string name="minute">Minute</string><string name="two">Pick a date</string></resources>',
      "/app/res/values-de/strings.xml":
        '<resources><string name="alias">@string/other</string><string name="minute">Minute</string><string name="two">Pick a date</string></resources>',
    });
    const p = await openProject(fs, { cwd: "/app" });
    expect(p.targets[0]?.loaded.source.entries.get("alias")?.translatable).toBe(false);
    expect(validateProject(p).map((i) => `${i.key} ${i.code}`)).toEqual(["two untranslated"]);
  });
});
