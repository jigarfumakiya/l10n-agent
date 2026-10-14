import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { FileSystem } from "./fs.js";
import { PLACEHOLDER_SYNTAXES } from "./placeholders.js";

export const CONFIG_FILE = "l10n.config.yaml";

const locale = z.string().transform((s, ctx) => {
  try {
    return Intl.getCanonicalLocales(s)[0] as string;
  } catch {
    ctx.addIssue({ code: "custom", message: `Not a valid BCP 47 locale: "${s}"` });
    return z.NEVER;
  }
});

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, - and _")
  .optional();

const AndroidTargetSchema = z.object({
  id,
  format: z.literal("android-xml"),
  path: z.string(),
});

const PoTargetSchema = z.object({
  id,
  format: z.literal("po"),
  path: z
    .string()
    .refine((p) => p.includes("{locale}"), "Must contain {locale}, e.g. po/{locale}.po"),
  template: z.string().optional(),
  placeholders: z.enum(PLACEHOLDER_SYNTAXES).optional(),
  pluralForms: z.record(z.string(), z.string()).optional(),
});

const XcstringsTargetSchema = z.object({
  id,
  format: z.literal("xcstrings"),
  path: z
    .string()
    .refine(
      (p) => p.endsWith(".xcstrings"),
      "Point at a .xcstrings file (all languages live in it)",
    ),
});

export const ConfigSchema = z
  .object({
    sourceLocale: locale.default("en"),
    locales: z.array(locale).default([]),
    targets: z
      .array(
        z.discriminatedUnion("format", [
          AndroidTargetSchema,
          PoTargetSchema,
          XcstringsTargetSchema,
        ]),
      )
      .min(1, "Add at least one target"),
    lock: z.string().default(".l10n/lock.json"),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.targets.forEach((t, i) => {
      const tid = targetId(t, c.targets);
      if (seen.has(tid)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", i, "id"],
          message: `Duplicate target id "${tid}"; give each target a unique id`,
        });
      }
      seen.add(tid);
    });
  });

/** A target's id: its `id`, else its format name when that format appears once. */
export function targetId(
  t: { id?: string | undefined; format: string },
  all: Array<{ format: string }>,
): string {
  if (t.id) return t.id;
  const base = t.format === "android-xml" ? "android" : t.format;
  const same = all.filter((x) => x.format === t.format);
  return same.length > 1 ? `${base}-${same.indexOf(t as never) + 1}` : base;
}

export type Config = z.infer<typeof ConfigSchema>;
export type TargetConfig = Config["targets"][number];

export class ConfigError extends Error {}

export interface LoadedConfig {
  config: Config;
  /** Directory paths in the config are relative to. */
  root: string;
  file: string;
}

/** Finds `l10n.config.yaml` in `cwd` or the nearest parent, unless a path is given. */
export async function loadConfig(
  fs: FileSystem,
  cwd: string,
  explicit?: string,
): Promise<LoadedConfig> {
  let file: string | undefined;
  if (explicit) {
    file = path.resolve(cwd, explicit);
    if (!(await fs.exists(file))) throw new ConfigError(`Config not found: ${file}`);
  } else {
    for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, CONFIG_FILE);
      if (await fs.exists(candidate)) {
        file = candidate;
        break;
      }
      if (path.dirname(dir) === dir) break;
    }
    if (!file)
      throw new ConfigError(
        `No ${CONFIG_FILE} found in ${cwd} or its parents. Run \`l10n init\` to create one.`,
      );
  }

  let raw: unknown;
  try {
    raw = parseYaml(await fs.readFile(file));
  } catch (e) {
    throw new ConfigError(`${file}: ${(e as Error).message}`);
  }
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigError(`${file} is invalid:\n${details.join("\n")}`);
  }
  return { config: parsed.data, root: path.dirname(file), file };
}
