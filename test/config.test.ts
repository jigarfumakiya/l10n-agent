import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/core/config.js";
import { memoryFs } from "../src/core/fs.js";

describe("config", () => {
  it("finds the nearest config and canonicalizes locales", async () => {
    const fs = memoryFs({
      "/app/l10n.config.yaml":
        "locales: [HI, pt-br]\ntargets:\n  - format: android-xml\n    path: res\n",
    });
    const { config, root } = await loadConfig(fs, "/app/src/deep");
    expect(root).toBe(path.resolve("/app"));
    expect(config.locales).toEqual(["hi", "pt-BR"]);
    expect(config.sourceLocale).toBe("en");
    expect(config.lock).toBe(".l10n/lock.json");
  });

  it("explains what is wrong", async () => {
    const fs = memoryFs({ "/app/l10n.config.yaml": "locales: [not a locale]\ntargets: []\n" });
    await expect(loadConfig(fs, "/app")).rejects.toThrow(ConfigError);
    await expect(loadConfig(fs, "/app")).rejects.toThrow(
      /locales\.0: Not a valid BCP 47 locale[\s\S]*targets: Add at least one target/,
    );
  });

  it("says how to start when there is no config", async () => {
    await expect(loadConfig(memoryFs({ "/x/a": "" }), "/x")).rejects.toThrow(
      /No l10n\.config\.yaml found[\s\S]*l10n init/,
    );
  });
});

describe("config typos", () => {
  it("rejects unknown keys and suggests the right one", async () => {
    const fs = memoryFs({
      "/app/l10n.config.yaml":
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
