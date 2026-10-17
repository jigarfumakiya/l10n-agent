---
name: localship-translate
description: Translate an app's missing or changed strings with Localship — fetch batches with context, translate them, submit them for checks, and fix what's rejected until nothing is left. Use when the user asks to translate, localize, add a language, or update translations after copy changes.
---

# Translate with Localship

The tool picks the strings, gives you the context, checks every translation in code
(placeholders, plural forms, escaping, markup, glossary) and writes the good ones as drafts.
You translate. Don't edit translation files by hand.

> For a direct request ("translate this app to Hindi"), start with the `localship` skill: it
> plans once, asks for one confirmation, and then uses this playbook without more questions.

## Running the tool

- If `localship_*` MCP tools are available, use them: `localship_next_batch`, `localship_submit`, …
- Otherwise run the CLI: `localship <command>`. If it isn't installed, ask to install it once with
  `npm install -g localship`.
- No `.localship/config.yaml`? Run the `localship-setup` skill first.
- A language that isn't configured yet: `localship add-locale <code>` first.
- Check `git status` first and mention uncommitted changes, so the translation diff stays reviewable.

## 1. Size up the work

Run `localship status`. Count `missing` + `stale` across the locales to translate.
Read the status notes too. Unsupported Apple variations and Android configurations are excluded
from the counts; report them as uncovered work and preserve their structure. Zero remaining
batch entries does not mean those strings have been translated or validated.

- **Up to a few hundred strings:** translate them yourself (step 2).
- **More than that**, or the user wants it done without you: delegate to a model API with
  `localship translate --model <provider:model>` (or `models:` in the config). Providers:
  `anthropic`, `openai`, `gemini`, `openrouter` (keys from `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`), and local `ollama`, `lmstudio`.
  It runs the same checks and retries rejected strings. Then review what it reports as failed
  and translate those yourself.

Read `.localship/brief.md`, `.localship/voice/` and `.localship/glossary.yaml` once if they exist. If
there's no brief, write a short one first (see `localship-setup`): translations without context
come out generic.

## 2. The loop

1. `localship next-batch --locale <locale>` (one locale at a time works best). Each item has:
   - `source` — the text, or plural forms, or array items, in the file's own syntax;
   - `comment`, `context`, and `usage` — the code that shows the string: the file path names the
     screen, the code shows whether it's a button, title, label or message;
   - `pluralForms` — exactly which forms this language needs, with sample counts;
   - `placeholders`, `glossary` (`keep` = leave as written, `use` = required translation),
     `memory` (how the same text was translated elsewhere in the project);
   - `state: stale` with `current` (the old translation) and `previousSource` (the text it was
     translated from) — change the translation only as much as the source changed;
   - `editedByHand: true` — a person edited the current translation. Keep their wording where you
     can, and show the user your proposed change: `submit` refuses it until they agree (then pass
     `--force` for just those strings).
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
   - Keep it about as long as the source. Items with a `role` of button, tab, chip or menu item
     have little room: prefer the shortest natural wording.
   - When the source could mean two things ("Open" as a button or a status, "Balance" as money
     or equilibrium) and the context doesn't settle it, add a short `note` saying how you read
     it. Reviewers see it. Skip notes when the meaning is clear.
   - Same source text, different meaning ("Delete account" for a sign-in account and for a
     budget): translate each for its meaning and add a `note` saying how they differ, so the
     consistency check doesn't flag it.
   - Android values: write plain text; apostrophes, quotes and `&` are escaped for you.

3. Submit, using a file for anything non-trivial:
   ```sh
   localship submit translations.json --model <your model name>
   ```
   ```json
   {"translations": [
     {"target": "android", "locale": "hi", "key": "save", "value": "सहेजें"},
     {"target": "android", "locale": "hi", "key": "days_left", "value": {"one": "%d दिन बाकी", "other": "%d दिन बाकी"}}
   ]}
   ```
   Copy `target`, `locale` and `key` from the batch items. Add `"note"` to an entry only for an
   ambiguous source, or one worded differently on purpose. Delete the file afterwards.

4. Read the result. Rejected entries list their errors: fix exactly those and resubmit only
   them. Accepted entries may have warnings (glossary, untranslated, whitespace): fix the
   ones that are real by resubmitting; drafts can be replaced freely.

5. Repeat from 1 until `remaining` is 0 for every locale.

## 3. Finish

- Run `localship validate`. It must have no errors.
- Resolve or explicitly report coverage warnings. `validate --strict` checks completeness;
  after review and approval, `validate --require-approved` also enforces approval. Unsupported
  content blocks both checks; use the platform tools for that content and report the limitation.
- Run `localship status` and report per locale: how many drafts were written, anything that
  failed, warnings you left and why, and terms you were unsure of.
- **Don't approve your own drafts.** Suggest the user reviews them (the `localship-review` skill),
  then `localship approve`.
- For a right-to-left language (Arabic, Hebrew, Persian, Urdu), or any first translation, tell the
  user what still needs a device: the layout mirrored, long text cut off, plurals at 0, 1, 2, 5
  and 11, switching language while the app is open, charts, amounts with a sign, and names
  stored in data. Offer to look for these in the code (the `localship-extract` skill lists
  them); Localship's checks only cover the translation files.
- Never pass `--force` unless the user explicitly asks: it replaces translations a person
  wrote, reviewed or approved.

Commit nothing unless the user asks.
