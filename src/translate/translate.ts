import { UserError } from "../core/errors.js";
import { type Project, projectLocales, reopenProject } from "../core/project.js";
import type { EntryState } from "../core/status.js";
import { buildUsageIndex } from "../core/usage.js";
import {
  type Batch,
  type BatchItem,
  itemId,
  nextBatch,
  SubmissionSchema,
  submit,
} from "../core/workflow.js";
import { extractJson, type RetryInfo, systemPrompt, userPrompt } from "./prompt.js";
import { type Complete, createCompletion, ProviderError } from "./providers.js";

export interface TranslateOptions {
  locales?: string[];
  targets?: string[];
  keys?: string[];
  states?: EntryState[];
  /** `provider:model` for every locale, overriding the config's `models`. */
  model?: string;
  /** Entries per model call. */
  batchSize?: number;
  /** Model calls in flight at once. */
  concurrency?: number;
  /** Replace hand edits and reviewed or approved translations (with states that include them). */
  force?: boolean;
  /** Tries per entry before giving up on it. */
  attempts?: number;
  /** Builds the model client; tests pass a fake. */
  completion?: (model: string) => Complete;
  log?: (line: string) => void;
}

export interface TranslateResult {
  translated: number;
  failed: Array<{ target: string; locale: string; key: string; errors: string[] }>;
  files: string[];
  models: Record<string, string>;
}

/** The configured model for a locale: the locale, then its language, then `default`. */
export function modelFor(project: Project, locale: string, override?: string): string {
  if (override) return override;
  const models = project.config.models ?? {};
  const model = models[locale] ?? models[locale.split("-")[0] as string] ?? models.default;
  if (!model) {
    throw new UserError(
      "No model to translate with. Pass --model provider:model (e.g. anthropic:claude-sonnet-5-5), or set models.default in localship.yaml.",
    );
  }
  return model;
}

/**
 * Delegated translation: the same next-batch → submit loop an agent runs, driven against a
 * model API. Rejected entries go back once with their errors; model calls run in parallel,
 * writes one at a time.
 */
export async function translateProject(
  start: Project,
  opts: TranslateOptions = {},
): Promise<TranslateResult> {
  const log = opts.log ?? (() => {});
  const locales = opts.locales ?? projectLocales(start);
  if (locales.length === 0)
    throw new UserError("No locales to translate. Add `locales:` to the config.");
  const batchSize = opts.batchSize ?? 30;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const maxAttempts = Math.max(1, opts.attempts ?? 2);
  const makeCompletion =
    opts.completion ??
    ((model: string) => createCompletion(model, { custom: start.config.providers }));

  const models = Object.fromEntries(locales.map((l) => [l, modelFor(start, l, opts.model)]));
  const clients = new Map<string, Complete>();
  const client = (model: string) => {
    let c = clients.get(model);
    if (!c) {
      c = makeCompletion(model);
      clients.set(model, c);
    }
    return c;
  };
  for (const m of new Set(Object.values(models))) client(m);

  const result: TranslateResult = { translated: 0, failed: [], files: [], models };
  const files = new Set<string>();
  const tries = new Map<string, RetryInfo & { count: number; item: BatchItem }>();
  const givenUp = new Set<string>();
  let project = start;
  // Code doesn't change during a run; index it once.
  const usages = await buildUsageIndex(start);

  for (;;) {
    // Plan a round: up to `concurrency` batches, never two holding the same entry.
    const round: Batch[] = [];
    for (const locale of locales) {
      let offset = 0;
      while (round.length < concurrency) {
        const batch = await nextBatch(project, {
          locales: [locale],
          targets: opts.targets,
          keys: opts.keys,
          states: opts.states,
          limit: batchSize,
          offset,
          skip: givenUp,
          usages,
        });
        if (batch.items.length === 0) break;
        round.push(batch);
        offset += batch.items.length;
      }
      if (round.length >= concurrency) break;
    }
    if (round.length === 0) break;

    const replies = await Promise.all(
      round.map(async (batch) => {
        const locale = batch.items[0]?.locale as string;
        const model = models[locale] as string;
        const retries = new Map<BatchItem, RetryInfo>();
        for (const item of batch.items) {
          const t = tries.get(itemId(item));
          if (t)
            retries.set(item, {
              ...(t.value !== undefined ? { value: t.value } : {}),
              errors: t.errors,
            });
        }
        log(`${locale}: translating ${batch.items.length} strings with ${model}…`);
        try {
          const reply = await callWithRetry(() =>
            client(model)({ system: systemPrompt(), user: userPrompt(batch, retries) }),
          );
          return { batch, model, reply };
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          return { batch, model, error: e.message };
        }
      }),
    );

    for (const { batch, model, reply, error } of replies) {
      const byId = new Map(batch.items.map((i) => [itemId(i), i]));
      const fail = (item: BatchItem, errors: string[], value?: BatchItem["source"]) => {
        const id = itemId(item);
        const count = (tries.get(id)?.count ?? 0) + 1;
        tries.set(id, { count, errors, item, ...(value !== undefined ? { value } : {}) });
        if (count >= maxAttempts) givenUp.add(id);
      };
      if (error !== undefined) {
        // An unreachable provider fails every round the same way; stop instead of spinning.
        throw new UserError(error);
      }
      let parsed: Array<{
        target?: string;
        locale: string;
        key: string;
        value: BatchItem["source"];
      }>;
      try {
        const data = extractJson(reply ?? "");
        const list = Array.isArray(data) ? data : (data as { translations?: unknown }).translations;
        parsed = (Array.isArray(list) ? list : []).flatMap((x) => {
          const ok = SubmissionSchema.safeParse(x);
          return ok.success ? [ok.data] : [];
        });
      } catch (e) {
        for (const item of batch.items)
          fail(item, [`The reply was not valid JSON: ${(e as Error).message}`]);
        log(`${batch.items[0]?.locale}: the model's reply was not valid JSON`);
        continue;
      }

      // Only accept answers for items that were asked, and fill in a missing target.
      const answers = parsed.flatMap((p) => {
        const item =
          byId.get(itemId({ target: p.target ?? "", locale: p.locale, key: p.key })) ??
          batch.items.find((i) => i.locale === p.locale && i.key === p.key);
        return item ? [{ item, sub: { ...p, target: item.target } }] : [];
      });
      const answered = new Set(answers.map((a) => itemId(a.item)));
      for (const item of batch.items) {
        if (!answered.has(itemId(item))) fail(item, ["No translation was returned for this item"]);
      }

      project = await reopenProject(project);
      const r = await submit(
        project,
        answers.map((a) => a.sub),
        { model, force: opts.force },
      );
      for (const f of r.files) files.add(f);
      result.translated += r.accepted.length;
      const accepted = new Set(r.accepted.map((a) => itemId(a)));
      for (const id of accepted) tries.delete(id);
      for (const { item, sub } of answers) {
        const id = itemId(item);
        if (accepted.has(id)) continue;
        const rejection = r.rejected.find((x) => itemId({ ...x, target: x.target ?? "" }) === id);
        fail(item, rejection?.errors.map((e) => e.message) ?? ["Not written"], sub.value);
      }
      log(
        `${batch.items[0]?.locale}: ${r.accepted.length} written${r.rejected.length ? `, ${r.rejected.length} rejected` : ""}`,
      );
    }
    project = await reopenProject(project);
  }

  for (const id of givenUp) {
    const t = tries.get(id);
    if (t)
      result.failed.push({
        target: t.item.target,
        locale: t.item.locale,
        key: t.item.key,
        errors: t.errors,
      });
  }
  result.files = [...files].sort();
  return result;
}

async function callWithRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.transient || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}
