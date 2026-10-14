import path from "node:path";
import { androidAdapter } from "../formats/android/adapter.js";
import { poAdapter } from "../formats/po/adapter.js";
import type { FormatAdapter, Target } from "../formats/types.js";
import { xcstringsAdapter } from "../formats/xcstrings/adapter.js";
import { type Config, loadConfig, type TargetConfig, targetId } from "./config.js";
import type { FileSystem } from "./fs.js";
import { type Lockfile, readLock } from "./lock.js";

const ADAPTERS: {
  [F in TargetConfig["format"]]: FormatAdapter<Extract<TargetConfig, { format: F }>>;
} = {
  "android-xml": androidAdapter,
  po: poAdapter,
  xcstrings: xcstringsAdapter,
};

export interface ProjectTarget {
  config: TargetConfig;
  target: Target;
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
    const target = await openTarget(fs, root, t, config.sourceLocale, targetId(t, config.targets));
    targets.push({ config: t, target });
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

/** Opens one target with its format's adapter. */
export function openTarget(
  fs: FileSystem,
  root: string,
  config: TargetConfig,
  sourceLocale: string,
  id: string,
): Promise<Target> {
  const adapter = ADAPTERS[config.format] as FormatAdapter<TargetConfig>;
  return adapter.open(config, { fs, root, sourceLocale, id });
}

/** Locales to work on: the configured ones, or every locale found on disk if none are configured. */
export function projectLocales(project: Project): string[] {
  if (project.config.locales.length > 0) return project.config.locales;
  const found = new Set<string>();
  for (const { target } of project.targets) for (const l of target.locales.keys()) found.add(l);
  return [...found].sort();
}
