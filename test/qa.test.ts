import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import type { Placeholder, ValueAnalysis } from "../src/core/model.js";
import { openProject } from "../src/core/project.js";
import { lengthCheck, roleOf, textChecks } from "../src/core/qa.js";
import { validateProject } from "../src/core/validate.js";
import { approve, nextBatch, submit } from "../src/core/workflow.js";

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

const res = (strings: Record<string, string>) =>
  `<resources>${Object.entries(strings)
    .map(([k, v]) => `<string name="${k}">${v}</string>`)
    .join("")}</resources>`;

describe("consistency", () => {
  const files = {
    "/p/localship.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
    "/p/res/values/strings.xml": res({
      account_delete: "Delete account",
      accounts_delete: "Delete account",
      settings_delete: "Delete account",
      cancel: "Cancel",
    }),
  };

  it("flags the same text translated different ways, pointing at the odd one out", async () => {
    const fs = memoryFs({
      ...files,
      "/p/res/values-hi/strings.xml": res({
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
      "/p/res/values-hi/strings.xml": res({ account_delete: "अकाउंट हटाएँ" }),
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

describe("roles and length", () => {
  const role = (...code: string[]) => roleOf(code.map((c) => ({ code: c })));

  it("reads a string's role from the code that uses it", () => {
    expect(role("Button(onClick = save) { Text(stringResource(R.string.save)) }")).toBe("button");
    expect(role("SmPrimaryButton(stringResource(R.string.limit_see_pro))")).toBe("button");
    expect(role('Button("Save") { save() }')).toBe("button");
    expect(
      role(
        "IconButton(onClick = close) {\nIcon(x, contentDescription = stringResource(R.string.close))",
      ),
    ).toBe("accessibility label");
    expect(role('.navigationTitle("Settings")')).toBe("title");
    expect(role("Toast.makeText(context, R.string.saved, Toast.LENGTH_SHORT)")).toBe("toast");
    expect(role("val label = stringResource(R.string.save)")).toBeUndefined();
  });

  it("lets the line with the string decide over the line before it", () => {
    expect(
      role(
        "confirmButton = { TextButton(onClick = ok) { Text(stringResource(R.string.ok)) } },\ntitle = { Text(stringResource(R.string.dialog_title)) },",
      ),
    ).toBe("title");
  });

  it("warns only when a translation clearly overflows a tight place", () => {
    const check = (r: Parameters<typeof lengthCheck>[0], s: string, t: string) =>
      lengthCheck(r, value(s), value(t))?.code;
    expect(check("button", "Retry", "إعادة المحاولة")).toBe("too-long");
    expect(check("tab", "Home", "الرئيسية")).toBeUndefined();
    expect(check("button", "Save", "Speichern")).toBeUndefined();
    expect(check("title", "Retry", "إعادة المحاولة")).toBeUndefined();
    // Chinese and Japanese characters take two columns each.
    expect(check("button", "Save", "保存设置并继续")).toBe("too-long");
  });
});

describe("notes", () => {
  it("keeps a translator's note with its translation, until the translation changes", async () => {
    const fs = memoryFs({
      "/p/localship.yaml": "locales: [de]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/p/res/values/strings.xml": res({ open: "Open" }),
    });
    const project = await openProject(fs, { cwd: "/p" });
    await submit(
      project,
      [{ locale: "de", key: "open", value: "Öffnen", note: "A button, not a status" }],
      {
        usages: false,
      },
    );
    const lock = () => JSON.parse(fs.files.get("/p/.localship/lock.json") ?? "{}");
    expect(lock().targets.android.de.open.note).toBe("A button, not a status");

    const reopened = await openProject(fs, { cwd: "/p" });
    const batch = await nextBatch(reopened, { states: ["draft"], usages: false });
    expect(batch.items[0]?.note).toBe("A button, not a status");

    await approve(reopened, { locales: ["de"] });
    expect(lock().targets.android.de.open.note).toBe("A button, not a status");

    await submit(
      await openProject(fs, { cwd: "/p" }),
      [{ locale: "de", key: "open", value: "Offen" }],
      {
        force: true,
        usages: false,
      },
    );
    expect(lock().targets.android.de.open.note).toBeUndefined();
  });
});
