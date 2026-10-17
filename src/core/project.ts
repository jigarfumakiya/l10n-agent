import path from "node:path";
import { androidAdapter } from "../formats/android/adapter.js";
import { poAdapter } from "../formats/po/adapter.js";
import type { FormatAdapter, Target } from "../formats/types.js";
import { xcstringsAdapter } from "../formats/xcstrings/adapter.js";
import { type Config, loadConfig, type TargetConfig, targetId } from "./config.js";
import { loadContext, type ProjectContext } from "./context.js";
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
  context: ProjectContext;
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
    context: await loadContext(fs, path.resolve(root, config.context)),
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

/** Opens the same project again, to see what's on disk after a write. */
export function reopenProject(project: Project): Promise<Project> {
  return openProject(project.fs, { cwd: project.root, config: project.configFile });
}

/** Reload under the lock so an earlier snapshot cannot overwrite another writer's work. */
export async function withProjectWrite<T>(
  project: Project,
  dryRun: boolean | undefined,
  run: (fresh: Project) => Promise<T>,
): Promise<T> {
  if (dryRun) return run(project);
  return project.fs.withLock(path.join(project.root, ".localship", "write.lock"), async () => {
    const fresh = await reopenProject(project);
    const result = await run(fresh);
    project.lock = fresh.lock;
    return result;
  });
}

/** The loaded target with this id. */
export function findTarget(project: Project, id: string): Target | undefined {
  return project.targets.find((t) => t.target.id === id)?.target;
}

/** Locales to work on: the configured ones, or every locale found on disk if none are configured. */
export function projectLocales(project: Project): string[] {
  if (project.config.locales.length > 0) return project.config.locales;
  const found = new Set<string>();
  for (const { target } of project.targets) for (const l of target.locales.keys()) found.add(l);
  return [...found].sort();
}
