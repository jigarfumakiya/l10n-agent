# l10n-agent

**Local-first, agent-native localization for apps.**
Your repo is the translation system. Your model is the translator.

l10n-agent reads the translation files your app already has (Android resources, gettext PO,
Apple String Catalogs), checks every translation against its source with strict rules, and
writes changes back without disturbing anything else in the file. It is built to be driven by
any AI coding agent or model, from the CLI, an MCP server, or CI.

> **Status: early development.** Setup (`detect`, `init`), checking (`validate`) and progress
> (`status`) work today for three formats. Translating with a model, the MCP server and agent skills come next.
> See [Roadmap](#roadmap), [PLAN.md](PLAN.md) for the full plan, and [RESEARCH.md](RESEARCH.md)
> for how this compares to paid tools.

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

Not on npm yet. Run it from source (Node 22 or newer):

```sh
git clone https://github.com/jigarfumakiya/l10n-agent.git
cd l10n-agent
npm install
npm run build
npm link          # puts `l10n` on your PATH; or run `node dist/cli.js`
```

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
▲ ar %lld days left[one] placeholder-missing Missing %lld (argument 1) App/Localizable.xcstrings:7
· 1 string uses device variations or substitutions, which aren't supported yet; skipped
2 errors, 4 warnings
```

## Commands

| Command | What it does |
|---|---|
| `l10n detect` | Lists the translation files in the repo, with evidence and confidence. Writes nothing |
| `l10n init` | Detects, asks, and writes `l10n.config.yaml` |
| `l10n status` | Progress per target and locale |
| `l10n validate` | Runs every check. Exit code 1 if there are errors |

Options:

| Option | Applies to | Meaning |
|---|---|---|
| `--json` | all | Machine-readable output for agents and scripts |
| `-l, --locale hi,ar` | `status`, `validate` | Only these locales |
| `--strict` | `validate` | Untranslated strings and missing locales count as errors |
| `-y, --yes` | `init` | Accept the detected setups without asking |
| `--accept 1,2` | `init` | Only these setups (numbers from `detect`) |
| `--source en` | `init` | Source language (default: declared in a String Catalog, else `en`) |
| `-l, --locales hi,ar` | `init` | Languages to translate into (default: those found on disk) |
| `--force` | `init` | Replace an existing `l10n.config.yaml` |
| `-c, --config <file>` | all | Config file (default: the nearest `l10n.config.yaml`) |
| `-C, --cwd <dir>` | all | Directory to run in |

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

| Code | Severity | What |
|---|---|---|
| `placeholder-missing`, `placeholder-extra`, `placeholder-type` | error | Placeholders must match the source. A count left out of a form used for a single number (like `one`) is only a warning |
| `plural-missing-category` | error / warning | Every plural form the locale needs. Error for gettext and for a missing `other`. Warning when the app would fall back to `other`, or the form is only used for fractions |
| `plural-extra-category` | warning / error | A form the locale never uses (error for gettext, which rejects it) |
| `escape-apostrophe`, `escape-quote`, `escape-leading-reference`, `escape-invalid` | error | Android escaping |
| `xliff-mismatch` | error | `<xliff:g>` protected spans kept |
| `array-length`, `kind-mismatch`, `empty` | error | The translation has the same shape as the source |
| `xml-malformed`, `po-malformed`, `json-malformed`, `duplicate-key`, `name-missing` | error | File problems, with line numbers |
| `plural-forms-invalid`, `plural-forms-missing` | error | Broken or missing gettext `Plural-Forms` header |
| `target-missing` | error | A configured path doesn't exist |
| `placeholder-not-positional` | warning | A source with several unnumbered placeholders should number them so translators can reorder |
| `markup-mismatch`, `whitespace`, `untranslated`, `escape-unknown` | warning | Markup or edge whitespace changed, or text left in the source language |
| `orphan`, `not-translatable` | warning | Leftover translations to clean up |
| `plural-forms-unexpected`, `plural-forms-unknown`, `language-mismatch`, `source-language-mismatch` | warning | Header or config disagrees with the language or file |
| `missing`, `locale-missing`, `variation-unsupported` | info | Untranslated strings and skipped content (errors with `--strict`) |

Checks are tested on real data: AndroidX and RevenueCat resources (207 locale folders), Django
admin's PO files in 11 languages, and 9 real String Catalogs. On that data they found genuine
upstream bugs, including a Python placeholder in Django's Irish translation that `msgfmt --check` misses.

## Roadmap

1. **More formats:** JSON (i18next, ICU), Flutter ARB, String Catalog substitutions and device variations.
2. **Translation.** Batches of strings with full context go to your agent's model, or to a provider in CI. Every result is checked before it is written, and drafts are reviewed before approval.
3. **Agent surfaces:** skills (`SKILL.md`), an MCP server and a GitHub Action.
4. **Quality:** an AI reviewer, a static review page for people, and visual checks for truncated or right-to-left layouts.

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
src/core/        config, project loading, checks, status, lockfile, placeholders, plural rules
src/formats/     one folder per format; each opens a Target (read, check, write)
src/detect/      repo walk, per-format detection, config building for `init`
src/cli/         the `l10n` command
fixtures/        sample projects with deliberate mistakes, one per format
test/            vitest suites
```

If GNU gettext is installed, the tests also compare PO output against `msgcat` and `msgfmt`.

## License

MIT
