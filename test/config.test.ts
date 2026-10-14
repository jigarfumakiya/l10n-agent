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
    expect(root).toBe("/app");
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
      /No l10n\.config\.yaml found[\s\S]*#quick-start/,
    );
  });
});
