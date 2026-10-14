# l10n-agent

**Local-first, agent-native localization for mobile apps.**
Your repo is the translation system. Your model is the translator.

> Status: early development. The Android core (`status`, `validate`) works today.
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

`l10n.config.yaml` at your project root:

```yaml
sourceLocale: en
locales: [hi, ar]
targets:
  - format: android-xml
    res: app/src/main/res
```

```sh
npx l10n status      # progress per locale
npx l10n validate    # every check; exits 1 on errors (use in CI)
```

Both take `--json` for agents and scripts, and `--locale hi,ar` to narrow the run.

## What `validate` checks (Android)

| Code | Severity | What |
|---|---|---|
| `placeholder-missing` / `-extra` / `-type` | error | `%1$s`, `%d` … must match the source (a missing count in `one`/`two`/`zero` forms is a warning) |
| `plural-missing-category` | error | Every CLDR plural form the locale needs (Arabic: zero, one, two, few, many, other) |
| `escape-apostrophe` / `escape-quote` / `escape-leading-reference` | error | Android escaping: `\'`, `\"`, `\@`, `\?` |
| `xml-malformed`, `duplicate-key` | error | File and value parse errors, with line numbers |
| `xliff-mismatch` | error | `<xliff:g>` protected spans kept |
| `array-length`, `kind-mismatch`, `empty` | error | Shape of the translation matches the source |
| `placeholder-not-positional` | warning | Source strings with several `%s` should number them so translators can reorder |
| `markup-mismatch`, `whitespace`, `untranslated` | warning | `<b>`/`<i>` kept, edge whitespace kept, text left in the source language |
| `orphan`, `not-translatable`, `plural-extra-category` | warning | Leftovers that should be cleaned up |

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
