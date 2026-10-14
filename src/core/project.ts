import path from "node:path";
import { androidAdapter } from "../formats/android/adapter.js";
import type { FormatAdapter, LoadedTarget } from "../formats/types.js";
import { type Config, loadConfig, type TargetConfig } from "./config.js";
import type { FileSystem } from "./fs.js";
import { type Lockfile, readLock } from "./lock.js";

const ADAPTERS: Record<TargetConfig["format"], FormatAdapter<never>> = {
  "android-xml": androidAdapter as FormatAdapter<never>,
};

export interface ProjectTarget {
  config: TargetConfig;
  adapter: FormatAdapter<never>;
  loaded: LoadedTarget;
}

export interface Project {
  config: Config;
  root: string;
  configFile: string;
  lockFile: string;
  lock: Lockfile;
  targets: ProjectTarget[];
  fs: FileSystem;
}

export async function openProject(
  fs: FileSystem,
  opts: { cwd: string; config?: string },
): Promise<Project> {
  const { config, root, file } = await loadConfig(fs, opts.cwd, opts.config);
  const lockFile = path.resolve(root, config.lock);
  const targets: ProjectTarget[] = [];
  for (const t of config.targets) {
    const adapter = ADAPTERS[t.format];
    const loaded = await adapter.load(fs, root, t as never, config.sourceLocale);
    targets.push({ config: t, adapter, loaded });
  }
  return {
    config,
    root,
    configFile: file,
    lockFile,
    lock: await readLock(fs, lockFile),
    targets,
    fs,
  };
}

/** Locales to work on: the configured ones, or every locale found on disk if none are configured. */
export function projectLocales(project: Project): string[] {
  if (project.config.locales.length > 0) return project.config.locales;
  const found = new Set<string>();
  for (const t of project.targets) for (const l of t.loaded.locales.keys()) found.add(l);
  return [...found].sort();
}
