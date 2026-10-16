# Changelog

## 0.1.0

The first release.

### Formats

- Android `strings.xml`: strings, string arrays and plurals, with Android escaping and markup.
- Apple String Catalogs (`.xcstrings`), with plural variations.
- gettext `.po` / `.pot`, with plural forms and fuzzy entries.
- Files are written back the way Android Studio, Xcode and gettext tools write them.

### Translation

- Strings go to the AI in batches with their context: the code that uses them, comments, a
  brief, voice notes per language, a glossary and earlier translations of the same text.
- Every translation is checked before it's written: placeholders, plural forms for each language
  (from Unicode CLDR), escaping, markup and the glossary. Failures go back to the AI with the reason.
- Translations are written as drafts. Approve them after review; hand edits and approved
  translations are never replaced unless you ask.
- A lockfile in `.localship/` tracks what was translated from which text, so updates only redo
  what changed.
- Translate with your coding agent's own model, or without an agent through Anthropic, OpenAI,
  Gemini, OpenRouter or Ollama.

### Setup and upkeep

- `plan` explains what it takes to translate an app before anything changes; `start` sets it up.
- `detect` finds translation files and other localization tools in a repo, and estimates how much
  text is still written in the code.
- `status`, `validate`, `approve`, `remove` and `prune` for progress, checks, review and cleanup.

### Agents

- An MCP server with 15 tools, for Claude Code, Cursor, VS Code, Codex, Gemini CLI and Claude Desktop.
- Agent skills to set up, make an app localizable, translate and review.
- A Claude Code plugin with the server and the skills.
