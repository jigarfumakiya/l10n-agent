import type { FileSystem } from "../core/fs.js";
import type { Catalog, Entry, Issue, ValueAnalysis } from "../core/model.js";

/** A target after loading: the source catalog and every locale found on disk. */
export interface LoadedTarget {
  id: string;
  format: string;
  /** Human label, e.g. the resource directory. */
  label: string;
  source: Catalog;
  locales: Map<string, Catalog>;
  /** File-level problems: parse errors, duplicate keys. */
  issues: Issue[];
}

export interface WriteResult {
  files: string[];
}

export interface FormatAdapter<TTarget = unknown> {
  readonly format: string;
  load(fs: FileSystem, root: string, target: TTarget, sourceLocale: string): Promise<LoadedTarget>;
  /** Resolves a raw value so generic checks can compare source and translation. */
  analyze(value: string, entry: Entry): ValueAnalysis;
  /** Writes one locale. Entries absent from `catalog` are left as they are on disk. */
  writeLocale(
    fs: FileSystem,
    root: string,
    target: TTarget,
    loaded: LoadedTarget,
    catalog: Catalog,
  ): Promise<WriteResult>;
}
