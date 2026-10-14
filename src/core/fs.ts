import { promises as fsp } from "node:fs";
import path from "node:path";

/** File access is injected so the core stays testable and embeddable. Paths are absolute. */
export interface FileSystem {
  readFile(file: string): Promise<string>;
  /** Writes atomically: a crash never leaves a half-written file. */
  writeFile(file: string, content: string): Promise<void>;
  exists(file: string): Promise<boolean>;
  listDir(dir: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
}

export const nodeFs: FileSystem = {
  readFile: (file) => fsp.readFile(file, "utf8"),
  async writeFile(file, content) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, content, "utf8");
    await fsp.rename(tmp, file);
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

/** In-memory file system for tests. */
export function memoryFs(files: Record<string, string> = {}): FileSystem & {
  files: Map<string, string>;
} {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    async readFile(file) {
      const v = map.get(file);
      if (v === undefined) throw new Error(`ENOENT: ${file}`);
      return v;
    },
    async writeFile(file, content) {
      map.set(file, content);
    },
    async exists(file) {
      if (map.has(file)) return true;
      const prefix = file.endsWith("/") ? file : `${file}/`;
      return [...map.keys()].some((k) => k.startsWith(prefix));
    },
    async listDir(dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
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
