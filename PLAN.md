# l10n-agent — product and build plan

> Working name. Local-first, agent-native localization for apps.
> **Your repo is the translation system. Your model is the translator.**

The competitor analysis is in [RESEARCH.md](RESEARCH.md). This plan builds the
open-source tool that fills the gap found there. It is developed against real apps
(dogfooding), which stay users of the tool and never become part of it.

---

## 1. What "the full picture" means

Localizing a mobile app is a lifecycle, not a translate button. Paid tools each cover
part of it. We cover all of it, locally:

| # | Stage | What has to happen | Who covers it today |
|---|---|---|---|
| 1 | **Make the code localizable** | Move hardcoded text to resources, turn counts into plurals, use formatters, check RTL, add a per-app language setting | Nobody for mobile |
| 2 | **Source strings** | Keys, comments, removing duplicates, renames, stale cleanup | TMS products, xcstrings-mcp (iOS) |
| 3 | **Context** | Product brief, voice, glossary, where each string appears and its role, screenshots | Lingo (voice and glossary), TMS (manual screenshots) |
| 4 | **Translation** | Any model, routed per locale, reusing earlier translations, protecting placeholders | Everyone, mostly hosted |
| 5 | **Checks** | Placeholders, plurals, escaping, length, terminology | xcstrings-mcp, strings.dev |
| 6 | **Quality review** | AI reviewer scores, then a human pass where it matters | Lingo (paid), String Catalog (review links) |
| 7 | **Visual QA** | Render each translated screen and catch truncation, overlap and RTL mirroring | Nobody |
| 8 | **Continuous sync** | Every PR's new strings translated and checked in CI | Lingo GitHub App, String Catalog |
| 9 | **Store presence** | Listing text within each store's limits, release notes, screenshots | String Catalog (text only) |

## 2. Where we beat the paid tools

1. **No server, no account, no per-word price.** Files stay in git. The only cost is
   your own model tokens.
2. **Code-aware context.** We can see the code, so every string comes with its usage
   site, UI role (button, title, accessibility label…), screen, nearby strings and a
   length budget. Cloud tools only get an app blurb and manual notes.
3. **Extraction.** The agent makes the app localizable first, guided by a skill and
   checked by the tool. Most indie apps start with hardcoded text.
4. **Lingo-grade quality, free and on disk.** Voice per locale, rules, glossary,
   model routing per locale, and an AI reviewer with scores and reports, all as files.
5. **Visual QA in a closed loop.** Screenshots are rendered from Compose previews and
   SwiftUI previews or snapshot tests, and strings are mapped to screen positions
   automatically (§6.6). Paid tools need screenshots uploaded and tagged by hand.
6. **One project for both platforms.** Shared glossary and translation memory, so the
   same copy on Android and iOS is translated once.
7. **Every way an agent connects.** CLI, MCP server, Agent Skills (SKILL.md), MCP
   prompts, and a GitHub Action, all from one package.

**What we copy directly instead of reinventing:**
- From xcstrings-mcp: its draft → approve model, source snapshots, Xcode-identical
  writer and MCP prompts.
- From Lingo: its lockfile, config layers, model routing and AI reviewers.
- From String Catalog: its PR flow, confidence per key, review without login and
  store limits.
- From Crowdin: toolsets grouped by role.

The details are in RESEARCH.md §3.

## 3. Principles

- **The core owns correctness; the model owns judgment.** Any rule code can check is
  checked in code, not stated in a prompt.
- **The CLI comes first.** Every operation is a CLI command with `--json` and
  `--dry-run`. MCP tools, skills and the Action are thin layers over it.
- **No AI call in the core.** Only `providers/` talks to models, and only in delegated
  or CI mode.
- **Never lose a human's work.** Hand edits are detected and kept. Writes are atomic
  and guarded by fingerprints.
- **Native files, native formatting.** Output matches what Android Studio and Xcode
  write, so diffs stay small and reviewable.
- **Nothing app-specific in the tool.** Anything an app needs that's general goes in
  as a feature; the rest stays in that app's config.

## 4. Architecture

```
                 ┌─────────── surfaces ────────────────────────────────────────┐
 Agent Skills    │ skills/*.md  (Claude Code, Codex, Gemini CLI, Cursor…)      │
 MCP             │ `l10n mcp`: toolsets + prompts + resources                  │
 CI              │ GitHub Action: validate / translate / open PR               │
 Humans          │ `l10n` CLI · static review page (HTML, no login)            │
                 └──────────────────────────┬──────────────────────────────────┘
                                            ▼
 core (plain TypeScript, file access injected so it's testable and embeddable)
 ├─ formats/      android-xml · xcstrings · fastlane-metadata · (later) ARB, i18next, xliff
 ├─ model/        Catalog → Entry → Message (text | plural | array | select), Placeholder
 ├─ state/        lock (source/target hashes, states) · memory (cross-platform) · glossary · voice · rules
 ├─ context/      product brief · usage scanner · UI-role inference · screenshot map
 ├─ checks/       deterministic checks → errors / warnings with machine-readable codes
 ├─ review/       AI-review rubric, scores, reports, review page generator
 ├─ extract/      Kotlin and Swift hardcoded-string scanner, add-source, key naming
 └─ providers/    Anthropic · OpenAI-compatible (OpenRouter, Ollama, LM Studio) · Google
```

**Stack:**
- TypeScript on Node ≥ 22, published as one npm package (`npx <name> …`).
- tsup, vitest, biome.
- `@modelcontextprotocol/sdk` and the Vercel `ai` SDK for providers.
- `Intl.PluralRules` for CLDR plural categories, with no extra dependency.

**Three ways to translate, one pipeline**
`next-batch → (translate) → submit → checks → draft → review → approve`

| Mode | Who translates | Use when |
|---|---|---|
| Agent | The coding agent's own model (`next_batch` / `submit`) | Small batches, interactive work, models without an API key |
| Delegated | `l10n translate` calls the configured provider and routes per locale, in parallel | Large catalogs. Keeps the agent's context clean; the agent only handles flagged items |
| CI | Same as delegated, inside the Action | New strings in every PR |

## 5. Files in an app repo

```
l10n.config.yaml
.l10n/
  brief.md          what the app is, audience, tone. Drafted by the setup skill from README and store listing
  voice/            <locale>.md: formality, tone, things to avoid (e.g. German du vs Sie)
  glossary.yaml     do-not-translate terms + fixed translations per locale, matched case- and Unicode-aware
  rules.yaml        locale-scoped rules ("hi: use Indian numbering words", "ar: Eastern digits off")
  lock.json         per locale, per key: sourceHash, targetHash, state, score, model
  memory.json       translation memory keyed by normalized source text (shared across platforms)
  screens/          optional screenshot map (key → screen, bounding box)
```

```yaml
# l10n.config.yaml (an Android app)
sourceLocale: en
locales: [hi, ar]
targets:
  - format: android-xml
    res: app/src/main/res
  - format: fastlane-metadata
    path: fastlane/metadata/android
models:                       # routing for delegated/CI mode, with ranked fallbacks
  default: [anthropic:claude-sonnet-5-5, openai:gpt-…]
  ar: [anthropic:claude-opus-5-5]
review:
  model: anthropic:claude-opus-5-5
  sample: 1.0                 # share of strings reviewed
  autoApproveAbove: null      # off by default; drafts need an explicit approve
memory:
  import: [../ios/.l10n/memory.json]   # reuse iOS translations
```

**Entry states:**
- The normal path is `missing → draft → reviewed → approved`.
- Changed source text sets `stale`. A target edited outside the tool sets `human`,
  which is kept and never overwritten.
- `score` and `model` are recorded so a later report can show why an entry needs a look.
- **Android has no "unreviewed" flag in its files.** Drafts are written to
  `values-xx/` and will ship. `status` and CI can block a release on unapproved
  entries if the config asks.
- In xcstrings, drafts use `needs_review` and approved entries use `translated`.

## 6. Features in detail

### 6.1 Setup (`l10n init` + setup skill)
- Detect platforms and resource locations, and write the config.
- Draft `brief.md`, `voice/*.md` and an initial glossary from the README, store
  listing and repeated product nouns, as Lingo does from links. You review them.
- Turn on per-app language selection:
  - Android: `androidResources { generateLocaleConfig = true }` plus
    `res/resources.properties`.
  - iOS: known regions in the project or XcodeGen spec.

### 6.2 Extraction (makes the app localizable)
- `scan-code` lists candidates with `file:line`, snippet, a confidence score and the
  reason it was flagged.
  - **Kotlin:** `Text("…")`, `text=` / `label=` / `title=` / `contentDescription=`
    literals, string templates, `if (n == 1) "x" else "xs"` patterns,
    `Toast` / notification / Glance text.
  - **Swift:** `Text(variable)` with `String` variables, view-model `String`
    properties shown in the UI, and notification and widget text.
    (`Text("literal")` is already localizable once a catalog exists.)
- `add-source` adds a string to `values/strings.xml`. It suggests a key name from the
  screen and role, rejects duplicates, and suggests reusing an existing key that has
  the same text. Comments are required.
- The skill holds the rewrite rules:
  - Compose: `stringResource` or `pluralStringResource`. Outside composables, pass a
    `@StringRes` int or use `context.getString`.
  - Swift: `String(localized:comment:)` or `LocalizedStringResource`.
  - Never concatenate strings. Money, dates and numbers go through formatters.
  - Never extract analytics events, log tags, preference keys, routes, test tags or ids.
- **Done is checked automatically.**
  - Android: run the `en-XA` pseudolocale (its rendered text is marked) and take a
    screenshot. Any plain English left over was missed.
  - iOS: use the "accented pseudolanguage" launch argument.

### 6.3 Translation
- `next-batch` returns 25–100 items per batch. Each item has: key, source, comment,
  placeholders, required plural categories, glossary hits, memory matches,
  **usage context** (screen, role, neighbors), length budget, and a screenshot crop
  when one is available.
- `submit` checks each entry, writes it as a draft, and returns errors per entry so
  the agent can fix them.
- `translate` (delegated mode) runs the same loop through providers with routing and
  fallbacks, retries rejected entries with the check errors attached, and records the
  model and cost.

### 6.4 Checks (deterministic, each with an error code)
- **All formats:** placeholders must be the same set and positional-safe; protected
  tokens (URLs, emails, @handles, brand terms) kept; glossary terms followed; empty
  or untranslated output; length against the budget; whitespace and newlines kept;
  `%` in prose only warns.
- **Android:**
  - Escaping: `'` `"` `\@` `\?`, `&amp;`, CDATA blocks, and `<xliff:g>` kept.
  - `%1$s` positional placeholders when there is more than one.
  - Plural categories per locale (required ones are errors, extra ones warnings);
    `string-array` item counts match; `translatable="false"` skipped.
  - Locale folder names (`values-b+sr+Latn`).
  - Optional `aapt2 compile` gate.
- **xcstrings:**
  - Plural `variations` and `substitutions`; `shouldTranslate`; stale extraction state.
  - Xcode-identical writer (`" : "`, key order, unknown fields kept, no BOM),
    guarded by a fixture written by real Xcode.

### 6.5 Quality review
- **AI reviewer:** a separate model call scores each draft 0–100. The rubric is MQM
  in brief: accuracy, terminology, fluency, voice, locale conventions and fit. Each
  score comes with issues and a suggested fix.
- `review-queue` sorts by low score, low confidence, high visibility (paywall,
  onboarding) and long text. `approve` / `reject` work per key or in bulk.
- **Review page:** `l10n report --locale de` writes **one static HTML file**. It shows
  source, translation, score, issues and the screenshot crop, with inline edit and
  approve buttons. It exports a JSON patch that `l10n apply-review` reads back.
  A translator needs no account and no server.
- **XLIFF export and import** for professional translators.

### 6.6 Visual context and QA (the feature nobody else has)
- **Capture:**
  - Android: Compose Preview screenshot tests or Roborazzi.
  - iOS: SwiftUI previews or snapshot tests.
  - Each is run per locale with the project's existing setup. The tool plugs in; it
    doesn't require one framework.
- **Automatic string-to-screen mapping:**
  - Generate a private-use locale (`qaa`) where every string becomes a short id
    marker like `⟦k12⟧`.
  - Render, OCR the markers (Apple Vision on macOS, Tesseract elsewhere), and save
    `key → screen + box`.
  - That gives every string a screenshot crop for translators and reviewers, with no
    manual tagging. *This needs a research spike to confirm private-use locales
    render on both platforms.*
- **QA pass:**
  - Render each target locale and flag text that is cut off or ellipsized, text
    overflowing its container, and overlaps (the boxes from the mapping help).
  - For `ar` and `he`, also flag layouts that didn't mirror.
  - A vision model checks screenshots as a second pass.
  - Findings land in the review queue.

### 6.7 Store presence
- A fastlane `metadata/` adapter covering both stores. It's the format most pipelines
  already use.
- Field limits are checked:
  - App Store: name 30, subtitle 30, keywords 100 bytes, promo text 170,
    description 4000.
  - Play: title 30, short description 80, full description 4000, release notes 500.
- The same glossary and voice apply. **Keywords are adapted per market** (localized
  keywords, not literal translations), and the skill says so.
- Release notes per version.
- Optional push to the stores through the Play Developer API or App Store Connect API,
  done by the user's own pipeline.

### 6.8 Continuous sync
- A GitHub Action has two modes:
  - `validate`: fails the PR on errors or new hardcoded strings.
  - `translate`: translates new and stale entries, then commits to the PR or opens a
    follow-up PR, copying Lingo's two options.
- The `l10n-sync` skill handles the same thing locally: "localize what this branch added".

### 6.9 MCP surface (small, grouped by role)
- **Server:** `l10n mcp --toolsets core,dev,translate,review,store` over stdio.
  Remote HTTP comes later.

  | Toolset | Tools |
  |---|---|
  | core | `status`, `validate`, `list_locales`, `get_entry`, `search` |
  | dev | `scan_code`, `add_source`, `rename_key`, `find_usages`, `remove_stale` |
  | translate | `next_batch`, `submit`, `translate_delegated`, `add_locale` |
  | review | `review_queue`, `approve`, `reject`, `report` |
  | store | `store_status`, `store_next`, `store_submit` |

- **Prompts** mirror the skills, for clients without skill support: setup, extract,
  translate, review, sync, store.
- **Resources:** brief, voice, glossary, rules and status, readable without spending a
  tool call.

## 7. Phases

**Progress (2026-10-14):**
- **P0 done:** TypeScript, tsup, vitest, biome, MIT license, CI workflow and fixtures.
- **P1 core done:**
  - XML scanner that keeps offsets, and an android-xml reader and writer. The writer
    reproduces a locale file byte for byte.
  - All §6.4 Android checks, the lockfile and entry states, and the `status` and
    `validate` CLI.
  - 48 tests pass.
  - Ran against Material 3, AppCompat and RevenueCat UI from the Gradle cache:
    207 locale folders parse with 0 false errors. The remaining warnings are real
    upstream issues.
- **Pseudolocales:** Android (`en-XA`, `ar-XB`) and iOS already generate them, so there
  is no `pseudo` command. The extract skill turns on the built-in ones instead.
- **Core generalized for many formats (2026-10-14):**
  - Pluggable placeholder syntaxes (java, c, python, python-brace, java-message, qt, ruby,
    i18next).
  - Two plural models: CLDR categories, and numbered gettext forms described from the
    `Plural-Forms` formula, which has a safe parser with no `eval`.
  - Path patterns with `{locale}`, and gettext or BCP 47 locale spelling.
  - Native review states (`fuzzy` counts as a draft).
  - Each format opens a target object that holds its own state.
- **gettext PO format done:**
  - Writes unchanged blocks verbatim and wraps changed ones exactly like `msgcat`,
    measured in display columns.
  - Tested on Django admin's real files in 11 languages: every file round-trips byte for
    byte. It found a real Irish placeholder bug that `msgfmt --check` misses.
  - 105 tests pass.
- **Apple String Catalog (`.xcstrings`) done (2026-10-14):**
  - Order-preserving JSON that re-renders only the path to a change.
  - Tested on 9 real catalogs (CotEditor, WordPress, Blankie and others): every one
    round-trips byte for byte, and a full re-render from scratch matches what Xcode writes.
  - Apple placeholders, plural variations with Apple's optional `zero`, and
    `needs_review` counted as a draft.
  - Device variations and substitutions are skipped for now.
- **Plural checks refined across formats:**
  - Extra placeholders are allowed if any source form uses them.
  - A missing form is a warning when the app falls back to `other`, or when the form is
    only used for fractions.
  - 115 tests pass.
- **Next:**
  - `detect` and `init` (auto-detect formats, ask when unsure).
  - Then JSON and ARB.
  - Then String Catalog substitutions and device variations.
  - Then P4 (agent loop).

Every phase ends with something usable and is tried out on real apps. The order changed
on 2026-10-14: formats and detection come before the agent loop, so the tool works for
any project first. Day counts are rough focused-work estimates.

| Phase | Builds | Done when | Est. |
|---|---|---|---|
| **P0 Foundations** ✅ | Repo, CI, layout, fixtures | CI green | — |
| **P1 Core + Android** ✅ | model, android-xml read/write, checks, lock reading, `status` / `validate` | 0 false errors on AndroidX resources | — |
| **P1b Formats** ✅ | Pluggable placeholders and plural models, path patterns; gettext PO, Apple String Catalog | Byte-for-byte round trip on Django and real Xcode catalogs | — |
| **P2 Detect + init** | `l10n detect` (candidates with evidence and confidence), `l10n init` (interactive, `--json`, `--yes`) | Finds the right targets in sample Android, iOS, Django and Flutter repos | 2d |
| **P3 More formats** | JSON (flat, nested, i18next, ICU), Flutter ARB; String Catalog substitutions and device variations | Round trip on real files | 4d |
| **P4 Agent loop** | Lockfile writes, brief, voice, glossary, memory; `next-batch`, `submit`, drafts; skills `l10n-setup` + `l10n-translate` | An agent translates a sample app to `hi` and `ar` with 0 errors | 3d |
| **P5 Extraction** | `scan-code` (Kotlin, Swift), `add-source`, key naming, usage context; skill `l10n-extract`; pseudolocale check | A real app goes from hardcoded text to resources | 5d |
| **P6 MCP + delegated** | MCP server (toolsets, prompts, resources); providers, routing, `translate` | Works in Claude Desktop and Cursor | 3d |
| **P7 Quality** | AI reviewer, scores, review queue, static review page, XLIFF | A first locale ships in a real app | 4d |
| **P8 CI** | GitHub Action (`validate`, `translate`, PR modes) | Pull requests are gated on localization | 2d |
| **— v0.1 public release —** | Name check, docs, `examples/`, CONTRIBUTING, npm, `npx skills add`, MCP registry | | 3d |
| **P9 Store** | fastlane adapter, limits, keyword adaptation, release notes | Store listings localized | 3d |
| **P10 Visual** | capture hooks, id-marker mapping spike → mapping, truncation and RTL QA | Screenshot context in reviews | 6d |
| **Later** | Apple `.strings`/`.stringsdict`, Compose Multiplatform, XLIFF projects, VS Code panel, remote MCP | | — |

**Why release after P8:** by then the tool does the full loop that no free tool does:
detect, extract, translate, check, review and CI across formats. Store and visual QA
follow in 0.2 and 0.3 and give more reasons to announce.

## 8. How we'll know it works

- A real app goes from hardcoded text to localized: zero hardcoded UI strings
  (pseudolocale shows nothing missed), and `validate` clean on Android and iOS.
- A new string in a PR is translated, checked and reviewed with no manual steps.
- Cost per 1,000 strings per locale is measured and published in the README for a
  couple of model choices.
- AI review agrees with a human spot-check on a sample. We publish how we measured.

## 9. Risks for the tool

- **Writer fidelity** (Xcode JSON, Android XML comments and order) is what earns
  trust. Golden fixtures from real IDEs, and property tests on round trips.
- **Context window:** big catalogs swamp the agent. Batching and delegated mode
  solve this, and skills tell the agent to delegate above a size threshold.
- **The visual mapping spike may fail on one platform.** The fallback is screenshots
  per screen with a vision model matching strings, which is less exact.
- **Scope creep:** the order is mobile first, then web formats, and only when someone
  contributes them.

## 10. Decisions

Decided 2026-10-14:
1. **Name:** `l10n-agent` for now. Check for collisions before the public release.
2. **License:** MIT.
3. **First test locales:** `hi` (Devanagari, two plural forms, text grows long) and
   `ar` (right to left, all six plural forms). Together they test layout and plurals
   as hard as any pair can.

Still open:
4. **Visual QA scope for v0.1.** Ship the pseudolocale check only, and leave the full
   mapping for P10.
