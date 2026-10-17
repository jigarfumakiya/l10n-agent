---
name: localship
description: Handle any request to localize an app with Localship — "translate this app to Hindi", "add French", "localize the app", "update the translations". Does what was asked end to end and reports, stopping only when something is in the way. Use this first for direct requests; the other localship-* skills are the detailed playbooks it follows.
---

# Localize an app with Localship

Do what the user asked, all of it, and nothing they didn't ask for. Don't ask for a go-ahead
on a normal request; stop only when something is genuinely in the way.

## Tools

Use the `localship_*` MCP tools when available. Otherwise the CLI: `localship plan`,
`localship start`, `localship next-batch`, `localship submit` (install once with
`npm install -g localship` if it's missing).

## 1. Look

Check `git status`; if there are uncommitted changes, mention them so the user can tell your
changes from theirs. Then call `localship_plan` with the languages from the request, as names or
codes (`["Hindi"]`, `["hi", "ar"]`). It writes nothing.

Stop and ask only when:
- **`blockers`**: no language named, a format Localship can't translate, an empty String
  Catalog, or no translation files at all. Say what's in the way and what would get past it.
- **`warnings`**: another tool (Crowdin, an over-the-air SDK…) already manages translations.
  Writing files could clash with it; ask whether to go ahead.

Otherwise carry on. Tell the user in one line what you're about to do, e.g. "Translating 412
strings into Hindi and Arabic." If the plan has `notes` (text still in the code), mention them in
that line too: those strings won't be translated unless the user asks you to move them.

## 2. Do it

1. **Set up:** if the languages aren't configured yet, `localship_start` with them. It writes
   only the config.
2. **Translate:** follow the `localship-translate` skill's loop (`localship_next_batch` →
   translate → `localship_submit`, fix rejections) until `remaining` is 0 for every language.
3. **Check:** `localship_validate` must show no errors.

## 3. Report

In a few lines:
- strings translated per language, and anything that failed or was held for review;
- what translators went by: each language's voice (the project's, or the usual convention the
  batch gave as `defaultVoice`, e.g. "addressed the user as आप") and names kept as written, so
  the user can correct them;
- the plan's notes, such as text still in the code;
- next step: review the drafts (the `localship-review` skill), then approve.

If the user asks for something different (another formality, a brief, a glossary term), write it
with `localship_update_context` or the files in `.localship/`, and redo what it affects.

## Only when the user asks

- moving hardcoded text into resources (the `localship-extract` skill);
- creating a branch, committing or pushing;
- writing a brief, voice notes or glossary;
- translating through a model API (`localship_translate`): cloud providers bill per use;
- approving drafts, pruning, removing or `--force` (these change or delete people's work).

## Other requests

- **"Add <language>" / "Update the translations":** the same flow; the plan counts missing and
  stale strings. Hand-edited translations are held for review, never replaced.
- **"What's the status?":** `localship_status` (or `localship_detect` without a config).
- **"Review" / "approve":** the `localship-review` skill.
- **"Set up localization":** the `localship-setup` skill.
- **"Make the app localizable" / "find hardcoded strings":** the `localship-extract` skill.
