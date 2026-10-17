import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nodeFs } from "../src/core/fs.js";
import { cldrPluralSpec } from "../src/core/plurals.js";
import { openProject } from "../src/core/project.js";
import { validateProject } from "../src/core/validate.js";
import { nextBatch, submit } from "../src/core/workflow.js";

// Synthetic, deterministic native catalogs on disk. No model calls or API keys.
const size = Number(process.argv[2] ?? 2000);
if (!Number.isSafeInteger(size) || size < 1) throw new Error("Size must be a positive integer");
const locales = ["de", "fr", "es", "it", "hi", "ar", "ja", "ru"];
const root = await mkdtemp(path.join(os.tmpdir(), "localship-bench-"));
const timings: Record<string, number> = {};
async function measure<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  timings[name] = Math.round((performance.now() - start) * 100) / 100;
  return result;
}
try {
  const xml = (translated: boolean) =>
    `<resources>\n${Array.from(
      { length: size },
      (_, i) =>
        `<string name="key_${i}">${translated ? "Translated" : "Source"} message ${i}</string>`,
    ).join("\n")}\n</resources>`;
  await nodeFs.writeFile(
    path.join(root, "localship.yaml"),
    `locales: [${locales.join(", ")}]\ntargets:\n  - format: android-xml\n    path: res\n  - format: xcstrings\n    path: Localizable.xcstrings\n`,
  );
  await nodeFs.writeFile(path.join(root, "res/values/strings.xml"), xml(false));
  for (const locale of locales) {
    await nodeFs.writeFile(path.join(root, `res/values-${locale}/strings.xml`), xml(true));
  }
  await nodeFs.writeFile(
    path.join(root, "Localizable.xcstrings"),
    JSON.stringify({
      sourceLanguage: "en",
      version: "1.0",
      strings: Object.fromEntries(
        Array.from({ length: size }, (_, i) => [
          `Source message ${i}`,
          {
            localizations: Object.fromEntries(
              locales.map((locale) => [
                locale,
                {
                  stringUnit: { state: "translated", value: `Translated message ${i}` },
                },
              ]),
            ),
          },
        ]),
      ),
    }),
  );
  const project = await measure("loadMs", () => openProject(nodeFs, { cwd: root }));
  await measure("batchMs", () => nextBatch(project, { states: ["untracked"], usages: false }));
  const issues = await measure("validateMs", () => validateProject(project, { strict: true }));
  const batch = await nextBatch(project, { states: ["untracked"], limit: 100, usages: false });
  await measure("submitDryRun100Ms", () =>
    submit(
      project,
      batch.items.map((item) => ({
        target: item.target,
        locale: item.locale,
        key: item.key,
        value: item.current ?? item.source,
      })),
      { dryRun: true, force: true, usages: false },
    ),
  );
  await measure("plural1000Ms", () => {
    for (let i = 0; i < 1000; i++) cldrPluralSpec(locales[i % locales.length] as string);
  });
  console.log(
    JSON.stringify(
      {
        node: process.version,
        sizePerTarget: size,
        targets: 2,
        locales: locales.length,
        issues: issues.length,
        ...timings,
        peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
