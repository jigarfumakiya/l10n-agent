# Platform verification

Guidance checked against official Android and Apple documentation on October 17, 2026.
Check the project's installed toolchain and deployment targets before applying newer APIs.

## Android

- Keep all needed default strings in unqualified `values` resources. Verify resource merging
  and references with the relevant Gradle lint/build tasks. A Localship target is a resource
  directory, not a model of every dependency, flavor and source set in the APK.
- Plain locale folders are supported. Strings in other configurations are preserved and reported
  as uncovered; `--strict` and `--require-approved` fail for those files. Do not remove qualifiers
  or copy conditional overrides into base resources to silence this diagnostic.
- Test supported languages with the system and any in-app picker, including persistence and
  switching while screens and view models remain alive.
- Format signed currency values using their actual currency and the intended display locale.
  Preserve direction marks produced by formatters; use bidi-aware handling for embedded text.

Official references:

- [Localization and default resources](https://developer.android.com/guide/topics/resources/localization)
- [String resources and plurals](https://developer.android.com/guide/topics/resources/string-resource)
- [Per-app language setup and migration](https://developer.android.com/guide/topics/resources/app-languages)
- [RTL, layout mirroring and BidiFormatter](https://developer.android.com/training/basics/supporting-devices/languages)
- [Pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)

## Apple platforms

- Use the actual development language, correct table/bundle, and compiler extraction. Build
  relevant targets and platforms before treating catalogs as complete; include extensions,
  packages, Info.plist text and interface resources used by the app.
- Keep device variants and substitutions intact. Localship currently models plain strings and
  one level of plural string units. Advanced entries remain in the catalog but block strict
  completeness checks. Handle them in Xcode and report that Localship cannot certify the whole
  catalog; do not set `shouldTranslate: false` merely to bypass validation.
- Generated symbols are optional: preserve the project's chosen extraction/manual-key workflow.
  Review generated comments for accurate context. Native Xcode agent tools can prepare catalogs
  and preview translations; align them with the project's terminology and review their edits.

Official references:

- [String Catalogs, plurals and device variants](https://developer.apple.com/documentation/Xcode/localizing-and-varying-text-with-a-string-catalog)
- [Compiler extraction, bundles and substitutions](https://developer.apple.com/videos/play/wwdc2023/10155/)
- [Xcode 26 comments, symbols and resource bundles](https://developer.apple.com/videos/play/wwdc2025/225/)
- [Generated localizable symbols](https://developer.apple.com/documentation/xcode/using-generated-localizable-symbols-in-your-code)
- [Xcode 27 agent localization and visual review](https://developer.apple.com/videos/play/wwdc2026/213/)

## Release verification

1. Run Localship validation; review errors, warnings and coverage gaps. After approving the
   selected locales, run `localship validate --require-approved --locale <locales>`.
2. Run the native build and applicable Android lint tasks. Resolve missing defaults and wrong
   target/bundle membership. File validation cannot replace these checks.
3. Exercise pseudolocales and actual languages: long text, tall scripts, RTL and large system
   text sizes. Look for clipping, incorrect alignment, inaccessible labels and layout changes.
4. Check plural boundaries appropriate to each locale, signed/zero amounts, mixed-script names,
   and date/calendar/number formatting. Preserve user-entered content.
5. Test language switching, navigation, notifications, widgets and cached/seeded labels where
   the app has them. Get native-speaker feedback on meaning and tone.

Report which checks ran and which could not. Approval records do not prove linguistic quality,
and a passing check for supported files does not establish correct runtime behavior.
