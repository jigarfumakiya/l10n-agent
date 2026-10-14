---
name: l10n-setup
description: Set up localization for an app repo with l10n-agent — whether it already has translations, has string resources but no translations, or has its text hardcoded. Finds the translation files, writes l10n.config.yaml, and drafts the brief, voice and glossary translators need. Use when a project has no l10n.config.yaml yet, or the user asks to add languages or set up translation.
---

# Set up localization with l10n-agent

l10n-agent keeps translations in the repo's own files (Android `res/values-*/strings.xml`,
gettext `.po`, Apple `.xcstrings`) and checks every translation in code. You do the parts
that need judgment: choosing what to set up, and writing the context translators use.

## Running the tool

- If `l10n_*` MCP tools are available, use them (`l10n_detect`, `l10n_init`, …).
- Otherwise run the CLI: `l10n <command>`. If `l10n` isn't installed, ask to install it once with
  `npm install -g github:jigarfumakiya/l10n-agent` (running it through `npx` every time is slow).
- Add `--json` when you need to read the output.

Before writing anything, check `git status`. If there are uncommitted changes, mention it, so the
user can tell your changes apart from theirs.

## 1. Find out where the project stands

Run `l10n status`. If it works, the project is already set up: go to step 5 (context) if
`.l10n/brief.md` is missing, or to **Adding languages** below. Otherwise run `l10n detect` and
pick the case that fits:

| What detect shows | Case |
|---|---|
| Setups with existing languages (`hi, ar` …) | **A. Already localized** |
| Setups with strings but no languages | **B. Ready to translate** |
| An empty String Catalog (0 strings) | Ask the user to build the app in Xcode once, then detect again |
| A gettext template with no translations | **B**, after confirming where new `.po` files go (detect suggests a path) |
| Nothing, with a hint about Android or Xcode | **C. Text is hardcoded**: run the `l10n-extract` skill first, then come back |
| Only formats listed as "not supported yet" (Flutter ARB, JSON, `.strings` …) | Say so plainly; l10n-agent can't translate those yet |

## 2. Ask, then init

Show the user what was found and ask:
- which setups to include (skip debug, test and sample folders unless they want them);
- **case A:** whether to keep translating the languages already there, and whether to add more;
- **case B:** which languages to translate into. Suggest from their market if they don't know.

Then run `l10n init --accept <numbers> --locales <list>` (add `--source <locale>` if the detected
source language is wrong). Language codes are BCP 47 (`hi`, `ar`, `pt-BR`, `zh-Hans`). Never pass
`--force` unless the user asked to replace their config.

## 3. Existing translations (case A)

They show as `untracked`: made before l10n-agent, so the tool doesn't know if they're good. Ask:
- **Trust them:** `l10n approve --from untracked`.
- **Review first:** run the `l10n-review` skill on them (it can fetch untracked strings).
- **Leave them:** they stay as they are and are never overwritten without the user's say-so.
Then `l10n validate`: existing files often have real problems (missing placeholders, broken
plurals). Report the errors and offer to fix them.

## 4. Platform setup the tool can't do (mention what applies)

- Android: per-app language picker — in `build.gradle(.kts)` set
  `androidResources { generateLocaleConfig = true }` and add
  `app/src/main/res/resources.properties` with `unqualifiedResLocale=en-US` (the source).
- iOS: add each language under Project › Info › Localizations so Xcode keeps them.

## 5. Write the context

Create these in `.l10n/` (the `context` folder in the config). Draft them from the README, store
listing, website copy and the strings themselves, then show the user and adjust.

- `brief.md`: what the app does, who uses it, the tone of its copy (calm, playful, formal…), and
  anything translators get wrong without context (e.g. "a 'budget' is a monthly spending plan,
  not a cheap option"). Half a page at most.
- `voice/all.md`: voice rules for every language. `voice/<locale>.md`: per language, e.g. formality
  (German du vs Sie, Hindi तुम vs आप), English loanwords, number and date conventions. Ask the user
  their preference for formality; don't guess silently.
- `glossary.yaml`: brand and product names to keep (`translate: false`), and product terms that
  must be translated consistently:
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

## Cleaning up

After strings are deleted or renamed, `l10n prune --dry-run` shows leftover translations; show
the user, then run `l10n prune`.

## Adding languages later

`l10n add-locale fr,de` (or `l10n_add_locales`), then translate with `l10n-translate`.

## Finish

Run `l10n validate` and `l10n status`, and tell the user the next step: the `l10n-translate` skill
(or `l10n translate --model …` for a large catalog). Commit nothing unless the user asks.
