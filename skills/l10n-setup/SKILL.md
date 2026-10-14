---
name: l10n-setup
description: Set up localization for an app repo with l10n-agent — find the translation files, write l10n.config.yaml, and draft the brief, voice and glossary translators need. Use when a project has no l10n.config.yaml yet, or the user asks to add languages or set up translation.
---

# Set up localization with l10n-agent

l10n-agent keeps translations in the repo's own files (Android `res/values-*/strings.xml`,
gettext `.po`, Apple `.xcstrings`) and checks every translation in code. You do the parts
that need judgment: choosing what to set up, and writing the context translators use.

## Running the tool

- If `l10n_*` MCP tools are available, use them (`l10n_detect`, `l10n_init`, …).
- Otherwise run the CLI: `l10n <command>`. If `l10n` isn't installed, use
  `npx -y github:jigarfumakiya/l10n-agent <command>` (first run builds it; later runs are quick).
- Add `--json` when you need to read the output.

## Steps

1. **Check for an existing setup.** If `l10n.config.yaml` exists, run `l10n status` and skip to
   step 4.

2. **Detect.** Run `l10n detect`. It lists each localization setup it found (numbered), the
   source language, existing locales, and formats it recognizes but doesn't support yet.
   - If it finds nothing in an Xcode project, suggest adding a String Catalog in Xcode
     (File → New → File → String Catalog), then build once so Xcode fills it.
   - If the app has no string resources at all (text hardcoded in code), say so: the strings
     have to be moved into resources first.

3. **Ask, then init.** Show the user what was found and ask:
   - which setups to include (skip debug, test and sample folders unless they want them);
   - which languages to translate into. Suggest from their market if they don't know.
   Then run `l10n init --accept <numbers> --locales <list>` (add `--source <locale>` if the
   detected source language is wrong). Never pass `--force` unless the user asked to replace
   their config.

4. **Write the context.** Create these in `.l10n/` (the `context` folder in the config).
   Draft them from the README, store listing, website copy and the strings themselves, then
   show the user and adjust.
   - `brief.md`: what the app does, who uses it, the tone of its copy (calm, playful,
     formal…), and anything translators get wrong without context (e.g. "a 'budget' is a
     monthly spending plan, not a cheap option"). Half a page at most.
   - `voice/all.md`: voice rules for every language. `voice/<locale>.md`: per language, e.g.
     formality (German du vs Sie, Hindi तुम vs आप), how to handle English loanwords, number and
     date conventions. Ask the user their preference for formality; don't guess silently.
   - `glossary.yaml`: brand and product names to keep (`translate: false`), and product terms
     that must be translated consistently:
     ```yaml
     terms:
       - term: StillMoney
         translate: false
       - term: safe to spend
         note: The amount the user can spend today without breaking their budget
         translations: { hi: खर्च के लिए सुरक्षित }
     ```
     Keep it short: names, and terms that appear in many strings or carry product meaning.
   Without file access, use `l10n_update_context` instead.

5. **Existing translations.** If `l10n status` shows `untracked` strings (translations made
   before l10n-agent), ask the user whether to trust them. If yes:
   `l10n approve --from untracked`. Otherwise leave them; they'll show up in review.

6. **Platform setup the tool can't do** (mention what applies):
   - Android: per-app language picker — in `build.gradle(.kts)` set
     `androidResources { generateLocaleConfig = true }` and add
     `app/src/main/res/resources.properties` with `unqualifiedResLocale=en-US` (the source).
   - iOS: add each language under Project → Info → Localizations so Xcode keeps them.

7. **Finish** with `l10n validate` and `l10n status`, and tell the user the next step: the
   `l10n-translate` skill (or `l10n translate --model …` for a large catalog).

Commit nothing unless the user asks.
