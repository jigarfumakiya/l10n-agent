import type { Batch, BatchItem, MessageValue } from "../core/workflow.js";

/** The rules every translator gets, whether it's `localship translate` or an agent using the CLI or MCP. */
export const TRANSLATION_RULES = `- Translate the source text of each item into the item's locale. Write what a native speaker would put in a well-made app: natural, concise UI language, not a word-for-word copy.
- Follow the brief and the locale's voice (defaultVoice when the project has set none: the usual convention for that language). Work out where each text appears and what it does from its comment, context, and usage: the code that shows it, whose file path names the screen and whose code shows whether it is a button, title, label, hint or message.
- Keep every placeholder exactly as written (%s, %1$s, %d, %@, {name}, %(count)d…). You may move them to fit the grammar; numbered ones (%1$s) may be reordered freely.
- Keep markup and escapes exactly: tags such as <b> or <xliff:g>, entities, \\n, and any leading or trailing spaces and newlines.
- Glossary: a term marked keep stays exactly as written; a term with use must be translated that way.
- memory shows how the same text was already translated elsewhere in this project. Reuse it unless the context differs.
- Plurals: return an object with exactly the forms in pluralForms (no more, no fewer). examples lists the counts that select each form; write each form so it is grammatical for those counts. A form whose only example is one number may spell it out instead of using the placeholder.
- String arrays: return an array with the same number of items, in order.
- stale items have a current translation made for an older source text, shown as previousSource when known: see what changed between previousSource and source, and change the translation only that much.
- editedByHand means a person changed the current translation after it was made. Keep their wording wherever the source change allows.
- rejected shows your previous answer for that item and why it was refused. Fix exactly those problems.
- Keep length close to the source where you can; buttons and tabs have little room.`;

export const RESPONSE_FORMAT = `Reply with JSON only, no prose and no code fence:
{"translations": [{"target": "<target>", "locale": "<locale>", "key": "<key>", "value": <string | {"<form>": string} | [string]>}]}
Return one entry for every item.`;

export function systemPrompt(): string {
  return `You are a professional software localizer translating an app's user interface.

${TRANSLATION_RULES}

${RESPONSE_FORMAT}`;
}

export interface RetryInfo {
  value?: MessageValue;
  errors: string[];
}

/** The batch as the model sees it: context first, then the items. */
export function userPrompt(batch: Batch, retries?: Map<BatchItem, RetryInfo>): string {
  const items = batch.items.map((item) => {
    const retry = retries?.get(item);
    return retry ? { ...item, rejected: retry } : item;
  });
  const context = {
    ...(batch.brief ? { brief: batch.brief } : {}),
    locales: batch.locales,
    formats: batch.formats,
  };
  return `Project context:
${JSON.stringify(context, null, 2)}

Items to translate:
${JSON.stringify(items, null, 2)}`;
}

/** Finds the JSON object in a model's reply, tolerating code fences and stray prose. */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const body = (fenced?.[1] ?? reply).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (start < 0 || end <= start) throw new Error("The reply has no JSON in it");
    return JSON.parse(body.slice(start, end + 1));
  }
}
