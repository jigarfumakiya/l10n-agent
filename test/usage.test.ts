import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { normalizeCatalogKey, normalizeSwiftLiteral } from "../src/core/usage.js";
import { nextBatch } from "../src/core/workflow.js";

describe("usage context", () => {
  it("shows Android code that uses each string, with the line that gives its role", async () => {
    const fs = memoryFs({
      "/a/l10n.config.yaml":
        "locales: [hi]\ntargets:\n  - format: android-xml\n    path: app/src/main/res\n",
      "/a/app/src/main/res/values/strings.xml":
        '<resources><string name="save">Save</string><string name="cancel">Cancel</string><string name="unused">Unused</string></resources>',
      "/a/app/src/main/java/com/x/budget/BudgetScreen.kt": [
        "@Composable",
        "fun BudgetScreen(onSave: () -> Unit) {",
        "    Button(onClick = onSave) {",
        "        Text(stringResource(R.string.save))",
        "    }",
        "}",
      ].join("\n"),
      "/a/app/src/main/res/layout/dialog.xml":
        '<LinearLayout>\n    <Button android:text="@string/cancel" />\n</LinearLayout>',
      "/a/app/build/generated/R.kt": "R.string.unused",
    });
    const batch = await nextBatch(await openProject(fs, { cwd: "/a" }));
    const usage = Object.fromEntries(batch.items.map((i) => [i.key, i.usage]));
    expect(usage.save).toEqual([
      {
        at: "app/src/main/java/com/x/budget/BudgetScreen.kt:4",
        code: "Button(onClick = onSave) {\n    Text(stringResource(R.string.save))",
      },
    ]);
    expect(usage.cancel?.[0]?.at).toBe("app/src/main/res/layout/dialog.xml:2");
    // Build output is skipped, so a string used nowhere else has no usage.
    expect(usage.unused).toBeUndefined();
  });

  it("matches SwiftUI text, interpolations included, to String Catalog keys", async () => {
    const fs = memoryFs({
      "/i/l10n.config.yaml":
        "locales: [hi]\ntargets:\n  - format: xcstrings\n    path: App/Localizable.xcstrings\n",
      "/i/App/Localizable.xcstrings": JSON.stringify({
        sourceLanguage: "en",
        strings: { "Hi %@, you have %lld alerts": {}, Done: {} },
        version: "1.0",
      }),
      "/i/App/Home.swift": [
        "VStack {",
        '    Text("Hi \\(user.name), you have \\(alerts.count) alerts")',
        '    Button("Done") { dismiss() }',
        "}",
      ].join("\n"),
    });
    const batch = await nextBatch(await openProject(fs, { cwd: "/i" }));
    const usage = Object.fromEntries(batch.items.map((i) => [i.key, i.usage?.[0]?.at]));
    expect(usage).toEqual({
      "Hi %@, you have %lld alerts": "App/Home.swift:2",
      Done: "App/Home.swift:3",
    });
  });

  it("reads the code behind gettext references, and keeps references it can't open", async () => {
    const fs = memoryFs({
      "/g/l10n.config.yaml":
        "locales: [de]\ntargets:\n  - format: po\n    path: po/{locale}.po\n    template: po/app.pot\n",
      "/g/po/app.pot":
        '#: app/views.py:2\nmsgid "Hello"\nmsgstr ""\n\n#: gone.py:9\nmsgid "Bye"\nmsgstr ""\n',
      "/g/app/views.py": "def home(request):\n    return render(request, _('Hello'))\n",
    });
    const batch = await nextBatch(await openProject(fs, { cwd: "/g" }));
    expect(batch.items[0]?.usage).toEqual([
      { at: "app/views.py:2", code: "def home(request):\n    return render(request, _('Hello'))" },
    ]);
    expect(batch.items[1]).toMatchObject({ references: ["gone.py:9"] });
    expect(batch.items[1]?.usage).toBeUndefined();
  });

  it("can be turned off", async () => {
    const fs = memoryFs({
      "/a/l10n.config.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/a/res/values/strings.xml": '<resources><string name="save">Save</string></resources>',
      "/a/Main.kt": "Text(stringResource(R.string.save))",
    });
    const batch = await nextBatch(await openProject(fs, { cwd: "/a" }), { usages: false });
    expect(batch.items[0]?.usage).toBeUndefined();
  });
});

describe("normalizing keys", () => {
  it("gives Swift literals and catalog keys the same shape", () => {
    expect(normalizeSwiftLiteral('Hi \\(name.first(of: "x")), \\(n) left')).toBe(
      normalizeCatalogKey("Hi %@, %lld left"),
    );
    expect(normalizeCatalogKey("100%% done")).toBe(normalizeSwiftLiteral("100% done"));
    expect(normalizeCatalogKey("%1$@ and %2$@")).toBe(normalizeSwiftLiteral("\\(a) and \\(b)"));
  });
});
