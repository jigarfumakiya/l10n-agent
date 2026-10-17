# Localship plugin review

Reviewed October 17, 2026, against this repository and the primary sources linked below.
Competitor capabilities describe their documented offerings, not a hands-on quality benchmark.

## Where Localship fits

Localship's strongest positioning is **localization inside your existing coding agent, with
checks and approval state kept in Git**. Its useful audience is individual developers and small
teams shipping Android, Apple or gettext apps who want to use their existing AI workflow without
operating a separate localization platform.

The implementation supports that positioning: adapters preserve native files, the core validates
submissions before writing them, batches include code usage and terminology, and the lockfile
tracks source changes and protects hand edits. CLI and MCP share the same core. The agent skills
guide setup, extraction, translation and review.

## Comparison

| Tool | Documented strengths | Implication for Localship |
|---|---|---|
| [Lingo.dev](https://github.com/lingodotdev/lingo.dev) | Hosted localization engines with model routing, brand voice, glossary, AI reviewers, broad format support, CLI/MCP and GitHub automation | Closest overlap in AI translation. Context, glossaries and model choice alone are not differentiation. Focus on using the developer's existing agent and keeping workflow state in the repo. |
| [Crowdin MCP](https://store.crowdin.com/crowdin-mcp-server) and [skills](https://support.crowdin.com/developer/crowdin-skills/) | Agent access to a Crowdin workspace, role-based tools, and repository skills for its CLI and GitHub Action | MCP plus skills is already a category pattern. Localship's distinction is working without a Crowdin-style account or platform. |
| [Lokalise MCP](https://docs.lokalise.com/en/articles/13547066-setting-up-and-using-the-lokalise-mcp-server) | Cloud-hosted project and developer toolkits for keys, languages, tasks, glossary and screenshot context; requires a plan with API access | A stronger fit for teams already using a managed localization workspace. Localship can offer a simpler repo workflow, but currently lacks comparable collaboration and screenshot context. |
| [i18n Ally](https://github.com/lokalise/i18n-ally) | VS Code extension with inline annotations, extraction, missing-translation reporting, translation editor and review UI | A close alternative for developers who prefer visual editing. Localship's CLI/MCP works across agents, but human review is less convenient without an editor. |
| [Xcode 27](https://developer.apple.com/videos/play/wwdc2026/213/) | Native agent localization with project preparation, contextual batches, language guidance and preview-based review | A direct alternative for Apple-only projects. Localship's stronger distinction is shared Android/Apple/gettext checks, repository approval history and use across editors; generic agent translation alone is not enough. |

These tools overlap with Localship in different ways; none of the source material establishes
that Localship produces better linguistic translations. That would require a shared test corpus
and independent language review.

## Improvement implemented

Before this review, `validate --strict` could succeed for a complete, mechanically valid translation
that was still a draft, or had become outdated after approval. `status` knew about those states,
but validation did not enforce them. Native resource files can ship while still awaiting review.

`validate --require-approved`, also exposed through MCP, now checks completeness and current
approval alongside the existing content checks. It rejects stale source hashes, edited translation
hashes, untracked translations and pending reviews. Native review flags also reopen approval when
the text has not changed. The check reads files without calling a model or changing translations.

This makes the existing approval workflow enforceable in CI. It remains an opt-in policy, and it
does not turn an approval record into proof of translation quality. See [CI setup](reference.md#release-checks-in-ci).

A subsequent platform audit found coverage gaps inherited by that check. Strict/release validation
now rejects unsupported Apple variants and Android configurations, rather than silently ignoring
them, and catches missing Android defaults. The agent guides now cover current platform setup and
RTL practices. Advanced-format support and native build/device checks remain separate work.

## Recommended next investments

1. **Complete existing platform coverage.** Model Apple substitutions/device variants and Android
   configurations without losing their structure. Strict checks now report these gaps honestly.
2. **Flutter ARB, then JSON/i18next support.** Both are absent today. ARB is the closest extension
   of the mobile focus; JSON expands the reachable audience substantially. Preserve ICU messages,
   metadata and formatting before advertising either format as supported.
3. **A local human review page.** Show source, translation, changed source text, context and QA
   findings together. Reuse the existing submit/approve functions for changes. This would reduce
   the effort of reviewing dozens of locales without introducing a hosted service.
4. **Screenshot context and layout checks.** The current length checks are heuristics; they do not
   establish whether text fits on screen or whether an RTL layout works. Start by attaching screen
   context to keys, then add reproducible device checks.
5. **Publish a reproducible evaluation.** Include Android, String Catalog and PO examples with
   seeded placeholder failures, plurals, ambiguous labels, source changes and hand edits. Measure
   caught defects, missed defects, review effort and model usage; use human review for meaning.

The README's privacy language was also corrected: local files and no Localship service do not
mean a cloud coding agent keeps translation content on the device. That depends on the AI chosen.
