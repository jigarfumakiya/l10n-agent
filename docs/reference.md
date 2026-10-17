# Localship reference

Everything the tool does, in detail. For getting started, see the [README](../README.md).

- [Commands](#commands)
- [MCP tools](#mcp-tools)
- [Translation workflow](#translation-workflow)
- [Context files](#context-files)
- [Configuration](#configuration)
- [Detection](#detection)
- [Status states](#status-states)
- [Formats](#formats)
- [Checks](#checks)

## Commands

| Command | What it does |
|---|---|
| `localship plan [languages…]` | One plan for a request: what it found, blockers and their fix, strings to translate, defaults (voice per language, names kept), steps. Writes nothing. Languages can be names (`hindi`) or codes |
| `localship start <languages…>` | Does the setup in one go: config (or adds the languages), default voice notes and glossary, never overwriting yours. With `--model` (or `models.default` in the config) it translates right away |
| `localship detect` | Lists the translation files in the repo, with evidence and confidence. Writes nothing |
| `localship init` | Detects, asks, and writes `.localship/config.yaml` |
| `localship status` | Progress per target and locale, plus duplicate keys and translations of deleted strings |
| `localship add-locale fr,de` | Adds languages to `locales:` in the config, keeping its comments |
| `localship validate` | Runs every check. Exit code 1 if there are errors |
| `localship next-batch` | The next strings needing translation, with context, as JSON |
| `localship submit [file]` | Checks translations (JSON from a file or stdin) and writes the good ones as drafts. Exit code 1 if any are rejected |
| `localship translate` | Translates with a model API, through the same checks |
| `localship approve` | Marks drafts approved (or `--reviewed`) |
| `localship remove` | Makes translations untranslated again (`--keys`, `--states draft`), e.g. to reject bad drafts. A person's work needs `--force` |
| `localship prune` | Removes translations of strings that were deleted, renamed or marked not translatable, and their lockfile records |
| `localship mcp` | Runs the MCP server over stdio |

Options:

| Option | Applies to | Meaning |
|---|---|---|
| `--json` | most | Machine-readable output for agents and scripts |
| `-l, --locale hi,ar` | `status`, `validate`, `next-batch`, `translate`, `approve` | Only these locales |
| `-t, --target <ids>`, `-k, --keys <keys>` | `next-batch`, `translate`, `approve` | Only these targets or keys |
| `--states missing,stale` | `next-batch`, `translate` | Which entries to work on (default `missing,stale`) |
| `-n, --limit`, `--offset` | `next-batch` | Batch size (default 40) and paging |
| `-m, --model <provider:model>` | `submit`, `translate` | Model to record, or to translate with |
| `-n, --batch-size`, `-p, --parallel` | `translate` | Strings per call (30) and calls at once (4) |
| `--from draft,reviewed` | `approve` | Which entries to approve. Add `untracked` or `edited` to adopt or accept |
| `--force` | `submit`, `translate`, `init` | Replace hand edits and reviewed or approved translations; for `init`, replace the config |
| `--dry-run` | `submit`, `approve` | Check without writing |
| `--strict` | `validate` | Untranslated strings and missing locales count as errors |
| `-y, --yes`, `--accept 1,2` | `init` | Accept the detected setups, or only these |
| `--source en`, `-l, --locales hi,ar` | `init` | Source language and languages to translate into |
| `-c, --config <file>` | all | Config file (default: the nearest `.localship/config.yaml`) |
| `-C, --cwd <dir>` | all | Directory to run in |

## MCP tools

`localship_plan`, `localship_start`, `localship_status`, `localship_validate`, `localship_detect`, `localship_init`, `localship_add_locales`, `localship_get_context`,
`localship_update_context`, `localship_next_batch`, `localship_submit`, `localship_approve`, `localship_remove`, `localship_prune`,
`localship_translate`.
The skills are also served as MCP prompts (`localship`, `localship-setup`, `localship-extract`, `localship-translate`, `localship-review`) for
clients that don't read skills. Every tool takes an optional `cwd`. Without one, the server works in the project Claude Code
names in `CLAUDE_PROJECT_DIR`, else the directory it was started in (or `-C <dir>`).

## Translation workflow

Every translation, from any source, goes through the same loop:

```
next-batch → translate → submit (checked; good ones written as drafts) → review → approve
```

**With your coding agent.** The `localship-translate` skill (or the `localship_next_batch` and
`localship_submit` MCP tools) has the agent's own model do the translating. Each batch item comes
with what a translator needs:

```json
{
  "target": "android", "locale": "ar", "key": "trash_deleted", "state": "missing",
  "kind": "plural",
  "source": { "one": "Moved %d note to the trash", "other": "Moved %d notes to the trash" },
  "pluralForms": [{ "form": "zero", "examples": "0" }, { "form": "one", "examples": "1" },
                  { "form": "two", "examples": "2" }, { "form": "few", "examples": "3, 4, 5, 6, 7…" },
                  { "form": "many", "examples": "11, 12, 13, 14, 15…" }, { "form": "other", "examples": "100, 101, 102, 200, 201…" }],
  "placeholders": ["%d"],
  "glossary": [{ "term": "trash", "use": "سلة المهملات" }],
  "memory": [{ "value": "…", "from": "ios:Trash" }]
}
```

Items also carry `usage`: up to three places in the code that show the string, with the file and
line and the code around it, so the model can tell a button from a title. It's found from
`R.string.*` and `@string/*` (Android), Swift string literals matched to catalog keys,
interpolations included (String Catalogs), and `#:` references (gettext). From that code an
item may also carry `role` (button, tab, chip, menu item, title, toast, notification,
placeholder, accessibility label), so the model keeps buttons and tabs short. A stale item also
carries `previousSource`, the text the old translation was made from, so only the change is
retranslated.

`submit` runs the same checks as `validate`. Translations with errors come back with the
reasons and are not written. The agent fixes those and resubmits. Accepted ones become drafts,
recorded in `.localship/lock.json` with the model that made them. An entry may add a short
`note` saying how the agent read an ambiguous source ("Open" as a button); it's kept with the
translation and shown when the drafts are reviewed. Android apostrophes, quotes and `&`
are escaped for you. A finished example, translated into Hindi and Arabic this way, is in
[examples/android-notes](../examples/android-notes).

**With a model API** (large catalogs, CI, or no agent):

```sh
export ANTHROPIC_API_KEY=…
localship translate --model anthropic:claude-sonnet-5-5
```

| Provider | Model spec | Key |
|---|---|---|
| Anthropic | `anthropic:<model>` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai:<model>` | `OPENAI_API_KEY` |
| Google Gemini | `gemini:<model>` | `GEMINI_API_KEY` |
| OpenRouter | `openrouter:<vendor/model>` | `OPENROUTER_API_KEY` |
| Ollama, LM Studio (local) | `ollama:<model>`, `lmstudio:<model>` | none |
| Anything OpenAI-compatible | `<name>:<model>`, with the name under `providers:` in the config | your choice |

Batches run in parallel (`-p`, default 4) and writes happen one at a time. A rejected string goes
back to the model once with its errors; strings that still fail are listed at the end.
Set models per locale in the config to route hard languages to a stronger model.

**Review and approve.** Drafts already ship in Android and gettext files (String Catalogs mark
them `needs_review`). Review them with the `localship-review` skill or by hand, then
`localship approve --locale hi`. To adopt translations made before Localship, run
`localship approve --from untracked`. To accept edits made by hand, use `--from edited`.

## Context files

Translations are only as good as the context. These live next to your config in `.localship/`, in git:

| File | What it holds |
|---|---|
| `brief.md` | What the app does, who it's for, the tone of its copy |
| `voice/all.md`, `voice/<locale>.md` | Voice rules for every locale, and per locale (formality, loanwords, numbers) |
| `glossary.yaml` | Names to keep as written, and terms with fixed translations |

```yaml
# .localship/glossary.yaml
terms:
  - term: Jotter
    translate: false          # brand: keep as written in every language
  - term: trash
    note: Where deleted notes go before they are removed for good
    translations: { hi: ट्रैश, ar: سلة المهملات }
```

The `localship-setup` skill drafts these from your README and strings. Glossary terms are matched as
whole words in the source. In translations, fixed terms are matched inside words too, since
Arabic and Hindi attach particles.

## Configuration

Everything Localship keeps in your repo is in one hidden folder at its root:

```
.localship/
  config.yaml     languages and translation files (below)
  brief.md        what the app is, who it's for, its tone
  voice/          <locale>.md: formality and style per language
  glossary.yaml   names to keep, and fixed translations of terms
  lock.json       what was translated from which source text, and its review state
```

Commit all of it: the lockfile is how teammates and CI know what's new, changed or edited by
hand. Paths in the config are relative to the repo root. A `localship.yaml` at the root (the
older location) is still read.

| Key | Default | Meaning |
|---|---|---|
| `sourceLocale` | `en` | Language the source strings are written in |
| `locales` | locales found on disk | Languages to work on (BCP 47: `hi`, `pt-BR`, `zh-Hans`) |
| `targets` | required | List of translation file sets, see below |
| `lock` | `.localship/lock.json` | Where translation state is recorded |
| `context` | `.localship` | Folder with `brief.md`, `voice/` and `glossary.yaml` |
| `models` | none | Models for `localship translate`: `default`, and per locale or language, e.g. `ar: anthropic:claude-opus-5-5` |
| `providers` | none | Extra OpenAI-compatible providers: `name: { baseUrl, apiKeyEnv }` |

Every target has a `format` and a `path`, plus an optional `id` (needed when two targets share a format).

| Format | `path` | Extra options |
|---|---|---|
| `android-xml` | The `res` directory | none |
| `po` | Pattern with `{locale}`, e.g. `po/{locale}.po` | `template` (a `.pot`), `placeholders` (syntax for entries with no format flag), `pluralForms` (per-locale `Plural-Forms` when a file has none) |
| `xcstrings` | The `.xcstrings` file | none |

## Detection

- **What it finds:** Android `res` folders with strings, groups of `.po` files sharing a path
  pattern (with their `.pot` template), and `.xcstrings` catalogs.
- **Real counts:** each candidate is loaded with the same reader `status` uses, so its string
  count and languages are real.
- **Confidence:** each candidate is `high`, `medium` (for example a build-variant folder, or a
  single `.po` file with no template) or `low`. Doubts are listed as questions.
- **Starting points:** a gettext `.pot` template with no translations yet is offered with the
  path new `.po` files will get, following the ecosystem's layout (Django `locale/{locale}/LC_MESSAGES/`,
  WordPress `languages/<domain>-{locale}.po`, otherwise `po/{locale}.po`). An empty String Catalog
  is offered with a reminder to build in Xcode first.
- **Unsupported formats:** files it recognizes but can't read yet (`.strings`, ARB, JSON, YAML,
  `.resx`, `.properties`, XLIFF) are listed, so nothing is ignored silently.
- **Hints:** an Xcode project without a String Catalog gets told how to add one.
- **In agents and CI:** without a terminal, `init` writes only with `--yes` or `--accept`. An
  agent can run `localship detect --json`, show the user the options, then run
  `localship init --accept 1 --locales hi,ar`.

## Status states

| State | Meaning |
|---|---|
| `missing` | No translation yet |
| `untracked` | A translation exists that Localship didn't record (written before you adopted it) |
| `stale` | The source text changed after the translation was made. If a person had also edited the translation, it is marked `editedByHand` in batches and is never replaced or removed without `--force`; `translate` holds it for review |
| `edited` | The translation was changed outside Localship; it is kept and never overwritten |
| `draft` | Not reviewed yet, including gettext `fuzzy` and Xcode `needs_review` |
| `reviewed`, `approved` | Checked by an AI reviewer or a person |

States come from the files plus `.localship/lock.json`, which records a hash of each source and
translation.

## Formats

| Format | Status |
|---|---|
| Android `res/values*/strings.xml` | ✅ Supported |
| gettext `.po` / `.pot` | ✅ Supported |
| Apple String Catalog `.xcstrings` | ✅ Supported (device variations and substitutions skipped for now) |
| JSON (flat, nested, i18next, ICU) | Planned |
| Flutter ARB | Planned |
| Apple `.strings` / `.stringsdict` | Planned |

### Android

- Strings, `plurals` and `string-array`. Skips `translatable="false"` strings and aliases (`@string/other`).
- Keeps `formatted`, `product` and `<xliff:g>` spans.
- Checks Android escaping: `\'`, `\"`, a leading `\@` or `\?`, and unknown escapes.
- Locale folders follow Android naming, including `values-b+sr+Latn` and the legacy `values-iw` and `values-in`.

### gettext PO

- **Strings:** reads `msgctxt` and plurals. Extracted comments (`#.`) and code references (`#:`) are kept as context for translators.
- **Placeholders** follow each entry's format flag: `c-format`, `python-format` (`%(name)s`),
  `python-brace-format` (`{name}`), `php-format`, `java-format`, `qt-format`, `ruby-format`.
  Flags are read from the source entry, so a translation file that lost its flags is still checked.
- **Plurals** use the file's `Plural-Forms` header. A small built-in parser evaluates the
  formula, so nothing in the file is ever executed. Each form is described by the counts that
  select it (Russian form 1 = 2, 3, 4, 22, 23…). The header itself is checked against the
  language's standard rule.
- **Writing:** untouched entries are written back byte for byte. Changed entries are wrapped
  exactly as `msgcat` does, measured in display columns so Devanagari and CJK wrap correctly.
  Files that use `--no-wrap` stay unwrapped. New locale files are created from the template with
  the right `Language` and `Plural-Forms`.

### Apple String Catalog

- Strings and plural variations, including Apple's optional `zero` form in any language. A
  translation may vary by plural even when the source doesn't, as Xcode allows.
- **States:** `needs_review` and `new` count as drafts. `shouldTranslate: false` and stale entries are skipped.
- **Placeholders:** `%@`, `%lld`, `%1$@`, `%#@name@`. `%d` and `%lld` count as the same kind of argument.
- **Writing:** untouched parts are written back byte for byte. Changed parts use the file's own
  style. For Xcode files that means 2-space indent, `" : "`, sorted keys, blank-line empty
  objects and no final newline, so Xcode reopens the file without a diff.

## Checks

Errors are things that break the build or the app at runtime. Warnings are things that read wrong.
`submit` refuses errors, and also asks for every plural form the language uses.

| Code | Severity | What |
|---|---|---|
| `placeholder-missing`, `placeholder-extra`, `placeholder-type` | error | Placeholders must match the source. In a plural form used for a single number (Arabic `two`), writing the number out instead is fine (`placeholder-implied`, info) |
| `plural-count-missing` | error | A plural form used for more than one count must show the number, even when the source's form of the same name doesn't. English `one` only means 1, but Hindi and French `one` also cover 0, so "last month" copied from English would show for zero months |
| `plural-missing-category` | error / warning | Every plural form the locale needs. Error for gettext and for a missing `other`. Warning when the app would fall back to `other`, or the form is only used for fractions |
| `plural-extra-category` | warning / error | A form the locale never uses (error for gettext, which rejects it) |
| `escape-apostrophe`, `escape-quote`, `escape-leading-reference`, `escape-invalid` | error | Android escaping |
| `xliff-mismatch` | error | `<xliff:g>` protected spans kept |
| `array-length`, `kind-mismatch`, `empty` | error | The translation has the same shape as the source |
| `xml-malformed`, `po-malformed`, `json-malformed`, `duplicate-key`, `name-missing` | error | File problems, with line numbers |
| `plural-forms-invalid`, `plural-forms-missing` | error | Broken or missing gettext `Plural-Forms` header |
| `target-missing` | error | A configured path doesn't exist |
| `placeholder-not-positional` | warning | A source with several unnumbered placeholders should number them so translators can reorder |
| `markup-mismatch`, `whitespace`, `untranslated`, `escape-unknown` | warning | Markup or edge whitespace changed, or text left in the source language (names the glossary keeps don't count) |
| `glossary-keep`, `glossary-term` | warning | A kept name was changed, or a fixed term wasn't used |
| `number-mismatch` | warning | A number in the source is missing from the translation. Digits in any script count ("१,३८५" is 1385); Arabic and Hebrew may write 1 and 2 as words |
| `punctuation-end` | warning | The source ends with `?`, `!`, `:` or `…` and the translation doesn't, in any script's form (`؟`, `？`) |
| `case-mismatch` | warning | An all-caps label isn't in capitals, in a script that has case. Names kept from the source don't count |
| `token-missing` | warning | A link, email address or emoji from the source is missing or changed |
| `inconsistent` | warning | The same source text is translated more than one way in a language, across all targets. Fine when the context differs; gettext contexts count as different, and a translation with a note is left out |
| `too-long` | warning | A button, tab, chip, menu item or app name translated more than twice as wide as the source (at least 6 characters more). The role comes from the code that uses the string; Chinese, Japanese and Korean characters count double |
| `orphan`, `not-translatable` | warning | Leftover translations to clean up |
| `plural-forms-unexpected`, `plural-forms-unknown`, `language-mismatch`, `source-language-mismatch` | warning | Header or config disagrees with the language or file |
| `missing`, `locale-missing`, `variation-unsupported` | info | Untranslated strings and skipped content (errors with `--strict`) |

Checks are tested on real data: AndroidX and RevenueCat resources (207 locale folders), Django
admin's PO files in 11 languages, and 9 real String Catalogs. On that data they found genuine
upstream bugs, including a Python placeholder in Django's Irish translation that `msgfmt --check` misses.
