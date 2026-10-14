import path from "node:path";
import type { FileSystem } from "../core/fs.js";

/**
 * Other localization tools a project already uses. Not supported, only noticed: a translation
 * platform that syncs files, or an SDK that swaps translations at runtime, can silently undo
 * what Localship writes, so the user should hear about it before translating.
 */
export interface OtherSystem {
  name: string;
  kind: "platform" | "sdk" | "library";
  /** The file that gave it away. */
  evidence: string;
  message: string;
}

interface Rule {
  name: string;
  kind: OtherSystem["kind"];
  /** Config files, by exact name anywhere in the repo, or a path ending. */
  files?: string[];
  /** Text in a Gradle build file or version catalog. */
  gradle?: string[];
}

const RULES: Rule[] = [
  { name: "Crowdin", kind: "platform", files: ["crowdin.yml", "crowdin.yaml"] },
  { name: "Phrase", kind: "platform", files: [".phrase.yml", ".phraseapp.yml"] },
  { name: "Transifex", kind: "platform", files: [".tx/config", "transifex.yml"] },
  {
    name: "Tolgee",
    kind: "platform",
    files: [".tolgeerc", ".tolgeerc.json", "tolgee.config.json"],
  },
  { name: "Localazy", kind: "platform", files: ["localazy.json"] },
  { name: "Lokalise", kind: "platform", files: ["lokalise.yml", ".lokalise.yml"] },
  { name: "Lingo.dev", kind: "platform", files: ["i18n.lock"] },
  { name: "Crowdin", kind: "sdk", gradle: ["com.crowdin.platform", "crowdin.mobile-sdk"] },
  { name: "Lokalise", kind: "sdk", gradle: ["com.lokalise"] },
  { name: "Phrase", kind: "sdk", gradle: ["com.phrase.android"] },
  { name: "Transifex", kind: "sdk", gradle: ["com.transifex.txnative"] },
  { name: "Tolgee", kind: "sdk", gradle: ["io.tolgee"] },
  { name: "Localazy", kind: "sdk", gradle: ["com.localazy"] },
  {
    name: "moko-resources",
    kind: "library",
    gradle: ["dev.icerock.moko:resources", "moko-resources"],
  },
  { name: "Lyricist", kind: "library", gradle: ["cafe.adriel.lyricist"] },
];

const GRADLE = /(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|libs\.versions\.toml)$/;

function explain(rule: Rule, evidence: string): string {
  switch (rule.kind) {
    case "platform":
      return `${rule.name} seems to manage translations here (${evidence}). Files Localship writes may be overwritten on the next ${rule.name} sync; decide which tool owns translations before translating.`;
    case "sdk":
      return `${rule.name}'s over-the-air SDK is in the build (${evidence}). It can replace shipped translations at runtime, so what Localship writes may not be what users see.`;
    case "library":
      return rule.name === "Lyricist"
        ? `Lyricist is in the build (${evidence}). Strings defined in Kotlin with @LyricistStrings aren't visible to Localship; strings.xml ones are.`
        : `This project uses ${rule.name} (${evidence}). Localship doesn't read its files yet, only Android res/values.`;
  }
}

export async function findOtherSystems(
  fs: FileSystem,
  root: string,
  files: string[],
): Promise<OtherSystem[]> {
  const found = new Map<string, OtherSystem>();
  const add = (rule: Rule, evidence: string) => {
    const id = `${rule.name}\u0000${rule.kind}`;
    if (!found.has(id)) {
      found.set(id, {
        name: rule.name,
        kind: rule.kind,
        evidence,
        message: explain(rule, evidence),
      });
    }
  };

  for (const rel of files) {
    for (const rule of RULES) {
      if (rule.files?.some((f) => rel === f || rel.endsWith(`/${f}`))) add(rule, rel);
    }
  }

  const gradleRules = RULES.filter((r) => r.gradle);
  for (const rel of files.filter((f) => GRADLE.test(f))) {
    let text: string;
    try {
      text = await fs.readFile(path.join(root, rel));
    } catch {
      continue;
    }
    for (const rule of gradleRules) {
      if (rule.gradle?.some((g) => text.includes(g))) add(rule, rel);
    }
  }
  return [...found.values()];
}
