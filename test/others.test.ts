import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { plan } from "../src/core/plan.js";
import { detect } from "../src/detect/detect.js";

describe("other localization tools", () => {
  const fs = () =>
    memoryFs({
      "/r/crowdin.yml": "files: []",
      "/r/gradle/libs.versions.toml":
        'tolgee = { group = "io.tolgee.mobile-kotlin-sdk", name = "compose" }\nlyricist = { module = "cafe.adriel.lyricist:lyricist" }',
      "/r/app/build.gradle.kts": "implementation(libs.tolgee)",
      "/r/app/src/main/res/values/strings.xml":
        '<resources><string name="save">Save</string></resources>',
    });

  it("are noticed from config files and Gradle dependencies, with what it means", async () => {
    const r = await detect(fs(), "/r");
    expect(r.otherSystems.map((o) => `${o.name} ${o.kind} ${o.evidence}`)).toEqual([
      "Crowdin platform crowdin.yml",
      "Tolgee sdk gradle/libs.versions.toml",
      "Lyricist library gradle/libs.versions.toml",
    ]);
    expect(r.hints[0]).toMatch(/Crowdin seems to manage translations here .* overwritten/);
    expect(r.hints[1]).toMatch(/over-the-air SDK .* replace shipped translations/);
  });

  it("show up in the plan as warnings, without blocking it", async () => {
    const p = await plan(fs(), "/r", { locales: ["hi"] });
    expect(p.ready).toBe(true);
    expect(p.warnings).toHaveLength(3);
  });

  it("stay quiet when there are none", async () => {
    const r = await detect(
      memoryFs({
        "/r/app/build.gradle.kts": 'implementation("androidx.compose.ui:ui")',
        "/r/app/src/main/res/values/strings.xml":
          '<resources><string name="a">A b</string></resources>',
      }),
      "/r",
    );
    expect(r.otherSystems).toEqual([]);
  });
});
