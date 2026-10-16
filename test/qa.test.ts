import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import type { Placeholder, ValueAnalysis } from "../src/core/model.js";
import { openProject } from "../src/core/project.js";
import { textChecks } from "../src/core/qa.js";
import { validateProject } from "../src/core/validate.js";
import { submit } from "../src/core/workflow.js";

const value = (text: string, placeholders: Placeholder[] = []): ValueAnalysis => ({
  text,
  placeholders,
  tags: [],
  lints: [],
});
const codes = (source: string, target: string, locale = "de", countImplied = false) =>
  textChecks(value(source), value(target), { locale, countImplied }).map((f) => f.code);

describe("text checks", () => {
  it("notices a number that went missing or changed", () => {
    expect(codes("Day 3 of 14", "Tag 3 von 41")).toEqual(["number-mismatch"]);
    expect(codes("1,385 strings", "1.385 Texte")).toEqual([]);
    expect(codes("1,385 strings", "१,३८५ स्ट्रिंग", "hi")).toEqual([]);
    expect(codes("Every 2 weeks", "كل أسبوعين", "ar")).toEqual([]);
    expect(codes("1 note", "ملاحظة واحدة", "ar", true)).toEqual([]);
  });

  it("ignores digits inside placeholders", () => {
    const p: Placeholder = { id: "1", type: "s", raw: "%1$s", positional: true };
    const r = textChecks(value("Hi %1$s", [p]), value("Hallo %1$s", [p]), { locale: "de" });
    expect(r).toEqual([]);
  });

  it("keeps a closing question mark, colon or ellipsis, in any script", () => {
    expect(codes("Delete this note?", "Diese Notiz löschen.")).toEqual(["punctuation-end"]);
    expect(codes("Delete this note?", "هل تريد حذف هذه الملاحظة؟", "ar")).toEqual([]);
    expect(codes("Delete this note?", "删除这条笔记？", "zh")).toEqual([]);
    expect(codes("Name:", "नाम:", "hi")).toEqual([]);
    expect(codes("Loading...", "Wird geladen…")).toEqual([]);
    expect(codes('Say "done?"', 'Sag „fertig?"')).toEqual([]);
    expect(codes("Ready?", "พร้อมแล้ว", "th")).toEqual([]);
  });

  it("keeps all-caps labels in capitals, but only where the script has case", () => {
    expect(codes("SAFE TO SPEND", "Sicher ausgeben")).toEqual(["case-mismatch"]);
    expect(codes("SAFE TO SPEND", "SICHER AUSGEBEN")).toEqual([]);
    expect(codes("SAFE TO SPEND", "आज खर्च के लिए", "hi")).toEqual([]);
    expect(codes("LUME & YOU", "Lume और आप", "hi")).toEqual([]);
    expect(codes("LUME & YOU", "Lume и вы", "ru")).toEqual(["case-mismatch"]);
  });

  it("keeps links, emails and emoji", () => {
    expect(codes("See https://example.com/help.", "Siehe https://example.de/hilfe.")).toEqual([
      "token-missing",
    ]);
    expect(codes("Write to help@example.com", "Schreib an help@example.com")).toEqual([]);
    expect(codes("Nice work 🎉", "Gut gemacht")).toEqual(["token-missing"]);
    expect(codes("Nice work 🎉", "Gut gemacht 🎉")).toEqual([]);
  });
});

const res = (dir: string, strings: Record<string, string>) =>
  `<resources>${Object.entries(strings)
    .map(([k, v]) => `<string name="${k}">${v}</string>`)
    .join("")}</resources>`;

describe("consistency", () => {
  const files = {
    "/p/localship.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
    "/p/res/values/strings.xml": res("values", {
      account_delete: "Delete account",
      accounts_delete: "Delete account",
      settings_delete: "Delete account",
      cancel: "Cancel",
    }),
  };

  it("flags the same text translated different ways, pointing at the odd one out", async () => {
    const fs = memoryFs({
      ...files,
      "/p/res/values-hi/strings.xml": res("values-hi", {
        account_delete: "अकाउंट हटाएँ",
        accounts_delete: "खाता हटाएँ",
        settings_delete: "अकाउंट हटाएँ",
      }),
    });
    const found = validateProject(await openProject(fs, { cwd: "/p" })).filter(
      (i) => i.code === "inconsistent",
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.key).toBe("accounts_delete");
    expect(found[0]?.message).toContain('"Delete account" is translated 2 ways');
  });

  it("warns at submit time, against the project and the rest of the batch", async () => {
    const fs = memoryFs({
      ...files,
      "/p/res/values-hi/strings.xml": res("values-hi", { account_delete: "अकाउंट हटाएँ" }),
    });
    const r = await submit(
      await openProject(fs, { cwd: "/p" }),
      [
        { locale: "hi", key: "accounts_delete", value: "खाता हटाएँ" },
        { locale: "hi", key: "settings_delete", value: "अकाउंट हटाएँ" },
      ],
      { dryRun: true },
    );
    const warned = r.accepted.filter((a) => a.warnings.some((w) => w.code === "inconsistent"));
    expect(warned.map((a) => a.key)).toEqual(["accounts_delete"]);
  });
});
