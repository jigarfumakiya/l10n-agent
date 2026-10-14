import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { FileSystem } from "./fs.js";

export const CONFIG_FILE = "l10n.config.yaml";

const locale = z.string().transform((s, ctx) => {
  try {
    return Intl.getCanonicalLocales(s)[0] as string;
  } catch {
    ctx.addIssue({ code: "custom", message: `Not a valid BCP 47 locale: "${s}"` });
    return z.NEVER;
  }
});

const AndroidTargetSchema = z.object({
  id: z.string().optional(),
  format: z.literal("android-xml"),
  res: z.string(),
});

export const ConfigSchema = z.object({
  sourceLocale: locale.default("en"),
  locales: z.array(locale).default([]),
  targets: z.array(AndroidTargetSchema).min(1, "Add at least one target"),
  lock: z.string().default(".l10n/lock.json"),
});

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
      throw new ConfigError(`No ${CONFIG_FILE} found in ${cwd} or its parents. Run \`l10n init\`.`);
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
