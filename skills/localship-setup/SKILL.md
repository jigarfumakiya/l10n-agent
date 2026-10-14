---
name: localship-setup
description: Set up localization for an app repo with Localship — whether it already has translations, has string resources but no translations, or has its text hardcoded. Finds the translation files, writes localship.yaml, and drafts the brief, voice and glossary translators need. Use when a project has no localship.yaml yet, or the user asks to add languages or set up translation.
---

# Set up localization with Localship

Localship keeps translations in the repo's own files (Android `res/values-*/strings.xml`,
gettext `.po`, Apple `.xcstrings`) and checks every translation in code. You do the parts
that need judgment: choosing what to set up, and writing the context translators use.

## Running the tool

- If `localship_*` MCP tools are available, use them (`localship_detect`, `localship_init`, …).
- Otherwise run the CLI: `localship <command>`. If `localship` isn't installed, ask to install it once with
  `npm install -g github:jigarfumakiya/localship` (running it through `npx` every time is slow).
- Add `--json` when you need to read the output.

Before writing anything, check `git status`. If there are uncommitted changes, mention it, so the
user can tell your changes apart from theirs.

## 1. Find out where the project stands

Run `localship status`. If it works, the project is already set up (if it warns that most text is still in the code, go to case C): go to step 5 (context) if
`.localship/brief.md` is missing, or to **Adding languages** below. Otherwise run `localship detect` and
pick the case that fits:

| What detect shows | Case |
|---|---|
| A warning that most of the app's text is still in the code (more UI text in code than strings in resources) | **C. Text is hardcoded**, even if a few strings exist: run `localship-extract` first, or translations will cover only part of the app. Tell the user how much is in code |
| Setups with existing languages (`hi, ar` …) | **A. Already localized** |
| Setups with strings but no languages | **B. Ready to translate** |
| An empty String Catalog (0 strings) | Ask the user to build the app in Xcode once, then detect again |
| A gettext template with no translations | **B**, after confirming where new `.po` files go (detect suggests a path) |
| Nothing, with a hint about Android or Xcode | **C. Text is hardcoded**: run the `localship-extract` skill first, then come back |
| Only formats listed as "not supported yet" (Flutter ARB, JSON, `.strings` …) | Say so plainly; Localship can't translate those yet |

## 2. Ask, then init

Show the user what was found and ask:
- which setups to include (skip debug, test and sample folders unless they want them);
- **case A:** whether to keep translating the languages already there, and whether to add more;
- **case B:** which languages to translate into. Suggest from their market if they don't know.

Then run `localship init --accept <numbers> --locales <list>` (add `--source <locale>` if the detected
source language is wrong). Language codes are BCP 47 (`hi`, `ar`, `pt-BR`, `zh-Hans`). Never pass
`--force` unless the user asked to replace their config.

## 3. Existing translations (case A)

They show as `untracked`: made before Localship, so the tool doesn't know if they're good. Ask:
- **Trust them:** `localship approve --from untracked`.
- **Review first:** run the `localship-review` skill on them (it can fetch untracked strings).
- **Leave them:** they stay as they are and are never overwritten without the user's say-so.
Then `localship validate`: existing files often have real problems (missing placeholders, broken
plurals). Report the errors and offer to fix them.

## 4. Platform setup the tool can't do (mention what applies)

- Android: per-app language picker — in `build.gradle(.kts)` set
  `androidResources { generateLocaleConfig = true }` and add
  `app/src/main/res/resources.properties` with `unqualifiedResLocale=en-US` (the source).
- iOS: add each language under Project › Info › Localizations so Xcode keeps them.

## 5. Write the context

Create these in `.localship/` (the `context` folder in the config). Draft them from the README, store
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

Without file access, use `localship_update_context` instead.

## Cleaning up

After strings are deleted or renamed, `localship prune --dry-run` shows leftover translations; show
the user, then run `localship prune`.

## Adding languages later

`localship add-locale fr,de` (or `localship_add_locales`), then translate with `localship-translate`.

## Finish

Run `localship validate` and `localship status`, and tell the user the next step: the `localship-translate` skill
(or `localship translate --model …` for a large catalog). Commit nothing unless the user asks.
