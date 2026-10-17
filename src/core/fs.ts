import { randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserError } from "./errors.js";

/** File access is injected so the core stays testable and embeddable. Paths are absolute. */
export interface FileSystem {
  readFile(file: string): Promise<string>;
  /** Writes atomically: a crash never leaves a half-written file. */
  writeFile(file: string, content: string): Promise<void>;
  exists(file: string): Promise<boolean>;
  listDir(dir: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  /** Exclusive cooperative write lock; fails promptly if another writer owns it. */
  withLock<T>(file: string, run: () => Promise<T>): Promise<T>;
}

function busy(file: string): UserError {
  return new UserError(
    `Another Localship write is in progress (${file}). Retry after it finishes. If a process crashed, verify no writer is running before removing this lock.`,
  );
}

/**
 * Windows refuses to replace a file another process (or a concurrent write, an antivirus or
 * indexer scan) has open, with EPERM, EACCES or EBUSY. It clears within moments, so retry briefly.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 20 || !(code === "EPERM" || code === "EACCES" || code === "EBUSY")) throw e;
      await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 10));
    }
  }
}

export const nodeFs: FileSystem = {
  readFile: (file) => fsp.readFile(file, "utf8"),
  async writeFile(file, content) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(tmp, content, { encoding: "utf8", flag: "wx" });
      await renameWithRetry(tmp, file);
    } finally {
      await fsp.rm(tmp, { force: true });
    }
  },
  async withLock(file, run) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const handle = await fsp.open(file, "wx").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "EEXIST") throw busy(file);
      throw e;
    });
    try {
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          host: os.hostname(),
          started: new Date().toISOString(),
        }),
      );
      return await run();
    } finally {
      await handle.close();
      await fsp.unlink(file);
    }
  },
  async exists(file) {
    try {
      await fsp.access(file);
      return true;
    } catch {
      return false;
    }
  },
  async listDir(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  },
};

/** In-memory file system for tests. Paths are POSIX; Windows paths (`C:\r\x`) map to `/r/x`. */
export function memoryFs(files: Record<string, string> = {}): FileSystem & {
  files: Map<string, string>;
} {
  const map = new Map(Object.entries(files));
  const locks = new Set<string>();
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  const dirPrefix = (dir: string) => (norm(dir).endsWith("/") ? norm(dir) : `${norm(dir)}/`);
  return {
    files: map,
    async withLock(file, run) {
      const key = norm(file);
      if (locks.has(key)) throw busy(file);
      locks.add(key);
      try {
        return await run();
      } finally {
        locks.delete(key);
      }
    },
    async readFile(file) {
      const v = map.get(norm(file));
      if (v === undefined) throw new Error(`ENOENT: ${file}`);
      return v;
    },
    async writeFile(file, content) {
      map.set(norm(file), content);
    },
    async exists(file) {
      if (map.has(norm(file))) return true;
      const prefix = dirPrefix(file);
      return [...map.keys()].some((k) => k.startsWith(prefix));
    },
    async listDir(dir) {
      const prefix = dirPrefix(dir);
      const seen = new Map<string, boolean>();
      for (const k of map.keys()) {
        if (!k.startsWith(prefix)) continue;
        const [head, ...rest] = k.slice(prefix.length).split("/");
        if (head) seen.set(head, (seen.get(head) ?? false) || rest.length > 0);
      }
      if (seen.size === 0) throw new Error(`ENOENT: ${dir}`);
      return [...seen].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
  };
}
