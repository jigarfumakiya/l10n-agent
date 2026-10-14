# Example: Jotter (Android)

A small note-taking app's strings, translated into Hindi and Arabic by a coding agent using
l10n-agent's `l10n-translate` skill. Use it to see what the tool reads and writes.

- `app/src/main/res/values/strings.xml`: the English source, with plurals, placeholders,
  an apostrophe, `<b>` and `<xliff:g>` markup, and a string array.
- `.l10n/`: the brief, voice per language and glossary the agent translated with.
- `app/src/main/res/values-hi/`, `values-ar/`: the translations `l10n submit` wrote. Arabic
  has all six plural forms.
- `.l10n/lock.json`: every translation recorded as a draft, with the model that made it.

Try it from this folder:

```sh
l10n status
l10n validate
l10n next-batch --locale hi --states draft   # what a reviewer sees
```
