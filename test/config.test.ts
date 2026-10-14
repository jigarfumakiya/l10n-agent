import path from "node:path";
import { describe, expect, it } from "vitest";
import { addLocales, ConfigError, loadConfig } from "../src/core/config.js";
import { memoryFs } from "../src/core/fs.js";

describe("config", () => {
  it("finds the nearest config and canonicalizes locales", async () => {
    const fs = memoryFs({
      "/app/localship.yaml":
        "locales: [HI, pt-br]\ntargets:\n  - format: android-xml\n    path: res\n",
    });
    const { config, root } = await loadConfig(fs, "/app/src/deep");
    expect(root).toBe(path.resolve("/app"));
    expect(config.locales).toEqual(["hi", "pt-BR"]);
    expect(config.sourceLocale).toBe("en");
    expect(config.lock).toBe(".localship/lock.json");
  });

  it("explains what is wrong", async () => {
    const fs = memoryFs({ "/app/localship.yaml": "locales: [not a locale]\ntargets: []\n" });
    await expect(loadConfig(fs, "/app")).rejects.toThrow(ConfigError);
    await expect(loadConfig(fs, "/app")).rejects.toThrow(
      /locales\.0: Not a valid BCP 47 locale[\s\S]*targets: Add at least one target/,
    );
  });

  it("says how to start when there is no config", async () => {
    await expect(loadConfig(memoryFs({ "/x/a": "" }), "/x")).rejects.toThrow(
      /No localship\.yaml found[\s\S]*localship detect[\s\S]*localship init/,
    );
  });
});

describe("config typos", () => {
  it("rejects unknown keys and suggests the right one", async () => {
    const fs = memoryFs({
      "/app/localship.yaml":
        "local: [hi]\ntargets:\n  - format: po\n    path: po/{locale}.po\n    templat: x.pot\n    colour: red\n",
    });
    const err = await loadConfig(fs, "/app").catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(String((err as Error).message)).toMatch(
      /unknown key "local" \(did you mean "locales"\?\)/,
    );
    expect(String((err as Error).message)).toMatch(
      /unknown key "templat" \(did you mean "template"\?\)/,
    );
    expect(String((err as Error).message)).toMatch(/unknown key "colour"\n|unknown key "colour"$/);
  });
});

describe("addLocales", () => {
  it("appends languages, keeps comments, and skips the source and ones already there", async () => {
    const fs = memoryFs({
      "/a/localship.yaml":
        "# my app\nsourceLocale: en\nlocales: [hi]\ntargets:\n  - format: po\n    path: po/{locale}.po # here\n",
    });
    const r = await addLocales(fs, "/a/localship.yaml", ["ar", "hi", "en", "pt_BR"]);
    expect(r).toEqual({ added: ["ar", "pt-BR"], locales: ["hi", "ar", "pt-BR"] });
    const text = fs.files.get("/a/localship.yaml");
    expect(text).toContain("# my app");
    expect(text).toContain("locales: [ hi, ar, pt-BR ]");
    expect(text).toContain("# here");
    expect((await loadConfig(fs, "/a")).config.locales).toEqual(["hi", "ar", "pt-BR"]);
  });

  it("adds a locales list when there is none, and rejects bad codes", async () => {
    const fs = memoryFs({
      "/a/localship.yaml": "targets:\n  - format: po\n    path: po/{locale}.po\n",
    });
    expect((await addLocales(fs, "/a/localship.yaml", ["hi"])).locales).toEqual(["hi"]);
    await expect(addLocales(fs, "/a/localship.yaml", ["not a code"])).rejects.toThrow(ConfigError);
  });
});

describe("legacy config name", () => {
  it("still reads l10n.config.yaml, keeping its .l10n folder", async () => {
    const fs = memoryFs({
      "/old/l10n.config.yaml": "targets:\n  - format: po\n    path: po/{locale}.po\n",
    });
    const { config, file } = await loadConfig(fs, "/old");
    expect(path.basename(file)).toBe("l10n.config.yaml");
    expect(config.lock).toBe(".l10n/lock.json");
    expect(config.context).toBe(".l10n");
  });
});
