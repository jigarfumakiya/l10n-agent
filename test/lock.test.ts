import { describe, expect, it } from "vitest";
import { UserError } from "../src/core/errors.js";
import { memoryFs } from "../src/core/fs.js";
import { emptyLock, readLock, setLockEntry, writeLock } from "../src/core/lock.js";

describe("lockfile", () => {
  it("is empty when missing", async () => {
    expect(await readLock(memoryFs(), "/a/.l10n/lock.json")).toEqual(emptyLock());
  });

  it("explains a corrupt file instead of crashing", async () => {
    const fs = memoryFs({ "/a/.l10n/lock.json": '{"version":1, broken' });
    const err = await readLock(fs, "/a/.l10n/lock.json").catch((e: Error) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toMatch(
      /lock\.json is not valid JSON[\s\S]*delete it to start over/,
    );
    await expect(readLock(memoryFs({ "/a/l.json": '{"version":9}' }), "/a/l.json")).rejects.toThrow(
      /version 9/,
    );
  });

  it("writes sorted keys so it diffs cleanly", async () => {
    const fs = memoryFs();
    const lock = emptyLock();
    setLockEntry(lock, "po", "hi", "b", { source: "1", target: "2", state: "draft" });
    setLockEntry(lock, "po", "ar", "a", { source: "3", target: "4", state: "approved" });
    await writeLock(fs, "/a/lock.json", lock);
    const text = fs.files.get("/a/lock.json") ?? "";
    expect(text.indexOf('"ar"')).toBeLessThan(text.indexOf('"hi"'));
    expect(await readLock(fs, "/a/lock.json")).toEqual(lock);
  });
});
