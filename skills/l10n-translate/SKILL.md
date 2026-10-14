---
name: l10n-translate
description: Translate an app's missing or changed strings with l10n-agent — fetch batches with context, translate them, submit them for checks, and fix what's rejected until nothing is left. Use when the user asks to translate, localize, add a language, or update translations after copy changes.
---

# Translate with l10n-agent

The tool picks the strings, gives you the context, checks every translation in code
(placeholders, plural forms, escaping, markup, glossary) and writes the good ones as drafts.
You translate. Don't edit translation files by hand.

## Running the tool

- If `l10n_*` MCP tools are available, use them: `l10n_next_batch`, `l10n_submit`, …
- Otherwise run the CLI: `l10n <command>`, or `npx -y github:jigarfumakiya/l10n-agent <command>`
  if `l10n` isn't installed.
- No `l10n.config.yaml`? Run the `l10n-setup` skill first.

## 1. Size up the work

Run `l10n status`. Count `missing` + `stale` across the locales to translate.

- **Up to a few hundred strings:** translate them yourself (step 2).
- **More than that**, or the user wants it done without you: delegate to a model API with
  `l10n translate --model <provider:model>` (or `models:` in the config). Providers:
  `anthropic`, `openai`, `gemini`, `openrouter` (keys from `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`), and local `ollama`, `lmstudio`.
  It runs the same checks and retries rejected strings. Then review what it reports as failed
  and translate those yourself.

Read `.l10n/brief.md`, `.l10n/voice/` and `.l10n/glossary.yaml` once if they exist. If
there's no brief, write a short one first (see `l10n-setup`): translations without context
come out generic.

## 2. The loop

1. `l10n next-batch --locale <locale>` (one locale at a time works best). Each item has:
   - `source` — the text, or plural forms, or array items, in the file's own syntax;
   - `comment`, `context`, `references` — where and how it's used;
   - `pluralForms` — exactly which forms this language needs, with sample counts;
   - `placeholders`, `glossary` (`keep` = leave as written, `use` = required translation),
     `memory` (how the same text was translated elsewhere in the project);
   - `state: stale` with `current` — update the old translation to the new source.
   The batch also carries the `brief`, each locale's `voice`, and notes per format.

2. Translate every item following these rules:
   - Natural, concise UI language a native speaker would write, in the brief's tone and the
     locale's voice. Not word for word.
   - Keep placeholders exactly (`%s`, `%1$s`, `%d`, `%@`, `{name}`, `%(count)d`); move them
     to fit the grammar. Keep tags (`<b>`, `<xliff:g>`), entities, `\n`, and leading or
     trailing spaces and newlines.
   - Plurals: an object with exactly the forms in `pluralForms`. Write each form so it is
     grammatical for its sample counts (Arabic needs six, Russian three, Hindi two, Japanese
     one).
   - Arrays: same number of items, same order.
   - Reuse `memory` unless the context differs. Follow the glossary.
   - Keep it about as long as the source; buttons and tabs have little room.
   - Android values: write plain text; apostrophes, quotes and `&` are escaped for you.

3. Submit, using a file for anything non-trivial:
   ```sh
   l10n submit translations.json --model <your model name>
   ```
   ```json
   {"translations": [
     {"target": "android", "locale": "hi", "key": "save", "value": "सहेजें"},
     {"target": "android", "locale": "hi", "key": "days_left", "value": {"one": "%d दिन बाकी", "other": "%d दिन बाकी"}}
   ]}
   ```
   Copy `target`, `locale` and `key` from the batch items. Delete the file afterwards.

4. Read the result. Rejected entries list their errors: fix exactly those and resubmit only
   them. Accepted entries may have warnings (glossary, untranslated, whitespace): fix the
   ones that are real by resubmitting; drafts can be replaced freely.

5. Repeat from 1 until `remaining` is 0 for every locale.

## 3. Finish

- Run `l10n validate`. It must have no errors.
- Run `l10n status` and report per locale: how many drafts were written, anything that
  failed, warnings you left and why, and terms you were unsure of.
- **Don't approve your own drafts.** Suggest the user reviews them (the `l10n-review` skill),
  then `l10n approve`.
- Never pass `--force` unless the user explicitly asks: it replaces translations a person
  wrote, reviewed or approved.

Commit nothing unless the user asks.
