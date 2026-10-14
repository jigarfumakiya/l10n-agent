import type { FileSystem } from "../core/fs.js";
import type { Catalog, Entry, Issue, PluralSpec, ValueAnalysis } from "../core/model.js";

export interface OpenContext {
  fs: FileSystem;
  /** Directory the config's paths are relative to. */
  root: string;
  sourceLocale: string;
  /** Target id from the config, unique within the project. */
  id: string;
}

/**
 * A target after loading: the source catalog, every locale found on disk, and the
 * format-specific operations checks and writers need.
 */
export interface Target {
  readonly id: string;
  readonly format: string;
  /** Human label, e.g. the resource directory or path pattern. */
  readonly label: string;
  readonly source: Catalog;
  readonly locales: Map<string, Catalog>;
  /** File-level problems: parse errors, duplicate keys, broken headers. */
  readonly issues: Issue[];
  /** Resolves a raw value so generic checks can compare source and translation. */
  analyze(value: string, entry: Entry): ValueAnalysis;
  /** Plural forms this locale needs in this format; undefined when it can't be known. */
  pluralSpec(locale: string): PluralSpec | undefined;
  /** Writes one locale. Entries absent from `catalog` are left as they are on disk. */
  writeLocale(catalog: Catalog): Promise<WriteResult>;
}

export interface WriteResult {
  files: string[];
}

export interface FormatAdapter<TConfig> {
  readonly format: string;
  open(config: TConfig, ctx: OpenContext): Promise<Target>;
}
