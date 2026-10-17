---
name: localship-extract
description: Make an Android or iOS app localizable by moving text hardcoded in Kotlin, XML layouts or Swift into string resources or a String Catalog, without changing behavior. Use when the user wants text ready for translation or hardcoded strings found, however they phrase it, and as the first step when they want the app in another language but its text is still in the code.
---

# Make an app localizable

Most apps start with their text written straight into the code. Before anything can be
translated, that text has to move into the platform's string resources. You do the moving;
the rules below keep it safe. Change how text is looked up, never what the app does.

## 1. Find the text

`localship detect` (or `localship_detect`) gives a first estimate: how much UI text is still in the
code, per module, with examples. Use it to size the work, then search properly as below.

Do the scope the user wants: the whole app unless they named particular screens or features. Search that code for user-facing literals, say in one line how
much you found, and start. Build as you go, and give a short progress update after each part.

**Android (Kotlin, Compose, Views)**, look for string literals in:
- `Text("…")`, `text = "…"`, `label = { Text("…") }`, `title = "…"`, `placeholder`, `contentDescription = "…"`
- `Toast.makeText(…, "…")`, `Snackbar`, `AlertDialog` titles and buttons, `setTitle("…")`
- notifications (`setContentTitle`, `setContentText`), widgets (Glance), app shortcuts
- string templates with UI text (`"$count items"`) and plural patterns (`if (n == 1) "item" else "items"`)
- XML layouts: `android:text`, `android:hint`, `android:contentDescription` holding literals instead of `@string/…`

**iOS (SwiftUI, UIKit)**:
- `Text(someString)` where the argument is a `String` variable or property: **not** localized.
  `Text("literal")` already is, once a String Catalog exists.
- view-model or model properties holding UI text, `.navigationTitle(title)`, `Label(title, …)`,
  `alert`/`confirmationDialog` text passed as `String`, `Button(title)` with a `String`
- UIKit: `label.text = "…"`, `button.setTitle("…", for:)`, `title = "…"`
- notification content, widget text, App Intents titles
- default UI text in parameters (`title: String = "Cancel"`): not extracted until the parameter
  is a `LocalizedStringResource` or the default is wrapped

**Sentences built from English grammar** (both platforms). Wrapping these in a resource does
nothing; search for them and rewrite each sentence whole:
- pieces joined around a value (`"Finished " + amount + " over your plan."`, often so the value
  can be styled): one complete sentence per case with placeholders, styling the value inside it
  (`AttributedString(localized:)`; Android annotations or spans on the placeholder)
- plural endings in code (`count == 1 ? "" : "s"`, `== 1 ?` near text): plural resources
- helpers that spell out numbers, write ordinals or choose "a"/"an" (names with `spell`,
  `ordinal`, `article`): formatters (`.formatted(.number.notation(.spellOut))`, an ordinal
  `NumberFormatter`; ICU `RuleBasedNumberFormat` and `MessageFormat` on Android) or one sentence
  per case
- text surgery on UI strings (`replacingOccurrences`, `replace`, `removePrefix`): store both forms
- lists (`joined(separator: ", ")` plus "and"): `.formatted(.list(type: .and))`,
  `ListFormatter`, or ICU `ListFormatter` on Android

Rewrite even when it adds variants, and keep the English output identical so tests still pass.

**Leave alone:** log messages, analytics event names, preference and database keys, routes and
deep links, test tags and accessibility identifiers, URLs, format patterns, debug-only screens,
and anything never shown to users. Also text that doubles as data: enum raw values, `case`
patterns, query item names, dictionary keys, and any string that's parsed back, compared or saved
(picker values parsed into intervals, values written to export files). To show those translated,
add a separate display property and keep the stored value as it is. Brand names can stay in code,
or become resources marked not translatable.

## 2. Android rules

- Put strings in `res/values/strings.xml` of the module that uses them. Create the file if needed:
  `<?xml version="1.0" encoding="utf-8"?>` then `<resources>…</resources>`.
  Keep a default for every resource the app uses; a definition only in `values-en` is not a default.
  Check the merged resources with Android lint for the relevant build variants, especially when
  libraries, flavors or multiple source sets supply defaults.
- Key names and comments: follow the project's existing resources. If there are none, use
  `screen_role` in snake_case (`settings_title`, `settings_save_button`) with a comment above each
  string saying where it appears and what placeholders mean
  (`<!-- Settings screen: saves changes. %1$s is the profile name -->`), and say so in your report.
  Reuse an existing key when the text *and* meaning are the same; otherwise make a new one.
- Escape `'` as `\'` and `"` as `\"`; `&` as `&amp;`.
- **Never concatenate** text: one string with numbered placeholders (`%1$s`, `%2$d`) per sentence,
  so translators can reorder.
- **Counts use plurals:** `<plurals name="…"><item quantity="one">%d item</item><item quantity="other">%d items</item></plurals>`.
- Compose: `stringResource(R.string.key)`, `stringResource(R.string.key, arg)`,
  `pluralStringResource(R.plurals.key, count, count)`.
- Outside composables: `context.getString(…)` / `resources.getQuantityString(…)`. For text built
  in view models or other non-UI code, follow the pattern the project already uses. If it has
  none, expose `@StringRes` ids or a small `UiText` wrapper resolved in the UI rather than passing
  a `Context`, and say so in your report.
- Money, numbers and dates go through formatters (`NumberFormat`, `DateTimeFormatter.ofLocalizedDate`),
  never hand-built strings. Keep the amount signed and set its actual currency; changing the display
  language must not change the currency. Respect the user's regional and numbering preferences.
- Brand names that must not change: `<string name="app_name" translatable="false">…</string>`.
- Check `android:supportsRtl`, start/end spacing and alignment, and directional icons. Mirror
  directional navigation affordances when appropriate; do not mirror every image or chart blindly.
- Localship handles plain locale folders. Qualified string resources such as `values-ar-night`
  remain separate; a coverage warning must be resolved with platform checks, not by moving those
  strings into a plain locale folder or removing the qualifiers.

## 3. iOS rules

- **Generated projects:** when `project.yml` (XcodeGen) or `Project.swift` (Tuist) exists, make
  every project change there and regenerate; never edit the `.pbxproj` or rely on changes made in
  Xcode, which regeneration drops. In XcodeGen that's `options: developmentLanguage: <lang>` and,
  under `settings: base:`, `SWIFT_EMIT_LOC_STRINGS: YES` and
  `LOCALIZATION_PREFERS_STRING_CATALOGS: YES`, with each catalog inside a source folder of its
  target.
- Every target that shows text (the app, widgets and other extensions) needs its own catalog in
  its sources.
- Use String Catalogs and the project's actual development language; never assume English.
  Reuse existing tables. For a new catalog, use Xcode's localization preparation tools when
  available, or create `Localizable.xcstrings` in the appropriate target with `sourceLanguage`
  matching the development language, an empty `strings` object and `version: "1.0"`.
  Verify target membership and resource inclusion, including extensions and Swift packages.
- Verify **Use Compiler to Extract Swift Strings** (`SWIFT_EMIT_LOC_STRINGS`) for the relevant
  targets. Build all relevant schemes/targets and supported platforms before translating;
  building only the main app may miss platform-conditional strings and extension resources.
- **Filling the catalog:** a command-line build (`xcodebuild`) writes `.stringsdata` files into
  DerivedData but leaves the `.xcstrings` unchanged; only Xcode's catalog editor merges them. An
  empty catalog after a clean build doesn't mean extraction failed. Sync each catalog from its
  own target's build output:
  ```sh
  xcrun xcstringstool sync <Target>/Localizable.xcstrings \
    --stringsdata <DerivedData>/Build/Intermediates.noindex/<Project>.build/<Config>-<sdk>/<Target>.build/Objects-normal/*/*.stringsdata
  ```
- **Keys with no words** (`" "`, `"·"`, `"%@%@"`, `"—"`) come from text built in pieces.
  Localship skips them; mark them `"shouldTranslate" : false` in the catalog so Xcode's progress
  agrees, and check whether each one is a sentence split into pieces that should be rewritten.
- For copy-heavy models (personalities, tips, onboarding pages), changing an initializer
  parameter from `String` to `LocalizedStringResource` extracts all the copy passed to it.
- `Text("literal")`, `Button("literal")`, `Label("literal", …)` are extracted by Xcode
  automatically. Add a comment where the meaning isn't obvious: `Text("Save", comment: "Saves the profile")`.
- Prefer `LocalizedStringResource` for passing localizable text through models and custom views;
  use `String(localized:)` where a resolved string is needed. Avoid caching resolved translations
  across language changes. `LocalizedStringKey` also works for SwiftUI-specific view APIs.
- Specify the right table and bundle for non-default catalogs, frameworks and packages.
  On toolchains supporting it, `#bundle` refers to the current target's resources; otherwise use
  the appropriate bundle, such as `Bundle.module` in a Swift package, rather than assuming `.main`.
- Xcode 26+ can generate typed `LocalizedStringResource` symbols for manually managed keys;
  respect an existing symbol-based workflow. It also offers automatic translator comments;
  review generated comments and add app-specific meaning and placeholder context.
- Use `Text(verbatim:)` for text that must never be translated (codes, user content).
- Interpolations become placeholders automatically: `Text("\(count) items")` → key `%lld items`.
  Counts need plural forms: after syncing, find the keys with count placeholders (`%lld`,
  `%d`) and give them plural variations (**Vary by Plural** in Xcode, or `variations.plural` in
  the catalog JSON with the forms the source language needs). Whatever you can't convert, list
  in your report so the user can do it in Xcode before translating.
  Multiple independent counts require substitutions; device wording may require device variants.
  Localship cannot translate or validate those advanced entries yet. Keep their structure and
  use Xcode to handle them; never flatten them to make Localship's checks pass.
- Money, numbers and dates: `.formatted()` and `FormatStyle`, never hand-built strings.
- Include user-facing permission descriptions and other localizable Info.plist values through
  `InfoPlist.xcstrings`, plus storyboard/xib and App Intents text where the app uses them.
- Xcode 27 has native agent localization and preview tools. When available, use them for project
  preparation and visual review, keeping the same glossary and voice guidance. If they edit
  translations tracked by Localship, review the resulting hand edits before adopting them.

## 4. Check nothing was missed

- The app must build after each chunk. Don't change logic, layout or behavior. Run Android lint
  for affected variants, or build the affected Apple targets/platforms; file validation alone
  cannot verify resource merging, extraction or runtime lookups.
- Android: enable pseudolocales (`android { buildTypes { debug { isPseudoLocalesEnabled = true } } }`),
  switch the device to "English (XA)", and look for text that isn't accented: that text is still hardcoded.
  "AR (XB)" shows right-to-left layout problems.
- iOS: Scheme › Run › Options › App Language › "Accented Pseudolanguage" (and "Right-to-Left
  Pseudolanguage"). Plain English left over was missed. Without Xcode's UI, a scripted check works:
  add a temporary language whose values wrap the English in markers (`⟦Save⟧`), launch with
  `-AppleLanguages "(xx)"`, look for text without markers, then remove the temporary language.
- If you can't run these, list the screens for the user to check.

### Text the resource files can't show

These passed every Localship check in a real app and were only found on a device. Search the code
for them while you're in it:

- **Names stored in data.** Categories, accounts or templates seeded in English and saved to a
  database are shown as stored. Translate them at display time while they're still the seeded
  value (a map from seeded name to string resource); never translate what the user typed.
  Use the translated name only for showing it: anything saved (database rows, defaults,
  exports, a name copied into a new record) keeps the stored value, or it stays in whatever
  language the app had when it was saved.
- **Text built once and kept.** View models, singletons and caches that build sentences keep the
  old language after an in-app language switch. Rebuild them when the locale changes; on Android,
  view models survive the activity being recreated for the new language.
- **Charts drawn by hand.** Check that custom drawing and surrounding labels agree in RTL.
  Decide mirroring based on the chart's meaning and axis conventions, and test it on a device.
- **Signs and symbols on amounts.** Format the signed value as one unit with the platform's
  number/currency formatter. Preserve its Unicode direction marks. Do not prepend a minus sign,
  strip U+200F or force every amount to LTR. For dynamic text inserted into an Android localized
  message, use context-aware `BidiFormatter.unicodeWrap()` unless already wrapped. On Apple,
  use localized interpolation and natural text direction. Test positive/negative amounts,
  currency symbols and mixed-script text in the actual UI before adjusting directionality.
- **Dates and months.** Check that language switching refreshes labels while formatters respect
  intended regional preferences; language, region, calendar and currency are separate choices.

Use the [platform verification guide](references/platform-localization.md) for current official
references and the final test checklist.

## 5. Then

Run `localship detect` (or `localship_detect`): it should now find the strings. Report what you
moved, and any convention you had to pick. If the user also asked for translation, continue with
the `localship` skill. Don't create branches or commit unless the user asks; if they do commit,
suggest committing the extraction on its own, so the diff is easy to review.
