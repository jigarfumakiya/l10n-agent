/** CLDR plural categories, in CLDR order. */
export const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

/**
 * A localizable message. Values are kept in the format's native raw form (for Android,
 * the inner XML of the element, escapes included) so writing never changes what we didn't touch.
 */
export type Message =
  | { kind: "text"; value: string }
  | { kind: "plural"; forms: Partial<Record<PluralCategory, string>> }
  | { kind: "array"; items: string[] };

export interface Entry {
  key: string;
  message: Message;
  /** Developer comment for translators (e.g. the XML comment right above the element). */
  comment?: string;
  translatable: boolean;
  /** Path of the file the entry lives in, relative to the project root. */
  file: string;
  line: number;
  /** Format-specific attributes that must survive a round trip (e.g. Android `formatted`). */
  attrs?: Record<string, string>;
}

export interface Catalog {
  locale: string;
  /** Insertion order is file order, which writers preserve. */
  entries: Map<string, Entry>;
}

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  /** Stable, machine-readable code, e.g. `placeholder-missing`. */
  code: string;
  message: string;
  target?: string;
  locale?: string;
  key?: string;
  /** Plural category or array index the issue is about. */
  form?: string;
  file?: string;
  line?: number;
}

export interface Placeholder {
  /** 1-based argument index. Non-positional placeholders are numbered in order. */
  index: number;
  /** Conversion, normalized to lower case (`s`, `d`, `f`, …). */
  type: string;
  raw: string;
  positional: boolean;
}

/** A single value as the format sees it, ready for checks. */
export interface ValueAnalysis {
  /** What the user sees: escapes and markup resolved. */
  text: string;
  placeholders: Placeholder[];
  /** Markup tags inside the value, e.g. `b`, `xliff:g`. */
  tags: string[];
  /** Problems with the value on its own, independent of the source. */
  lints: Array<Pick<Issue, "severity" | "code" | "message">>;
}

export function messageValues(message: Message): Array<[form: string, value: string]> {
  switch (message.kind) {
    case "text":
      return [["", message.value]];
    case "plural":
      return PLURAL_CATEGORIES.flatMap((c) => {
        const v = message.forms[c];
        return v === undefined ? [] : [[c, v] as [string, string]];
      });
    case "array":
      return message.items.map((v, i) => [String(i), v]);
  }
}
