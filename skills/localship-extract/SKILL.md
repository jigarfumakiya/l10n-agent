---
name: localship-extract
description: Make an Android or iOS app localizable by moving text hardcoded in Kotlin, XML layouts or Swift into string resources or a String Catalog, without changing behavior. Use when an app has no translation files yet, when localship detect finds nothing, or when the user asks to find hardcoded strings.
---

# Make an app localizable

Most apps start with their text written straight into the code. Before anything can be
translated, that text has to move into the platform's string resources. You do the moving;
the rules below keep it safe. Change how text is looked up, never what the app does.

## 1. Find the text

`localship detect` (or `localship_detect`) gives a first estimate: how much UI text is still in the
code, per module, with examples. Use it to size the work, then search properly as below.

Search the UI code for user-facing literals and show the user a summary grouped by screen or
feature, with counts. Ask whether to do the whole app or one feature first. For big apps, go one
feature at a time and build after each.

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

**Leave alone:** log messages, analytics event names, preference and database keys, routes and
deep links, test tags and accessibility identifiers, URLs, format patterns, debug-only screens,
and anything never shown to users. Brand names can stay in code, or become resources marked
not translatable.

## 2. Android rules

- Put strings in `res/values/strings.xml` of the module that uses them. Create the file if needed:
  `<?xml version="1.0" encoding="utf-8"?>` then `<resources>…</resources>`.
- Key names: `screen_role` in snake_case (`budget_title`, `budget_save_button`). Reuse an existing
  key when the text *and* meaning are the same; otherwise make a new one.
- Add a comment above each string saying where it appears and what placeholders mean:
  `<!-- Budget screen: button that saves the plan. %1$s is the month name -->`
- Escape `'` as `\'` and `"` as `\"`; `&` as `&amp;`.
- **Never concatenate** text: one string with numbered placeholders (`%1$s`, `%2$d`) per sentence,
  so translators can reorder.
- **Counts use plurals:** `<plurals name="…"><item quantity="one">%d item</item><item quantity="other">%d items</item></plurals>`.
- Compose: `stringResource(R.string.key)`, `stringResource(R.string.key, arg)`,
  `pluralStringResource(R.plurals.key, count, count)`.
- Outside composables: `context.getString(…)` / `resources.getQuantityString(…)`. Don't pass a
  `Context` into a ViewModel: expose `@StringRes` ids, or a small `UiText` wrapper resolved in the UI.
- Money, numbers and dates go through formatters (`NumberFormat`, `DateTimeFormatter.ofLocalizedDate`),
  never hand-built strings.
- Brand names that must not change: `<string name="app_name" translatable="false">…</string>`.

## 3. iOS rules

- A String Catalog must exist. If there is none, ask the user to add one in Xcode
  (File › New › File from Template › String Catalog, named `Localizable`) or create
  `Localizable.xcstrings` in the app target's folder containing
  `{"sourceLanguage" : "en", "strings" : {}, "version" : "1.0"}`. In Xcode 16 synced folders it
  is picked up automatically; otherwise it must be added to the target in Xcode.
- `Text("literal")`, `Button("literal")`, `Label("literal", …)` are extracted by Xcode
  automatically. Add a comment where the meaning isn't obvious: `Text("Save", comment: "Saves the budget")`.
- Text in variables: make it `String(localized: "…", comment: "…")` where it's created, or type the
  property as `LocalizedStringResource` / `LocalizedStringKey`.
- Use `Text(verbatim:)` for text that must never be translated (codes, user content).
- Interpolations become placeholders automatically: `Text("\(count) items")` → key `%lld items`.
  Counts need plural forms: list those strings and tell the user to right-click them in the
  catalog › Vary by Plural, since that's done in Xcode.
- Money, numbers and dates: `.formatted()` and `FormatStyle`, never hand-built strings.
- **Build once** (in Xcode, or `xcodebuild … build`) so Xcode collects the strings into the catalog.

## 4. Check nothing was missed

- The app must build after each chunk. Don't change logic, layout or behavior.
- Android: enable pseudolocales (`android { buildTypes { debug { isPseudoLocalesEnabled = true } } }`),
  switch the device to "English (XA)", and look for text that isn't accented: that text is still hardcoded.
  "AR (XB)" shows right-to-left layout problems.
- iOS: Scheme › Run › Options › App Language › "Accented Pseudolanguage" (and "Right-to-Left
  Pseudolanguage"). Plain English left over was missed.
- Ask the user to run these if you can't; list the screens to check.

## 5. Then

Run `localship detect` (or `localship_detect`): it should now find the strings. Continue with the
`localship-setup` skill. Commit nothing unless the user asks; suggest committing the extraction on its
own before translating, so the diff is easy to review.
