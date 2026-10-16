import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as { version?: string };

describe("release", () => {
  it("gives the Claude Code plugin the same version as the npm package", () => {
    // Plugin users only get an update when this version changes.
    expect(read(".claude-plugin/plugin.json").version).toBe(read("package.json").version);
  });
});
