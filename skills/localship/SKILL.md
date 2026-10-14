---
name: localship
description: Handle any request to localize an app with Localship — "translate this app to Hindi", "add French", "localize the app", "update the translations". Shows one short plan, waits for the user to say the confirm phrase, then does everything end to end. Use this first for direct requests; the other localship-* skills are the detailed playbooks it follows.
---

# Localize an app with Localship: plan once, then do it all

The user wants their app translated with as little back-and-forth as possible. Make every
choice that has a sensible default, show it once, and after they confirm, don't stop to ask
again unless something is genuinely blocked.

## Tools

Use the `localship_*` MCP tools when available. Otherwise the CLI: `localship plan`,
`localship start`, `localship next-batch`, `localship submit` (install once with
`npm install -g github:jigarfumakiya/localship` if it's missing).

## 1. Plan (one tool call, one message)

Call `localship_plan` with the languages from the request, as names or codes
(`["Hindi"]`, `["hi", "ar"]`). Then reply with a short message, at most about 10 lines:

- **What I found:** the files, how many strings, and anything in the way (the plan's `blockers`).
- **What I'll do:** the plan's `steps`, briefly.
- **Defaults:** voice per language and names kept as written (the plan's `defaults`). Say
  they can change any of them in their reply.
- End with: **Say "<confirm>" to go.** (Use the plan's `confirm` phrase exactly.)

If `confirm` is empty, explain the blocker plainly instead (for example, an unsupported
format) and stop. If the request names no language, ask which ones in the same message.

Check `git status` before planning. If there are uncommitted changes, mention it in the plan:
the user should be able to tell your changes from theirs.

## 2. Do it (after they say the confirm phrase)

Follow the plan's steps in order without asking more questions. Apply any defaults they changed.

1. **Blockers first.** For `mostly-hardcoded`: create a branch (`localization`), then follow the
   `localship-extract` skill to move the text into resources, building as you go. For a large
   app, do it feature by feature, and give a one-line progress update after each.
2. **Set up:** `localship_start` with the languages (plus `voice` or `keepAsWritten` if the user
   changed them). It writes the config, voice notes and glossary.
3. **Brief:** if there's none, write `.localship/brief.md` (or `localship_update_context`) from
   the README and strings: what the app does, who it's for, its tone, in a few lines.
4. **Translate:** follow the `localship-translate` skill's loop (`localship_next_batch` →
   translate → `localship_submit`, fix rejections) until `remaining` is 0 for every language.
   For thousands of strings with a model configured, `localship_translate` is faster.
5. **Check:** `localship_validate` must show no errors.
6. **Report** in a few lines: strings translated per language, anything held for review or
   failed, the brief and glossary you wrote (so they can adjust them), and the next step:
   review the drafts (the `localship-review` skill), then approve.

Stop and ask only if something blocks progress: the build breaks during extraction and the
fix isn't obvious, a tool keeps failing, or a choice would change the app's behavior.

## Other requests

- **"Add <language>":** same flow; the plan shows only the new language's work.
- **"Update the translations" / copy changed:** same flow; the plan counts missing and stale
  strings. Hand-edited translations are held for review, never replaced.
- **"What's the status?":** `localship_status` (or `localship_detect` without a config). No plan needed.
- **"Review" / "approve":** the `localship-review` skill.

Never approve drafts on your own, and commit nothing unless the user asks.
