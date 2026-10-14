# l10n-agent

**Local-first, agent-native localization for mobile apps.**
Your repo is the translation system. Your model is the translator.

> Status: early development. `status` and `validate` work today for **Android XML**, **gettext PO** and **Apple String Catalogs**.
> See [PLAN.md](PLAN.md) for the roadmap and [RESEARCH.md](RESEARCH.md) for how this compares to paid tools.

## Why

Paid localization tools copy your strings into their cloud, charge per word or seat, and only see an
app description for context. l10n-agent keeps everything in git, works with any model (your coding
agent's own, or any API key in CI), and checks every translation with deterministic rules before
it touches your files.

## Quick start

```sh
npm install --save-dev l10n-agent
```

`l10n.config.yaml` at your project root. Each target is one set of translation files:

```yaml
sourceLocale: en
locales: [hi, ar]
targets:
  - format: android-xml
    path: app/src/main/res

  - format: po
    path: locale/{locale}/LC_MESSAGES/django.po   # {locale} matches pt_BR, sr@latin, hi …
    template: locale/django.pot                    # optional; else msgids are the source

  - format: xcstrings
    path: App/Localizable.xcstrings                # one file holds every language
```

```sh
npx l10n status      # progress per locale
npx l10n validate    # every check; exits 1 on errors (use in CI)
```

Both take `--json` for agents and scripts, and `--locale hi,ar` to narrow the run.

## Formats

| Format | Status | Notes |
|---|---|---|
| Android `res/values*/strings.xml` | ✅ | strings, plurals, string-arrays, `translatable`, `formatted`, `product`, `xliff:g` |
| gettext `.po` / `.pot` | ✅ | `msgctxt`, plurals via `Plural-Forms`, `#,` format flags, `fuzzy` as draft, `#.`/`#:` as context; untouched entries are written back byte for byte, changed ones wrapped exactly like `msgcat` |
| JSON (flat, nested, i18next, ICU) | planned | |
| Flutter ARB | planned | |
| Apple String Catalog `.xcstrings` | ✅ | strings, plural variations (plus Apple's optional `zero`), `needs_review`/`new` as draft, `shouldTranslate`, stale entries skipped; written exactly as Xcode writes it. Device variations and substitutions are read but skipped for now |
| Apple `.strings` / `.stringsdict` | planned | |

### String Catalog specifics

- The catalog is one JSON file for every language. Untouched parts are written back byte for
  byte; changed parts follow the file's own style (Xcode's: 2-space indent, `" : "`, sorted keys,
  blank-line empty objects, no final newline), so Xcode reopens it without a diff.
- Placeholders use Foundation syntax: `%@`, `%lld`, `%1$@`, `%#@name@`. `%d` and `%lld` count
  as the same kind of argument.
- A translation may vary by plural even when the source doesn't, as Xcode allows.

### gettext specifics

- **Placeholders** follow each entry's flag: `c-format`, `python-format` (`%(name)s`),
  `python-brace-format` (`{name}`), `php-format`, `java-format`, `qt-format`, `ruby-format`.
  Flags are read from the source entry, so a translation file that lost its flags is still
  checked. Set `placeholders:` on the target for entries with no flag.
- **Plurals** use the file's `Plural-Forms` header. Each form is described by the counts that
  select it (Russian form 1 = 2, 3, 4, 22, 23…), and the header itself is checked against the
  language's standard rule. Missing rules can be set per locale with `pluralForms:`.
- **New locale files** are created from the template with the right `Language` and `Plural-Forms`.

## What `validate` checks

| Code | Severity | What |
|---|---|---|
| `placeholder-missing` / `-extra` / `-type` | error | `%1$s`, `%d` … must match the source (a missing count in `one`/`two`/`zero` forms is a warning) |
| `plural-missing-category` | error / warning | Every plural form the locale needs (Arabic: zero, one, two, few, many, other). Error for gettext and for a missing `other`; a warning when the app would fall back to `other`, or the form is only for fractions |
| `escape-apostrophe` / `escape-quote` / `escape-leading-reference` | error | Android escaping: `\'`, `\"`, `\@`, `\?` |
| `xml-malformed`, `duplicate-key` | error | File and value parse errors, with line numbers |
| `xliff-mismatch` | error | `<xliff:g>` protected spans kept |
| `array-length`, `kind-mismatch`, `empty` | error | Shape of the translation matches the source |
| `placeholder-not-positional` | warning | Source strings with several `%s` should number them so translators can reorder |
| `markup-mismatch`, `whitespace`, `untranslated` | warning | `<b>`/`<i>` kept, edge whitespace kept, text left in the source language |
| `orphan`, `not-translatable`, `plural-extra-category` | warning | Leftovers that should be cleaned up (an extra gettext form is an error) |
| `po-malformed`, `json-malformed`, `plural-forms-invalid`, `plural-forms-missing` | error | Broken file syntax or `Plural-Forms` header |
| `plural-forms-unexpected`, `language-mismatch` | warning | Header disagrees with the language's standard rule or the file's locale |

Resource aliases (`@string/other`) and `translatable="false"` strings are skipped. Locale folders
follow Android's naming, including `values-b+sr+Latn` and the legacy `values-iw` / `values-in`.

## Development

```sh
npm install
npm run check   # typecheck + lint + tests
npm run build   # dist/cli.js
npm run dev -- status -C fixtures/android/sample
```

## License

MIT
