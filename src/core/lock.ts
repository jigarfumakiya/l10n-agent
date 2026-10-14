import { UserError } from "./errors.js";
import type { FileSystem } from "./fs.js";

/** How far a translation has come. `stale`, `edited`, `missing` and `untracked` are derived, never stored. */
export type StoredState = "draft" | "reviewed" | "approved";

export interface LockEntry {
  /** Hash of the source message the translation was made from. */
  source: string;
  /**
   * The source text itself, so a translator can see what changed when it goes stale.
   * The hash decides staleness; this is only shown.
   */
  sourceText?: string | Record<string, string> | string[];
  /** Hash of the translation as the tool last wrote or approved it. */
  target: string;
  state: StoredState;
  /** Model that produced the draft, when known. */
  model?: string;
  /** AI review score, 0–100. */
  score?: number;
}

export interface Lockfile {
  version: 1;
  /** target id → locale → key → entry */
  targets: Record<string, Record<string, Record<string, LockEntry>>>;
}

export function emptyLock(): Lockfile {
  return { version: 1, targets: {} };
}

export async function readLock(fs: FileSystem, file: string): Promise<Lockfile> {
  if (!(await fs.exists(file))) return emptyLock();
  let data: Lockfile;
  try {
    data = JSON.parse(await fs.readFile(file)) as Lockfile;
  } catch (e) {
    throw new UserError(
      `${file} is not valid JSON (${(e as Error).message}). It records translation state; restore it from git, or delete it to start over.`,
    );
  }
  if (data?.version !== 1) {
    throw new UserError(`${file}: unsupported lockfile version ${String(data?.version)}`);
  }
  data.targets ??= {};
  return data;
}

export function getLockEntry(
  lock: Lockfile,
  target: string,
  locale: string,
  key: string,
): LockEntry | undefined {
  return lock.targets[target]?.[locale]?.[key];
}

export function setLockEntry(
  lock: Lockfile,
  target: string,
  locale: string,
  key: string,
  entry: LockEntry,
): void {
  lock.targets[target] ??= {};
  const byLocale = lock.targets[target];
  byLocale[locale] ??= {};
  byLocale[locale][key] = entry;
}

/** Keys are sorted at every level so the file diffs cleanly. */
export async function writeLock(fs: FileSystem, file: string, lock: Lockfile): Promise<void> {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v) || v === null || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
    );
  };
  await fs.writeFile(file, `${JSON.stringify(sort(lock), null, 2)}\n`);
}
