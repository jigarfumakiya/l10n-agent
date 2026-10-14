# Landscape research (2026-10-14)

What exists for AI-driven app localization, how each product works, and what we
copy or beat. Sources are listed at the bottom. Vendor claims were not
independently verified unless noted.

## 1. Four kinds of product

### A. Translation management systems (TMS) with an MCP front end
**Lokalise, Crowdin, Tolgee, Phrase, Locize, SimpleLocalize.**

- **How it works:** your strings live in their cloud. The MCP server is a remote API
  to that cloud: keys, languages, tasks, glossaries, screenshots, MT jobs, members.
  Auth is OAuth or a token.
- **Tool design:** grouped into sets by role so agents don't see hundreds of tools.
  - Crowdin offers project-manager, developer, translator and asset-manager sets,
    picked with a `crowdin-tool-sets` header.
  - Lokalise offers `lokalise_pm` and `lokalise_sd`.
  - Tolgee only offers `/mcp/developer` so far.
- **Strengths:** human-translator workflows, translation memory (TM), screenshots for
  context, tasks, reports, enterprise features.
- **Weaknesses for an indie mobile developer:**
  - Pricing starts around $25–120 a month and grows with seats and words.
  - Strings are copied out of the repo, so there are two sources of truth and sync jobs.
  - Screenshots are uploaded and tagged by hand.
  - The agent manages the TMS. It doesn't fix your code.
  - Tolgee is open source, but it's a self-hosted server and web-first.

### B. Translation engines: Lingo.dev
- **Open-source CLI (Apache-2.0):** `lingo init / link / push / pull`. It now talks to
  the hosted **localization engine**, picked by `engineId` in `.lingo/config.json`.
  It reads 18 formats, including Android and Xcode strings.
- **The paid engine (Production plan $99/mo, LLM cost passed through) holds the intelligence:**
  - Brand voice per locale (e.g. formal German, informal Italian).
  - Glossaries matched semantically, and locale-scoped rules.
  - **Model routing per locale pair with ranked fallbacks.**
  - **AI reviewers** with criteria, an evaluator model and a sampling rate, plus
    glossary-compliance and rule-adherence reports.
  - Request logs, and creating an engine from links: AI pulls the voice, glossary and
    rules out of your site.
- **The MCP server configures the engine** (glossary, voice, rules, models, reviewers,
  spot-checks, engine comparisons). It is not about your code.
- **Also:** a GitHub App and an Action that open translation PRs on push. The lockfile
  holds checksums so only changed text is retranslated.
- **Takeaway:** the best *quality system* in the market, but it's server-side and paid.
  The open-source part is a client.

### C. Mobile-specific SaaS
**strings.dev, String Catalog, StringLocal, XStringer, LocaFlow, xcLocalize.**

- **strings.dev:**
  - Upload `.xcloc` or `strings.xml` and get translations back in 52 locales.
  - Your **app description goes into every request**, with per-string notes.
  - Brand phrases are protected by placeholders; URLs, emails and handles are kept.
  - A QA dashboard handles retrying failures.
  - CLI scripts, REST, and a thin MCP server (`strings-mcp-server`: status, upload,
    export), plus a **generated AI-skill prompt**.
  - Free for 1 language; $10–20/mo per app; $225/mo for the top tier.
- **String Catalog (the strongest mobile product):**
  - **Git-native:** connects to GitHub, GitLab or Bitbucket, opens PRs, and your repo
    stays the source of truth.
  - Edits `.xcstrings` and `strings.xml` in place in their native shape.
  - Shows **AI confidence per key** with retry for low-confidence keys.
  - Tone guidance and protected brand terms.
  - **Review links that need no login**, review queues and bulk accept.
  - **Translates store metadata within each store's field limits, plus release notes.**
  - A free `.xcstrings` editor. Priced by a calculator.
- **Weaknesses across this group:**
  - Every one is a hosted service.
  - Context is only an app blurb and notes. None reads your code.
  - None moves hardcoded strings into resources.
  - None checks how translations look on screen.

### D. Open-source local tools
- **xcstrings-mcp** (Rust, MIT/Apache-2.0, iOS only). The best-designed open-source
  tool, and the pattern to copy:
  - **The host model translates.** The server hands out batches of 50–100 keys,
    validates them and saves them as **drafts**. A separate `approve` step follows,
    and the docs warn against auto-approving to reach 100%.
  - A sidecar file stores **source snapshots**, so edited source text marks its
    translations stale.
  - The writer preserves Xcode's formatting byte for byte (`" : "`, key order,
    unknown fields kept), writes atomically, and drops the BOM.
  - CLDR 48 plural checks; format-argument checks that block mismatches; `%` in prose
    only warns; glossary checks that only advise.
  - Three-way merge guarded by fingerprints; XLIFF 1.2 round trip; import of legacy
    `.strings` and `.stringsdict`.
  - 32 tools, 12 CLI commands (`--json`, `--dry-run`), and 8 **MCP prompts**
    (translate_batch, review, audit, fix_validation_errors, add_language,
    extract_strings, cleanup_stale…).
  - The layers are `server → tools → service → model`, with file access injected.
- **android-llm-localization** (MIT, Android only): translates `strings.xml` through
  Gemini, OpenAI, Anthropic or Ollama. It's a simple script; iOS is on its roadmap.
- **Various Python and desktop scripts:** these call one provider and do no checking.

## 2. The gap

Nothing is **local-first, agent-native and covering both Android and iOS**.
Specifically, nothing combines:

1. **Your repo as the source of truth**, with no server and no account.
2. **Any model:** the coding agent's own model, or bring-your-own-key in CI.
3. **Making the code localizable** (extraction, plurals, formatters), not only
   translating files that are already clean.
4. **Context taken from the code itself.** Cloud tools can't see the code. We can.
5. **Lingo-grade quality** (voice, rules, model routing, AI review) for free and on disk.
6. **Visual QA:** render each translated screen and catch truncation and RTL breakage.
7. **Store listings and release notes**, in the same tool and under the same glossary.

## 3. What we copy and from whom

| From | Copy |
|---|---|
| xcstrings-mcp | Host model translates with batches → validate → draft → approve; sidecar source snapshots; Xcode-identical writer; fingerprint-guarded writes; MCP prompts; `--json` / `--dry-run`; layered core with injected file access; XLIFF round trip |
| Lingo.dev | Lockfile checksums; one config holding voice, glossary, rules and **model routing per locale**; **AI reviewers with reports**; drafting voice and glossary from links and the README; Action that opens translation PRs |
| String Catalog | Git-native PR flow; confidence per key; **review without login**; store metadata with field limits; release notes |
| strings.dev | Product brief in every request; protecting brand terms, URLs and handles; a generated skill prompt for clients that don't install skills |
| Crowdin / Lokalise | **Toolsets by role** so the MCP stays small (dev / translate / review / store) |

## Sources
- [Lokalise: MCP for localization](https://lokalise.com/blog/mcp-for-localization/)
- [Crowdin MCP Server docs](https://support.crowdin.com/developer/crowdin-mcp-server/)
- [Tolgee MCP server docs](https://docs.tolgee.io/platform/integrations/mcp_server/about) · [tolgee-platform](https://github.com/tolgee/tolgee-platform)
- [Lingo.dev repo](https://github.com/lingodotdev/lingo.dev) · [Lingo MCP](https://lingo.dev/en/docs/platform/mcp) · [MCP capabilities](https://lingo.dev/en/docs/mcp/capabilities) · [Pricing](https://lingo.dev/de/pricing)
- [strings.dev features](https://www.strings.dev/features) · [pricing](https://www.strings.dev/pricing)
- [String Catalog](https://stringcatalog.com/)
- [xcstrings-mcp](https://github.com/Murzav/xcstrings-mcp)
- [android-llm-localization](https://github.com/BharathKmalviya/android-llm-localization)
- [Agent Skills standard across tools](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/)
- [Localization platforms compared (Locize)](https://www.locize.com/compare/localization-platforms)
