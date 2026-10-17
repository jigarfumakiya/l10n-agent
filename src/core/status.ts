import { hashMessage } from "./hash.js";
import { getLockEntry, type LockEntry } from "./lock.js";
import type { Entry } from "./model.js";
import { type Project, projectLocales } from "./project.js";

/**
 * - missing: no translation
 * - untracked: a translation exists that the tool never recorded (e.g. written by hand before adoption)
 * - stale: the source changed since the translation was made
 * - edited: the translation was changed outside the tool; it is kept and never overwritten
 */
export const ENTRY_STATES = [
  "missing",
  "untracked",
  "stale",
  "edited",
  "draft",
  "reviewed",
  "approved",
] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

export function entryState(
  source: Entry,
  target: Entry | undefined,
  lock: LockEntry | undefined,
): EntryState {
  if (!target) return "missing";
  // A translation the format itself marks unreviewed (gettext fuzzy) is a draft.
  if (!lock) return target.needsReview ? "draft" : "untracked";
  if (lock.source !== hashMessage(source.message)) return "stale";
  if (lock.target !== hashMessage(target.message)) return "edited";
  // An editor can reopen review without changing the text (fuzzy / needs_review).
  if (target.needsReview && lock.state === "approved") return "draft";
  return lock.state;
}

/**
 * The translation on disk differs from what the tool last wrote: a person changed it. Checked
 * separately from staleness, since a source change and a hand edit can happen together, and the
 * edit must still be protected.
 */
export function editedByHand(target: Entry | undefined, lock: LockEntry | undefined): boolean {
  return !!target && !!lock && lock.target !== hashMessage(target.message);
}

export interface LocaleStatus {
  target: string;
  locale: string;
  total: number;
  counts: Record<EntryState, number>;
  entries: Array<{ key: string; state: EntryState }>;
}

export function computeStatus(project: Project, locales = projectLocales(project)): LocaleStatus[] {
  const out: LocaleStatus[] = [];
  for (const { target: loaded } of project.targets) {
    const sources = [...loaded.source.entries.values()].filter((e) => e.translatable);
    for (const locale of locales) {
      const catalog = loaded.locales.get(locale);
      const counts = Object.fromEntries(ENTRY_STATES.map((s) => [s, 0])) as Record<
        EntryState,
        number
      >;
      const entries = sources.map((src) => {
        const state = entryState(
          src,
          catalog?.entries.get(src.key),
          getLockEntry(project.lock, loaded.id, locale, src.key),
        );
        counts[state]++;
        return { key: src.key, state };
      });
      out.push({ target: loaded.id, locale, total: sources.length, counts, entries });
    }
  }
  return out;
}

export interface StatusNote {
  target: string;
  locale?: string;
  severity: "error" | "warning";
  code: string;
  message: string;
}

/**
 * Problems the counts above don't show: errors found while reading the files (a duplicate key
 * counts as one string, so the table looks fine) and translations of strings that were deleted.
 * Details are in `validate`; `prune` removes the leftovers.
 */
export function statusNotes(project: Project, locales = projectLocales(project)): StatusNote[] {
  const notes: StatusNote[] = [];
  for (const { target: loaded } of project.targets) {
    for (const issue of loaded.issues) {
      if (!issue.blocksCompleteness || issue.severity === "error") continue;
      notes.push({
        target: loaded.id,
        severity: "warning",
        code: issue.code,
        message: `${issue.file ? `${issue.file}: ` : ""}${issue.message}`,
      });
    }
    const errors = loaded.issues.filter((i) => i.severity === "error");
    const byCode = new Map<string, number>();
    for (const e of errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
    for (const [code, n] of byCode) {
      const what =
        code === "duplicate-key"
          ? `key${n === 1 ? " is" : "s are"} defined twice`
          : `file error${n === 1 ? "" : "s"} (${code})`;
      notes.push({
        target: loaded.id,
        severity: "error",
        code,
        message: `${n} ${what}; run \`localship validate\` for where`,
      });
    }
    for (const locale of locales) {
      const catalog = loaded.locales.get(locale);
      if (!catalog) continue;
      const orphans = [...catalog.entries.keys()].filter((k) => !loaded.source.entries.has(k));
      if (orphans.length === 0) continue;
      notes.push({
        target: loaded.id,
        locale,
        severity: "warning",
        code: "orphan",
        message: `${orphans.length} translation${orphans.length === 1 ? "" : "s"} without a matching source; restore missing defaults or, after confirming the keys are unused, remove them with \`localship prune\``,
      });
    }
  }
  return notes;
}
