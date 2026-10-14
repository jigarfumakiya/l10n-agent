# l10n-agent

**Translate your app with the AI you already use.**
Ask your coding agent to localize your app. l10n-agent gives it the right context, checks every
translation before it touches your files, and keeps everything in your repo. No account, no
upload, no per-word price.

```
You:    Set up localization for this app.
Agent:  Found 312 strings in app/src/main/res. Which languages do you want?
You:    Hindi and Arabic.
Agent:  Done. I drafted a short brief and glossary from your README. Have a look.
You:    Translate the app.
Agent:  624 translations written as drafts, all checks passed.
        Arabic uses all six plural forms; "StillMoney" was kept as written everywhere.
```

Works with **Android** (`strings.xml`), **iOS and macOS** (String Catalogs), and **gettext**
(`.po` files: Django, WordPress, Python, PHP, C). Use it from **Claude Code, Cursor, Codex,
Gemini CLI, VS Code, Claude Desktop**, or plain terminal commands.

## Why it's different

- **Nothing breaks.** Every translation is checked in code before it's written: placeholders like
  `%1$s`, all the plural forms each language needs, Android escaping, markup. A translation that
  would crash your app or break the build is sent back to the AI to fix, never saved.
- **Translations that fit your app.** The AI gets each string's comment, the plural rules of the
  language, your glossary, your brand voice, and how the same text was already translated on
  your other platform.
- **Your files, your repo.** Translations go into the files your app already uses, formatted the
  way Android Studio and Xcode write them, so diffs are small and easy to review.
- **Any model.** Your coding agent's own model, or any API: Claude, GPT, Gemini, OpenRouter, or a
  local model with Ollama. You pay only for your own tokens.
- **People stay in charge.** Translations land as drafts for review. Hand edits and approved
  translations are never overwritten.

## Get started

**1. Install.** In Claude Code:

```
/plugin marketplace add jigarfumakiya/l10n-agent
/plugin install l10n-agent@l10n-agent
```

Using a different tool? See [Other AI tools](#other-ai-tools).

**2. Set up.** Open your app's repo and ask:

> Set up localization for this app.

The agent finds your translation files, asks which languages you want, and drafts a short
brief, voice guide and glossary for you to check.

**3. Translate.**

> Translate the app into Hindi and Arabic.

**4. Review and ship.**

> Review the Arabic translations.

When you're happy, say "approve them" and build your app as usual.

## Wherever you're starting from

| Your app today | What happens |
|---|---|
| **Already has some translations** | They're kept as they are. The agent checks them for real bugs (missing placeholders, broken plurals), asks whether to trust or review them, then fills in what's missing |
| **Has string resources, no translations yet** | Pick your languages and translate |
| **Text is written straight into the code** | Ask "Make this app localizable". The agent moves the text into `strings.xml` or a String Catalog without changing what the app does, then you translate |
| **Adding a language later** | "Add French." |
| **You changed some copy** | Only the changed strings are retranslated. Everything else stays put |
| **New strings in a feature branch** | "Translate the new strings." |

## Other AI tools

l10n-agent is an [MCP server](https://modelcontextprotocol.io) plus agent skills. Add the server
to your tool, then ask in plain words as above.

```json
{
  "mcpServers": {
    "l10n": { "command": "npx", "args": ["-y", "github:jigarfumakiya/l10n-agent", "mcp"] }
  }
}
```

| Tool | Where it goes |
|---|---|
| Cursor | `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json`, with `"servers"` instead of `"mcpServers"` and `"type": "stdio"` added |
| Gemini CLI | `.gemini/settings.json` |
| Codex | `~/.codex/config.toml`: `[mcp_servers.l10n]` with `command = "npx"` and `args = ["-y", "github:jigarfumakiya/l10n-agent", "mcp"]` |
| Claude Code (without the plugin) | `claude mcp add l10n -- npx -y github:jigarfumakiya/l10n-agent mcp` |
| Claude Desktop | The same JSON, with `"-C", "/path/to/your/app"` before `"mcp"` |

The first start takes a minute while it installs; after that it's quick.

For agents that read skills (Claude Code, Codex, Cursor, Gemini CLI…), also add the step-by-step
playbooks for setting up, making an app localizable, translating and reviewing:

```sh
npx skills add jigarfumakiya/l10n-agent
```

## Without an agent

Everything also works from the terminal, which is handy for big apps and CI:

```sh
npm install -g github:jigarfumakiya/l10n-agent

l10n init                                            # find your files, pick languages
l10n translate --model anthropic:claude-sonnet-5-5   # or openai:…, gemini:…, ollama:…
l10n validate                                        # exits 1 on errors: use it in CI
l10n approve
```

See the [reference](docs/reference.md) for every command and option.

## Questions

**What does it cost?** Nothing. It's MIT-licensed. You pay your AI provider for tokens as usual,
or nothing with a local model.

**Where do my strings go?** Only to the AI you choose. There's no l10n-agent server.

**Will it overwrite my translators' work?** No. Hand edits and anything approved are never
replaced unless you explicitly ask.

**Which languages?** Any. Plural rules come from Unicode's CLDR data, so Arabic gets six plural
forms, Russian three and Japanese one, automatically.

**How good are the translations?** As good as the model and the context. The brief, voice and
glossary make the biggest difference; the checks make sure nothing in them breaks your app. See
a real result in [examples/android-notes](examples/android-notes).

**Is it ready?** It's young but working: setup, translation, checks, review and approval work for
the three formats above. Flutter ARB, JSON and Apple `.strings` files aren't supported yet. See
[what's coming](PLAN.md).

## Learn more

- [Reference](docs/reference.md): commands, configuration, formats and every check
- [Example](examples/android-notes): a small app translated into Hindi and Arabic
- [Contributing](CONTRIBUTING.md): development setup and how the code is laid out
- [Plan](PLAN.md) and [research](RESEARCH.md): where this is going, and how it compares to paid tools

## License

MIT
