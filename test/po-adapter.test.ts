import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type FileSystem, memoryFs, nodeFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { computeStatus } from "../src/core/status.js";
import { validateProject } from "../src/core/validate.js";
import { fixture } from "./helpers.js";

const ROOT = fixture("po/django");
const hasMsgfmt = (() => {
  try {
    execFileSync("msgfmt", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();
/** Reads the fixture from disk, keeps writes in memory. */
function sandbox(): FileSystem & { files: Map<string, string> } {
  const mem = memoryFs();
  return {
    ...nodeFs,
    files: mem.files,
    readFile: async (f) => mem.files.get(f) ?? nodeFs.readFile(f),
    exists: async (f) => mem.files.has(f) || nodeFs.exists(f),
    writeFile: (f, c) => mem.writeFile(f, c),
  };
}

describe("po adapter", async () => {
  const project = await openProject(nodeFs, { cwd: ROOT });
  const target = project.targets[0]?.target;
  if (!target) throw new Error("no target");

  it("reads source strings from the template", () => {
    expect([...target.source.entries.keys()]).toEqual([
      "Safe to spend today",
      "Hi %(name)s, you have %(count)d new alerts",
      "button\u0004Save",
      "Save",
      "%(count)d day left",
      "Spent {amount} of {budget}",
      "Unlock Pro",
      "Your safe-to-spend amount updates every time you log an expense, so you always know what is left for today.",
    ]);
    const save = target.source.entries.get("button\u0004Save");
    expect(save?.context).toBe("button");
    expect(save?.references).toEqual(["app/templates/home.html:8"]);
    expect(target.source.entries.get("Unlock Pro")?.comment).toBe(
      "Translators: shown on the paywall, keep it short.",
    );
    expect(target.source.entries.get("%(count)d day left")?.message).toEqual({
      kind: "plural",
      forms: { one: "%(count)d day left", other: "%(count)d days left" },
    });
  });

  it("finds exactly the planted problems", () => {
    const found = validateProject(project)
      .filter((i) => i.severity !== "info")
      .map((i) => `${i.severity} ${i.locale} ${i.code}${i.form ? `[${i.form}]` : ""}`)
      .sort();
    expect(found).toEqual(
      [
        "warning ru plural-forms-unexpected",
        "error hi placeholder-missing",
        "error ar placeholder-missing",
        "error ar placeholder-extra",
        "warning ar placeholder-missing[0]",
        "warning ar placeholder-missing[1]",
        "warning ar placeholder-missing[2]",
      ].sort(),
    );
  });

  it("counts fuzzy translations as drafts and empty ones as missing", () => {
    const hi = computeStatus(project).find((s) => s.locale === "hi");
    expect(hi?.counts).toMatchObject({ draft: 1, missing: 1, untracked: 6 });
  });

  it("describes gettext plural forms from the header", () => {
    expect(target.pluralSpec("ar")?.forms.map((f) => f.examples)).toEqual([
      "0",
      "1",
      "2",
      "3, 4, 5, 6, 7…",
      "11, 12, 13, 14, 15…",
      "100, 101, 102, 200, 201…",
    ]);
    expect(target.pluralSpec("ru")?.source).toBe("Plural-Forms header");
  });

  it("writes nothing new when given the existing translations", async () => {
    const fs = sandbox();
    const p = await openProject(fs, { cwd: ROOT });
    const t = p.targets[0]?.target;
    for (const locale of ["hi", "ar", "ru"]) {
      const catalog = t?.locales.get(locale);
      if (!catalog) throw new Error(locale);
      await t?.writeLocale(catalog);
      const file = path.join(ROOT, "locale", locale, "LC_MESSAGES", "django.po");
      expect(fs.files.get(file)).toBe(readFileSync(file, "utf8"));
    }
  });

  it("creates a new locale file from the template", async () => {
    const fs = sandbox();
    const p = await openProject(fs, { cwd: ROOT });
    const t = p.targets[0]?.target;
    const src = t?.source.entries.get("%(count)d day left");
    const save = t?.source.entries.get("button\u0004Save");
    if (!t || !src || !save) throw new Error("missing");
    await t.writeLocale({
      locale: "pt-BR",
      entries: new Map([
        [save.key, { ...save, message: { kind: "text", value: "Salvar" } }],
        [
          src.key,
          {
            ...src,
            message: {
              kind: "plural",
              forms: { "0": "%(count)d dia restante", "1": "%(count)d dias restantes" },
            },
            needsReview: true,
          },
        ],
      ]),
    });
    const file = path.join(ROOT, "locale", "pt_BR", "LC_MESSAGES", "django.po");
    const out = fs.files.get(file) ?? "";
    expect(out).toContain('"Language: pt_BR\\n"');
    expect(out).toContain('"Plural-Forms: nplurals=2; plural=(n > 1);\\n"');
    expect(out).toContain(
      '#: app/templates/home.html:8\nmsgctxt "button"\nmsgid "Save"\nmsgstr "Salvar"',
    );
    expect(out).toContain(
      '#: app/views.py:31\n#, fuzzy, python-format\nmsgid "%(count)d day left"\nmsgid_plural "%(count)d days left"\nmsgstr[0] "%(count)d dia restante"',
    );
    expect(out).toContain('#: app/views.py:12\nmsgid "Safe to spend today"\nmsgstr ""');
    if (hasMsgfmt) {
      expect(() =>
        execFileSync("msgfmt", ["-c", "-o", "/dev/null", "-"], { input: out, stdio: "pipe" }),
      ).not.toThrow();
    }
  });

  it("uses every msgid as the source when there is no template", async () => {
    const fs = memoryFs({
      "/a/l10n.config.yaml": "targets:\n  - format: po\n    path: po/{locale}.po\n",
      "/a/po/de.po": 'msgid "One"\nmsgstr "Eins"\n\nmsgid "Two"\nmsgstr ""\n',
      "/a/po/fr.po": 'msgid "Three"\nmsgstr "Trois"\n',
    });
    const p = await openProject(fs, { cwd: "/a" });
    expect([...(p.targets[0]?.target.source.entries.keys() ?? [])]).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(computeStatus(p).map((s) => [s.locale, s.counts.missing])).toEqual([
      ["de", 2],
      ["fr", 2],
    ]);
  });

  it.skipIf(!hasMsgfmt)("agrees with msgfmt --check on placeholder errors", () => {
    for (const [locale, bad] of [
      ["hi", true],
      ["ar", true],
      ["ru", false],
    ] as const) {
      const file = path.join(ROOT, "locale", locale, "LC_MESSAGES", "django.po");
      const run = () => execFileSync("msgfmt", ["-c", "-o", "/dev/null", file], { stdio: "pipe" });
      if (bad) expect(run).toThrow();
      else expect(run).not.toThrow();
    }
  });
});

describe("po newlines", () => {
  it("makes a leading or trailing newline mismatch an error, as msgfmt does", async () => {
    const fs = memoryFs({
      "/a/l10n.config.yaml": "targets:\n  - format: po\n    path: po/{locale}.po\n",
      "/a/po/de.po": [
        'msgid "Usage:\\n"',
        'msgstr "Verwendung:"',
        "",
        'msgid "\\nDone"',
        'msgstr "\\nFertig"',
        "",
        'msgid "Hello "',
        'msgstr "Hallo"',
        "",
      ].join("\n"),
    });
    const issues = validateProject(await openProject(fs, { cwd: "/a" }));
    expect(
      issues.filter((i) => i.severity !== "info").map((i) => `${i.severity} ${i.key} ${i.code}`),
    ).toEqual(["error Usage:\n newline-mismatch", "warning Hello  whitespace"]);
    if (hasMsgfmt) {
      const run = () =>
        execFileSync("msgfmt", ["-c", "-o", "/dev/null", "-"], {
          input: fs.files.get("/a/po/de.po"),
          stdio: "pipe",
        });
      expect(run).toThrow(/fatal error/);
    }
  });
});
