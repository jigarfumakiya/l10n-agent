import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { computeStatus } from "../src/core/status.js";
import { validateProject } from "../src/core/validate.js";
import { approve, submit } from "../src/core/workflow.js";
import { createServer } from "../src/mcp/server.js";

const SOURCE = "/app/res/values/strings.xml";
const TRANSLATION = "/app/res/values-de/strings.xml";
const CATALOG = "/app/Localizable.xcstrings";
const PO = "/app/locale/de.po";

function files() {
  return memoryFs({
    "/app/localship.yaml": [
      "locales: [de]",
      "targets:",
      "  - format: android-xml",
      "    path: res",
      "  - format: xcstrings",
      "    path: Localizable.xcstrings",
      "  - format: po",
      "    path: locale/{locale}.po",
      "    template: locale/messages.pot",
    ].join("\n"),
    [SOURCE]:
      '<resources><string name="save">Save</string><string name="brand" translatable="false">Localship</string></resources>',
    [CATALOG]: JSON.stringify({ sourceLanguage: "en", version: "1.0", strings: { Save: {} } }),
    "/app/locale/messages.pot":
      'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n\nmsgid "Save"\nmsgstr ""\n',
  });
}

const open = (fs: ReturnType<typeof files>) => openProject(fs, { cwd: "/app" });
const check = async (fs: ReturnType<typeof files>, locales?: string[]) =>
  validateProject(await open(fs), { requireApproved: true, locales });

async function drafts(fs: ReturnType<typeof files>) {
  const result = await submit(await open(fs), [
    { target: "android", locale: "de", key: "save", value: "Speichern" },
    { target: "xcstrings", locale: "de", key: "Save", value: "Speichern" },
    { target: "po", locale: "de", key: "Save", value: "Speichern" },
  ]);
  expect(result.rejected).toEqual([]);
  expect(result.accepted).toHaveLength(3);
}

async function approved(fs: ReturnType<typeof files>) {
  await drafts(fs);
  await approve(await open(fs));
}

describe("release validation", () => {
  it("requires missing locales even without strict", async () => {
    const issues = await check(files());
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.code === "locale-missing" && i.severity === "error")).toBe(true);
  });

  it("rejects drafts and reviewed entries, then passes approved entries in all formats", async () => {
    const fs = files();
    await drafts(fs);
    // Existing content checks remain usable during translation and review.
    expect(validateProject(await open(fs), { strict: true })).toEqual([]);
    expect((await check(fs)).map((i) => [i.target, i.code, i.severity])).toEqual([
      ["android", "not-approved", "error"],
      ["xcstrings", "not-approved", "error"],
      ["po", "not-approved", "error"],
    ]);
    await approve(await open(fs), { to: "reviewed" });
    expect(computeStatus(await open(fs)).every((s) => s.counts.reviewed === 1)).toBe(true);
    expect((await check(fs)).every((i) => i.message.includes("reviewed"))).toBe(true);
    await approve(await open(fs));
    const before = new Map(fs.files);
    expect(await check(fs)).toEqual([]);
    expect(fs.files).toEqual(before);
  });

  it("rejects an approved translation when its source changes", async () => {
    const fs = files();
    await approved(fs);
    fs.files.set(SOURCE, (await fs.readFile(SOURCE)).replace(">Save<", ">Save changes<"));
    expect(await check(fs)).toEqual([
      expect.objectContaining({
        code: "not-approved",
        severity: "error",
        target: "android",
        locale: "de",
        key: "save",
        file: "res/values-de/strings.xml",
        line: expect.any(Number),
        message: expect.stringContaining("Source changed"),
      }),
    ]);
  });

  it("requires new approval for hand edits without changing the files", async () => {
    const fs = files();
    await approved(fs);
    fs.files.set(TRANSLATION, (await fs.readFile(TRANSLATION)).replace("Speichern", "Sichern"));
    const before = new Map(fs.files);
    expect((await check(fs)).filter((i) => i.severity === "error")).toEqual([
      expect.objectContaining({ code: "not-approved", message: expect.stringContaining("edited") }),
    ]);
    expect(fs.files).toEqual(before);
    await approve(await open(fs), { states: ["edited"] });
    expect((await check(fs)).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("requires adoption of existing translations when the lockfile is absent", async () => {
    const fs = files();
    await approved(fs);
    fs.files.delete("/app/.localship/lock.json");
    expect((await check(fs)).filter((i) => i.code === "not-approved")).toHaveLength(3);
    expect((await check(fs)).every((i) => i.message.includes("untracked"))).toBe(true);
    await approve(await open(fs), { states: ["untracked"] });
    expect(await check(fs)).toEqual([]);
  });

  it.each(["needs_review", "new"])(
    "honors native %s / fuzzy flags added after approval",
    async (state) => {
      const fs = files();
      await approved(fs);
      fs.files.set(CATALOG, (await fs.readFile(CATALOG)).replace('"translated"', `"${state}"`));
      fs.files.set(PO, (await fs.readFile(PO)).replace('msgid "Save"', '#, fuzzy\nmsgid "Save"'));
      expect((await check(fs)).map((i) => [i.target, i.code])).toEqual([
        ["xcstrings", "not-approved"],
        ["po", "not-approved"],
      ]);
      expect(computeStatus(await open(fs)).filter((s) => s.counts.draft === 1)).toHaveLength(2);
      await approve(await open(fs));
      expect(await check(fs)).toEqual([]);
    },
  );

  it("still checks content when an invalid hand edit has been approved", async () => {
    const fs = files();
    fs.files.set(SOURCE, (await fs.readFile(SOURCE)).replace(">Save<", ">Save %1$s<"));
    await submit(await open(fs), [
      { target: "android", locale: "de", key: "save", value: "%1$s speichern" },
    ]);
    await approve(await open(fs));
    fs.files.set(
      TRANSLATION,
      (await fs.readFile(TRANSLATION)).replace("%1$s speichern", "Speichern"),
    );
    await approve(await open(fs), { states: ["edited"] });
    expect((await check(fs)).filter((i) => i.target === "android")).toEqual([
      expect.objectContaining({ code: "placeholder-missing", severity: "error", key: "save" }),
    ]);
  });

  it("reports new source keys as missing and ignores non-translatable strings", async () => {
    const fs = files();
    await approved(fs);
    fs.files.set(
      SOURCE,
      (await fs.readFile(SOURCE)).replace(
        "</resources>",
        '<string name="cancel">Cancel</string></resources>',
      ),
    );
    expect(await check(fs)).toEqual([
      expect.objectContaining({ code: "missing", severity: "error", key: "cancel" }),
    ]);
  });

  it("checks only selected locales and fails for a selected missing locale", async () => {
    const fs = files();
    await approved(fs);
    fs.files.set(
      "/app/localship.yaml",
      (await fs.readFile("/app/localship.yaml")).replace("[de]", "[de, fr]"),
    );
    expect(await check(fs, ["de"])).toEqual([]);
    expect((await check(fs)).map((i) => [i.locale, i.code, i.severity])).toEqual([
      ["fr", "locale-missing", "error"],
      ["fr", "locale-missing", "error"],
      ["fr", "locale-missing", "error"],
    ]);
  });

  it("does not pass a release check that selects no locales", async () => {
    const fs = files();
    fs.files.set(
      "/app/localship.yaml",
      (await fs.readFile("/app/localship.yaml")).replace("[de]", "[]"),
    );
    expect(await check(fs)).toEqual([
      expect.objectContaining({ code: "locales-empty", severity: "error" }),
    ]);
    await approved(fs);
    expect(await check(fs)).toEqual([]); // With no configured locales, discover those on disk.
    expect(await check(fs, [])).toEqual([
      expect.objectContaining({ code: "locales-empty", severity: "error" }),
    ]);
  });

  it("exposes the same opt-in release check over MCP", async () => {
    const fs = files();
    await drafts(fs);
    const server = createServer({ cwd: "/app", version: "test", fs });
    const client = new Client({ name: "release-check-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const read = async (args: Record<string, unknown>) => {
        const result = await client.callTool({ name: "localship_validate", arguments: args });
        expect(result.isError).not.toBe(true);
        const content = result.content as Array<{ type: string; text: string }>;
        return JSON.parse(content[0]?.text ?? "null");
      };
      expect(await read({ strict: true })).toMatchObject({ ok: true });
      expect(await read({ requireApproved: true })).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: "not-approved" })]),
      });
      await approve(await open(fs));
      expect(await read({ requireApproved: true })).toEqual({ ok: true, issues: [] });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
