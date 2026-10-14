# l10n-agent

**Local-first, agent-native localization for apps.**
Your repo is the translation system. Your model is the translator.

l10n-agent reads the translation files your app already has (Android resources, gettext PO,
Apple String Catalogs), checks every translation against its source with strict rules, and
writes changes back without disturbing anything else in the file. It is built to be driven by
any AI coding agent or model, from the CLI, an MCP server, or CI.

> **Status: early development, usable today.** Setup, checks, translation (by your agent or a
> model API), review and approval work for Android, gettext PO and Apple String Catalogs, from
> the CLI, an MCP server or agent skills. See [Roadmap](#roadmap), [PLAN.md](PLAN.md) for the
> full plan, and [RESEARCH.md](RESEARCH.md) for how this compares to paid tools.

## Why

Paid localization platforms copy your strings into their cloud, charge per word or seat, and
only see an app description for context. l10n-agent takes a different approach:

- **Your files stay in git.** No server, no account, no upload.
- **Any model.** Your coding agent's own model, or any provider key in CI.
- **Strict checks in code, not in prompts.** Placeholders, plural forms and escaping are checked
  deterministically before anything is written, so mistakes are caught no matter which model
  translated.
- **Clean diffs.** Untouched content is written back byte for byte. Changed content follows the
  file's own formatting, matching what Android Studio, `msgcat` and Xcode produce.

## Install

Not on npm yet. Pick the way you work.

**Claude Code plugin** (skills and the MCP server in one step):

```
/plugin marketplace add jigarfumakiya/l10n-agent
/plugin install l10n-agent@l10n-agent
```

Then ask Claude to "set up localization" or "translate the app into Hindi and Arabic".

**Any MCP client** (Cursor, VS Code, Codex, Gemini CLI, Claude Desktop…): add this server.
The first start takes a minute while npm builds it; later starts are quick.

```json
{
  "mcpServers": {
    "l10n": { "command": "npx", "args": ["-y", "github:jigarfumakiya/l10n-agent", "mcp"] }
  }
}
```

<details>
<summary>Exact config per client</summary>

- **Claude Code** without the plugin: `claude mcp add l10n -- npx -y github:jigarfumakiya/l10n-agent mcp`
- **Cursor:** the JSON above in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`.
- **VS Code:** `.vscode/mcp.json` uses `servers` instead of `mcpServers`, with `"type": "stdio"`.
- **Gemini CLI:** the JSON above in `.gemini/settings.json`.
- **Codex:** in `~/.codex/config.toml`:
  ```toml
  [mcp_servers.l10n]
  command = "npx"
  args = ["-y", "github:jigarfumakiya/l10n-agent", "mcp"]
  ```
- **Claude Desktop** (no project folder of its own): point it at your app with
  `"args": ["-y", "github:jigarfumakiya/l10n-agent", "-C", "/path/to/your/app", "mcp"]`,
  or pass `cwd` in each tool call.

</details>

**Agent skills** for Claude Code, Codex, Cursor, Gemini CLI and others that read `SKILL.md`:

```sh
npx skills add jigarfumakiya/l10n-agent
```

The skills drive the CLI, so install it too:

**CLI** (Node 22 or newer, on macOS, Linux or Windows):

```sh
npm install -g github:jigarfumakiya/l10n-agent
```

Or from a clone: `git clone`, then `npm install` (which also builds) and `npm link`.

## Quick start

In your project:

```sh
l10n init        # finds your translation files and writes l10n.config.yaml
l10n status      # translation progress per locale
l10n validate    # every check; exits 1 on errors, so it can gate CI
```

`init` scans the repo, skipping build output, dependencies and anything in `.gitignore`. It shows
what it found and asks which setups to keep, the source language and the languages to translate
into. It never overwrites an existing config unless you pass `--force`.

```
$ l10n init
Found 2 localization setups in ~/my-app

  1.  Android resources  app/src/main/res                       312 strings  hi, ar  high
      app/src/main/res/values has 312 strings · translations in 2 locale folders
  2.  gettext PO         locale/{locale}/LC_MESSAGES/django.po  140 strings  de, fr  high
      2 .po files matching locale/{locale}/LC_MESSAGES/django.po · template locale/django.pot

Source language: en (assumed; the files don't say)

Add which setups? [1,2]
```

The config it writes looks like this, and you can also write it by hand:

```yaml
sourceLocale: en
locales: [hi, ar]

targets:
  - format: android-xml
    path: app/src/main/res

  - format: po
    path: locale/{locale}/LC_MESSAGES/django.po   # {locale} matches hi, pt_BR, sr@latin …
    template: locale/django.pot                    # optional

  - format: xcstrings
    path: App/Localizable.xcstrings                # one file holds every language
```

```
$ l10n status
xcstrings · App/Localizable.xcstrings · 4 source strings
  locale  done  missing  untracked  stale  edited  draft  reviewed  approved
  hi       75%        1          2      0       0      1         0         0
  ar       75%        1          3      0       0      0         0         0

$ l10n validate
✖ hi Hi %@, you have %lld new alerts placeholder-missing Missing %lld (argument 2) App/Localizable.xcstrings:90
✖ ar %lld days left plural-missing-category ar needs 6 plural forms (CLDR); missing other (n = 100, 101, 102, 200, 201…) App/Localizable.xcstrings:7
· 1 string uses device variations or substitutions, which aren't supported yet; skipped
· hi 1 string not translated yet
· ar 1 string not translated yet
2 errors, 0 warnings
```

## Translating

Every translation, from any source, goes through the same loop:

```
next-batch → translate → submit (checked; good ones written as drafts) → review → approve
```

**With your coding agent.** The `l10n-translate` skill (or the `l10n_next_batch` and
`l10n_submit` MCP tools) has the agent's own model do the translating. Each batch item comes
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

`submit` runs the same checks as `validate`. Translations with errors come back with the
reasons and are not written. The agent fixes those and resubmits. Accepted ones become drafts,
recorded in `.l10n/lock.json` with the model that made them. Android apostrophes, quotes and `&`
are escaped for you. A finished example, translated into Hindi and Arabic this way, is in
[examples/android-notes](examples/android-notes).

**With a model API** (large catalogs, CI, or no agent):

```sh
export ANTHROPIC_API_KEY=…
l10n translate --model anthropic:claude-sonnet-5-5
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
them `needs_review`). Review them with the `l10n-review` skill or by hand, then
`l10n approve --locale hi`. To adopt translations made before l10n-agent, run
`l10n approve --from untracked`. To accept edits made by hand, use `--from edited`.

### Context files

Translations are only as good as the context. These live next to your config in `.l10n/`, in git:

| File | What it holds |
|---|---|
| `brief.md` | What the app does, who it's for, the tone of its copy |
| `voice/all.md`, `voice/<locale>.md` | Voice rules for every locale, and per locale (formality, loanwords, numbers) |
| `glossary.yaml` | Names to keep as written, and terms with fixed translations |

```yaml
# .l10n/glossary.yaml
terms:
  - term: Jotter
    translate: false          # brand: keep as written in every language
  - term: trash
    note: Where deleted notes go before they are removed for good
    translations: { hi: ट्रैश, ar: سلة المهملات }
```

The `l10n-setup` skill drafts these from your README and strings. Glossary terms are matched as
whole words in the source. In translations, fixed terms are matched inside words too, since
Arabic and Hindi attach particles.

## Commands

| Command | What it does |
|---|---|
| `l10n detect` | Lists the translation files in the repo, with evidence and confidence. Writes nothing |
| `l10n init` | Detects, asks, and writes `l10n.config.yaml` |
| `l10n status` | Progress per target and locale |
| `l10n validate` | Runs every check. Exit code 1 if there are errors |
| `l10n next-batch` | The next strings needing translation, with context, as JSON |
| `l10n submit [file]` | Checks translations (JSON from a file or stdin) and writes the good ones as drafts. Exit code 1 if any are rejected |
| `l10n translate` | Translates with a model API, through the same checks |
| `l10n approve` | Marks drafts approved (or `--reviewed`) |
| `l10n mcp` | Runs the MCP server over stdio |

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
| `-c, --config <file>` | all | Config file (default: the nearest `l10n.config.yaml`) |
| `-C, --cwd <dir>` | all | Directory to run in |

### MCP tools

`l10n_status`, `l10n_validate`, `l10n_detect`, `l10n_init`, `l10n_get_context`,
`l10n_update_context`, `l10n_next_batch`, `l10n_submit`, `l10n_approve`, `l10n_translate`.
The skills are also served as MCP prompts (`l10n-setup`, `l10n-translate`, `l10n-review`) for
clients that don't read skills. Every tool takes an optional `cwd`.

### Detection

- **What it finds:** Android `res` folders with strings, groups of `.po` files sharing a path
  pattern (with their `.pot` template), and `.xcstrings` catalogs.
- **Real counts:** each candidate is loaded with the same reader `status` uses, so its string
  count and languages are real.
- **Confidence:** each candidate is `high`, `medium` (for example a build-variant folder, or a
  single `.po` file with no template) or `low`. Doubts are listed as questions.
- **Unsupported formats:** files it recognizes but can't read yet (`.strings`, ARB, JSON, YAML,
  `.resx`, `.properties`, XLIFF) are listed, so nothing is ignored silently.
- **Hints:** an Xcode project without a String Catalog gets told how to add one.
- **In agents and CI:** without a terminal, `init` writes only with `--yes` or `--accept`. An
  agent can run `l10n detect --json`, show the user the options, then run
  `l10n init --accept 1 --locales hi,ar`.

### Status columns

| State | Meaning |
|---|---|
| `missing` | No translation yet |
| `untracked` | A translation exists that l10n-agent didn't record (written before you adopted it) |
| `stale` | The source text changed after the translation was made |
| `edited` | The translation was changed outside l10n-agent; it is kept and never overwritten |
| `draft` | Not reviewed yet, including gettext `fuzzy` and Xcode `needs_review` |
| `reviewed`, `approved` | Checked by an AI reviewer or a person |

States come from the files plus `.l10n/lock.json`, which records a hash of each source and
translation.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `sourceLocale` | `en` | Language the source strings are written in |
| `locales` | locales found on disk | Languages to work on (BCP 47: `hi`, `pt-BR`, `zh-Hans`) |
| `targets` | required | List of translation file sets, see below |
| `lock` | `.l10n/lock.json` | Where translation state is recorded |
| `context` | `.l10n` | Folder with `brief.md`, `voice/` and `glossary.yaml` |
| `models` | none | Models for `l10n translate`: `default`, and per locale or language, e.g. `ar: anthropic:claude-opus-5-5` |
| `providers` | none | Extra OpenAI-compatible providers: `name: { baseUrl, apiKeyEnv }` |

Every target has a `format` and a `path`, plus an optional `id` (needed when two targets share a format).

| Format | `path` | Extra options |
|---|---|---|
| `android-xml` | The `res` directory | none |
| `po` | Pattern with `{locale}`, e.g. `po/{locale}.po` | `template` (a `.pot`), `placeholders` (syntax for entries with no format flag), `pluralForms` (per-locale `Plural-Forms` when a file has none) |
| `xcstrings` | The `.xcstrings` file | none |

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
| `orphan`, `not-translatable` | warning | Leftover translations to clean up |
| `plural-forms-unexpected`, `plural-forms-unknown`, `language-mismatch`, `source-language-mismatch` | warning | Header or config disagrees with the language or file |
| `missing`, `locale-missing`, `variation-unsupported` | info | Untranslated strings and skipped content (errors with `--strict`) |

Checks are tested on real data: AndroidX and RevenueCat resources (207 locale folders), Django
admin's PO files in 11 languages, and 9 real String Catalogs. On that data they found genuine
upstream bugs, including a Python placeholder in Django's Irish translation that `msgfmt --check` misses.

## Roadmap

1. **More formats:** JSON (i18next, ICU), Flutter ARB, String Catalog substitutions and device variations.
2. **Extraction:** find hardcoded text in Kotlin and Swift and move it into resources.
3. **Quality:** an AI reviewer with scores, a static review page for people, and visual checks
   for truncated or right-to-left layouts.
4. **CI:** a GitHub Action that validates pull requests and translates new strings.
5. **Release:** npm package, so `npx l10n-agent` works without GitHub.

The details are in [PLAN.md](PLAN.md).

## Development

```sh
npm install
npm run check   # typecheck + lint + tests
npm run build   # bundles dist/cli.js
npm run dev -- validate -C fixtures/po/django
```

Layout:

```
src/core/        config, project loading, checks, status, lockfile, context, the batch/submit/approve loop
src/formats/     one folder per format; each opens a Target (read, check, write)
src/detect/      repo walk, per-format detection, config building for `init`
src/translate/   prompts, model providers, the delegated translate loop
src/mcp/         the MCP server
src/cli/         the `l10n` command
skills/          agent skills: l10n-setup, l10n-translate, l10n-review
.claude-plugin/  Claude Code plugin and marketplace manifests
examples/        a sample app translated with the tool
fixtures/        sample projects with deliberate mistakes, one per format
test/            vitest suites
```

If GNU gettext is installed, the tests also compare PO output against `msgcat` and `msgfmt`.

## License

MIT
