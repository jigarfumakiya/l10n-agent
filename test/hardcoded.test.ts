import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { openProject } from "../src/core/project.js";
import { detect } from "../src/detect/detect.js";
import { estimateHardcoded, hardcodedNotes } from "../src/detect/hardcoded.js";

const screen = (n: number) =>
  Array.from({ length: n }, (_, i) => `        Text("Budget line ${i}")`).join("\n");

function app(extra: Record<string, string> = {}) {
  return memoryFs({
    "/r/build.gradle.kts": "",
    "/r/app/src/main/AndroidManifest.xml": "<manifest/>",
    "/r/app/src/main/res/values/strings.xml":
      '<resources><string name="app_name">StillMoney</string><string name="widget">Safe to spend today</string></resources>',
    "/r/app/src/main/java/com/x/Budget.kt": `@Composable\nfun Budget() {\n${screen(12)}\n}`,
    ...extra,
  });
}

describe("hardcoded text", () => {
  it("counts UI text in Kotlin and layouts, and skips what users never see", async () => {
    const fs = memoryFs({
      "/r/app/src/main/java/A.kt": [
        'Text("Safe to spend")',
        'Button(onClick = {}) { Text(text = "Save budget") }',
        'Icon(Icons.Default.Add, contentDescription = "Add transaction")',
        'Toast.makeText(ctx, "Saved", Toast.LENGTH_SHORT).show()',
        'Log.d(TAG, "Saving budget now")',
        'Modifier.testTag("save_button")',
        'navController.navigate(route = "settings/account")',
        "Text(stringResource(R.string.save))",
        'Text("%1$s")',
        'title = "budget_screen"',
        '// Text("Old copy")',
        'val bob = idle.animateFloat(0f, 1f, spec, label = "bob")',
        'val t = rememberInfiniteTransition(label = "Lume idle")',
        'label = "press"',
      ].join("\n"),
      "/r/app/src/main/res/layout/row.xml":
        '<TextView android:text="Monthly plan" />\n<TextView android:text="@string/save" />',
      "/r/app/src/test/java/T.kt": 'Text("Only in tests")',
    });
    const [android] = await estimateHardcoded(fs, "/r", [
      "app/src/main/java/A.kt",
      "app/src/main/res/layout/row.xml",
      "app/src/test/java/T.kt",
    ]);
    expect(android?.literals).toBe(5);
    expect(android?.files).toBe(2);
    expect(android?.byModule).toEqual({ app: 5 });
  });

  it("warns in detect when the code holds more text than the resources", async () => {
    const r = await detect(app(), "/r");
    const [c] = r.candidates;
    expect(c).toMatchObject({ strings: 2, codeLiterals: 12, confidence: "medium" });
    expect(c?.questions[0]).toMatch(/About 12 pieces of UI text are still written in the code/);
    expect(r.hints[0]).toMatch(/Most of this app's text is still in the code/);
    expect(r.hints[0]).toContain("app/src/main/java/com/x/Budget.kt:3");
  });

  it("stays quiet once most text is in resources", async () => {
    const strings = Array.from(
      { length: 20 },
      (_, i) => `<string name="s${i}">Line ${i}</string>`,
    ).join("");
    const r = await detect(
      app({ "/r/app/src/main/res/values/strings.xml": `<resources>${strings}</resources>` }),
      "/r",
    );
    expect(r.candidates[0]).toMatchObject({ confidence: "high", codeLiterals: 12 });
    expect(r.hints).toEqual([]);
  });

  it("adds a note to status for a set-up project that is still mostly in code", async () => {
    const fs = app({
      "/r/localship.yaml":
        "locales: [hi]\ntargets:\n  - format: android-xml\n    path: app/src/main/res\n",
    });
    const notes = await hardcodedNotes(await openProject(fs, { cwd: "/r" }));
    expect(notes).toMatchObject([{ target: "android", resourceStrings: 2, codeLiterals: 12 }]);
    expect(notes[0]?.message).toMatch(/localship-extract/);
  });
});

describe("init on a mostly hardcoded app", () => {
  it("sets up, but warns and points to extraction instead of translating", async () => {
    const { runInit } = await import("../src/cli/init-command.js");
    const fs = app();
    const out: string[] = [];
    const io = {
      interactive: false,
      log: (l: string) => out.push(l),
      error: (l: string) => out.push(l),
      ask: async (_q: string, f: string) => f,
    };
    expect(await runInit(fs, { cwd: "/r", yes: true, locales: ["hi"] }, io)).toBe(0);
    expect(fs.files.has("/r/localship.yaml")).toBe(true);
    const text = out.join("\n");
    expect(text).toMatch(/about 12 pieces of UI text are still written in the code/);
    expect(text).toMatch(/Next: move the text into resources/);
    expect(text).not.toMatch(/Next: `localship status`/);
  });
});
