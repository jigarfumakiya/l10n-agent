import { describe, expect, it } from "vitest";
import { memoryFs } from "../src/core/fs.js";
import { hashMessage } from "../src/core/hash.js";
import { openProject } from "../src/core/project.js";
import { computeStatus, statusNotes } from "../src/core/status.js";

const text = (value: string) => ({ kind: "text" as const, value });

describe("status", () => {
  it("derives states from the lockfile", async () => {
    const lock = {
      version: 1,
      targets: {
        android: {
          hi: {
            ok: {
              source: hashMessage(text("OK")),
              target: hashMessage(text("ठीक")),
              state: "approved",
            },
            changed: {
              source: hashMessage(text("Old")),
              target: hashMessage(text("पुराना")),
              state: "draft",
            },
            edited: {
              source: hashMessage(text("Edit")),
              target: hashMessage(text("x")),
              state: "draft",
            },
          },
        },
      },
    };
    const fs = memoryFs({
      "/app/localship.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/app/.localship/lock.json": JSON.stringify(lock),
      "/app/res/values/strings.xml":
        '<resources><string name="ok">OK</string><string name="changed">New</string><string name="edited">Edit</string><string name="hand">Hand</string><string name="todo">Todo</string><string name="fixed" translatable="false">X</string></resources>',
      "/app/res/values-hi/strings.xml":
        '<resources><string name="ok">ठीक</string><string name="changed">पुराना</string><string name="edited">संपादित</string><string name="hand">हाथ</string></resources>',
    });
    const [s] = computeStatus(await openProject(fs, { cwd: "/app" }));
    expect(s?.total).toBe(5);
    expect(Object.fromEntries(s?.entries.map((e) => [e.key, e.state]) ?? [])).toEqual({
      ok: "approved",
      changed: "stale",
      edited: "edited",
      hand: "untracked",
      todo: "missing",
    });
  });

  it("notes duplicate keys and translations of deleted strings", async () => {
    const fs = memoryFs({
      "/app/localship.yaml": "locales: [hi]\ntargets:\n  - format: android-xml\n    path: res\n",
      "/app/res/values/strings.xml":
        '<resources><string name="a">A</string><string name="a">A again</string></resources>',
      "/app/res/values-hi/strings.xml":
        '<resources><string name="a">ए</string><string name="gone">गया</string></resources>',
    });
    const notes = statusNotes(await openProject(fs, { cwd: "/app" }));
    expect(notes.map((n) => [n.locale, n.code, n.message])).toEqual([
      [undefined, "duplicate-key", "1 key is defined twice; run `localship validate` for where"],
      ["hi", "orphan", "1 translation of deleted strings; `localship prune` removes it"],
    ]);
  });
});
