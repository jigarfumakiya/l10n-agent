# Contributing to Localship

Thanks for helping. Issues and pull requests are welcome at
https://github.com/jigarfumakiya/localship.

## Development setup

```sh
npm install
npm run check   # typecheck + lint + tests
npm run build   # bundles dist/cli.js
npm run benchmark # synthetic native catalogs; no model calls
npm run dev -- validate -C fixtures/po/django
```

Layout:

```
src/core/        config, project loading, checks, status, lockfile, context, the batch/submit/approve loop
src/formats/     one folder per format; each opens a Target (read, check, write)
src/detect/      repo walk, per-format detection, config building for `init`
src/translate/   prompts, model providers, the delegated translate loop
src/mcp/         the MCP server
src/cli/         the `localship` command
skills/          agent skills: localship-setup, localship-extract, localship-translate, localship-review
docs/            the reference
.claude-plugin/  Claude Code plugin and marketplace manifests
examples/        a sample app translated with the tool
fixtures/        sample projects with deliberate mistakes, one per format
test/            vitest suites
```

If GNU gettext is installed, the tests also compare PO output against `msgcat` and `msgfmt`.

## Ground rules

- **The core owns correctness; the model owns judgment.** Anything code can check is checked in
  code (`src/core/validate.ts`), not described in a prompt.
- **The CLI comes first.** MCP tools and skills are thin layers over the same core functions.
- **Never lose a person's work.** Hand edits and approved translations are never overwritten
  without `--force`. Writes are atomic.
- **Native files, native formatting.** Untouched content is written back byte for byte; changed
  content matches what Android Studio, `msgcat` and Xcode write. Every format has round-trip tests
  on real files.
- **Nothing app-specific.** General needs become features; the rest belongs in a project's config.

## Adding a format

Each format lives in `src/formats/<name>/` and implements `FormatAdapter` from
`src/formats/types.ts`: it opens a `Target` with the source catalog, every locale on disk,
an `analyze` function for checks, plural rules, and `writeLocale`. Add it to `ADAPTERS` in
`src/core/project.ts`, a schema in `src/core/config.ts`, detection in `src/detect/detect.ts`, and
a fixture with deliberate mistakes in `fixtures/`.

## Before a pull request

For performance changes, see [performance checks](docs/performance.md) for the benchmark's scope
and repeatable comparison procedure.

`npm run check` must pass (typecheck, lint, tests). CI runs it on Linux, macOS and Windows.
