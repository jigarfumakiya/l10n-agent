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
  return lock.state;
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
