import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runInit } from "../cli/init-command.js";
import { addLocales, loadConfig } from "../core/config.js";
import { CONTEXT_FILES, writeContext } from "../core/context.js";
import { UserError } from "../core/errors.js";
import { type FileSystem, nodeFs } from "../core/fs.js";
import { openProject } from "../core/project.js";
import { computeStatus, ENTRY_STATES } from "../core/status.js";
import { validateProject } from "../core/validate.js";
import { approve, nextBatch, SubmissionSchema, submit } from "../core/workflow.js";
import { detect } from "../detect/detect.js";
import { TRANSLATION_RULES } from "../translate/prompt.js";
import { translateProject } from "../translate/translate.js";

export interface ServerOptions {
  /** Project directory used when a tool call doesn't name one. */
  cwd: string;
  version: string;
  fs?: FileSystem;
}

const cwdArg = z
  .string()
  .optional()
  .describe("Project directory (default: the directory the server was started in)");
const localesArg = z.array(z.string()).optional().describe('Locales, e.g. ["hi", "ar"]');
const targetsArg = z.array(z.string()).optional().describe("Only these target ids");
const keysArg = z.array(z.string()).optional().describe("Only these keys");
const statesArg = z.array(z.enum(ENTRY_STATES)).optional();

/** The MCP surface: thin wrappers over the same core functions the CLI uses. */
export function createServer(opts: ServerOptions): McpServer {
  const fs = opts.fs ?? nodeFs;
  const server = new McpServer(
    { name: "l10n-agent", version: opts.version },
    {
      instructions:
        "Localization for app projects (Android XML, gettext PO, Apple String Catalogs). Start with l10n_status; if there's no config, l10n_detect then l10n_init. Translate with l10n_next_batch → l10n_submit until nothing remains, then l10n_validate. Never edit translation files by hand when these tools can do it.",
    },
  );
  const dir = (cwd?: string) => path.resolve(opts.cwd, cwd ?? ".");
  const project = (cwd?: string) => openProject(fs, { cwd: dir(cwd) });

  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } = {},
  ) =>
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations },
      // biome-ignore lint/suspicious/noExplicitAny: the SDK's callback type is generic over the shape.
      (async (args: any) => {
        try {
          const out = await run(args);
          return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
        } catch (e) {
          if (!(e instanceof UserError)) throw e;
          return { content: [{ type: "text" as const, text: e.message }], isError: true };
        }
      }) as never,
    );

  tool(
    "l10n_status",
    "Translation progress per target and locale: how many strings are missing, stale, drafts, approved… Call this first.",
    { cwd: cwdArg, locales: localesArg },
    async ({ cwd, locales }) => {
      const p = await project(cwd);
      return {
        sourceLocale: p.config.sourceLocale,
        targets: p.targets.map((t) => ({
          id: t.target.id,
          format: t.target.format,
          path: t.target.label,
        })),
        status: computeStatus(p, locales).map(({ entries: _, ...s }) => s),
      };
    },
    { readOnlyHint: true },
  );

  tool(
    "l10n_validate",
    "Deterministic checks on source strings and translations: placeholders, plural forms, escaping, markup, glossary. ok is false when there are errors.",
    {
      cwd: cwdArg,
      locales: localesArg,
      strict: z
        .boolean()
        .optional()
        .describe("Untranslated strings and missing locales are errors"),
    },
    async ({ cwd, locales, strict }) => {
      const issues = validateProject(await project(cwd), { locales, strict });
      return { ok: !issues.some((i) => i.severity === "error"), issues };
    },
    { readOnlyHint: true },
  );

  tool(
    "l10n_detect",
    "Find translation files in a repo (Android res folders, .po files, String Catalogs) without writing anything.",
    { cwd: cwdArg },
    async ({ cwd }) => detect(fs, dir(cwd)),
    { readOnlyHint: true },
  );

  tool(
    "l10n_init",
    "Write l10n.config.yaml from what l10n_detect found. Ask the user which setups and languages they want first.",
    {
      cwd: cwdArg,
      accept: z
        .array(z.number().int().min(1))
        .optional()
        .describe("Setup numbers from l10n_detect (default: the confident ones)"),
      source: z.string().optional().describe("Source language (default: detected)"),
      locales: z.array(z.string()).describe("Languages to translate into"),
      force: z.boolean().optional().describe("Replace an existing config"),
    },
    async ({ cwd, accept, source, locales, force }) => {
      const out: string[] = [];
      const err: string[] = [];
      const code = await runInit(
        fs,
        { cwd: dir(cwd), yes: accept === undefined, accept, source, locales, force },
        {
          interactive: false,
          log: (l) => out.push(l),
          error: (l) => err.push(l),
          ask: async (_q, f) => f,
        },
      );
      if (code !== 0) throw new UserError(err.join("\n") || out.join("\n"));
      return { ok: true, output: out.join("\n") };
    },
  );

  tool(
    "l10n_add_locales",
    "Add languages to translate into (BCP 47 codes such as hi, ar, pt-BR) to the project config.",
    { cwd: cwdArg, locales: z.array(z.string()).min(1) },
    async ({ cwd, locales }) => {
      const { file } = await loadConfig(fs, dir(cwd));
      return addLocales(fs, file, locales);
    },
  );

  tool(
    "l10n_get_context",
    "The project's translation brief, voice per locale and glossary.",
    { cwd: cwdArg },
    async ({ cwd }) => {
      const p = await project(cwd);
      return { folder: path.relative(p.root, p.context.dir) || ".", ...p.context, dir: undefined };
    },
    { readOnlyHint: true },
  );

  tool(
    "l10n_update_context",
    `Write the brief (${CONTEXT_FILES.brief}: what the app is, audience, tone), voice per locale (voice/<locale>.md, or voice/all.md for every locale) and/or the glossary (replaces the whole list). Use when you can't edit files directly.`,
    {
      cwd: cwdArg,
      brief: z.string().optional(),
      voice: z.record(z.string(), z.string()).optional().describe('Locale or "all" → guidance'),
      glossary: z
        .array(
          z.object({
            term: z.string(),
            translate: z.boolean().optional().describe("false: keep as written (brand names)"),
            translations: z.record(z.string(), z.string()).optional(),
            note: z.string().optional(),
            caseSensitive: z.boolean().optional(),
          }),
        )
        .optional(),
    },
    async ({ cwd, ...update }) => {
      const p = await project(cwd);
      return { written: await writeContext(fs, p.context.dir, update) };
    },
  );

  tool(
    "l10n_next_batch",
    `The next strings that need translating, with everything needed to translate them well. Translate them yourself, then send them to l10n_submit. Repeat until remaining is 0.

Rules:
${TRANSLATION_RULES}`,
    {
      cwd: cwdArg,
      locales: localesArg,
      targets: targetsArg,
      keys: keysArg,
      states: statesArg.describe("Which entries (default: missing, stale)"),
      limit: z.number().int().min(1).max(200).optional().describe("Default 40"),
      offset: z.number().int().min(0).optional(),
    },
    async ({ cwd, ...o }) => nextBatch(await project(cwd), o),
    { readOnlyHint: true },
  );

  tool(
    "l10n_submit",
    "Check translations and write the ones without errors as drafts. Rejected ones come back with the errors to fix; resubmit just those. value is a string, an object of plural forms, or an array, matching the item's kind.",
    {
      cwd: cwdArg,
      translations: z.array(SubmissionSchema),
      model: z.string().optional().describe("Your model name, kept in the lockfile"),
      force: z
        .boolean()
        .optional()
        .describe(
          "Replace hand edits and reviewed or approved translations. Only when the user asks.",
        ),
      dryRun: z.boolean().optional(),
    },
    async ({ cwd, translations, ...o }) => submit(await project(cwd), translations, o),
  );

  tool(
    "l10n_approve",
    "Mark drafts approved (or reviewed). Only when the user says so, after they've seen the translations.",
    {
      cwd: cwdArg,
      locales: localesArg,
      targets: targetsArg,
      keys: keysArg,
      from: statesArg.describe(
        "Which entries (default: draft, reviewed). untracked adopts existing translations; edited accepts hand edits",
      ),
      reviewed: z.boolean().optional().describe("Mark reviewed instead of approved"),
      dryRun: z.boolean().optional(),
    },
    async ({ cwd, from, reviewed, ...o }) =>
      approve(await project(cwd), { ...o, states: from, to: reviewed ? "reviewed" : "approved" }),
  );

  tool(
    "l10n_translate",
    "Translate everything missing with a separate model API (configured under models: in l10n.config.yaml, or pass model as provider:model). Use for large catalogs; needs the provider's API key in the environment.",
    {
      cwd: cwdArg,
      locales: localesArg,
      targets: targetsArg,
      keys: keysArg,
      model: z.string().optional().describe("provider:model, e.g. anthropic:claude-sonnet-5-5"),
    },
    async ({ cwd, targets, ...o }) => translateProject(await project(cwd), { ...o, targets }),
  );

  for (const name of ["l10n-setup", "l10n-extract", "l10n-translate", "l10n-review"] as const) {
    const skill = readSkill(name);
    if (!skill) continue;
    server.registerPrompt(name, { description: skill.description }, () => ({
      messages: [{ role: "user", content: { type: "text", text: skill.body } }],
    }));
  }

  return server;
}

/** Skill files ship with the package; MCP prompts serve the same text to clients without skills. */
function readSkill(name: string): { description: string; body: string } | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, "skills", name, "SKILL.md");
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      const description = /^description:\s*(.+)$/m.exec(m?.[1] ?? "")?.[1]?.trim() ?? name;
      return { description, body: (m?.[2] ?? text).trim() };
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export async function runServer(opts: ServerOptions): Promise<void> {
  const server = createServer(opts);
  await server.connect(new StdioServerTransport());
}
