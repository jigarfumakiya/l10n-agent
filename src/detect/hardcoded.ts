import path from "node:path";
import type { FileSystem } from "../core/fs.js";
import type { Project } from "../core/project.js";
import { walk } from "./walk.js";

/**
 * A rough count of user-facing text still written in code instead of string resources. Most
 * apps start that way, and translating only the resources then covers a fraction of the app.
 * This is an estimate from common UI patterns, not a parser: it is meant to say "most of the
 * text is still in the code", not to list every string.
 */
export interface HardcodedText {
  platform: "android" | "ios";
  /** Distinct literals found. */
  literals: number;
  files: number;
  /** A few examples, as `file:line` and the text. */
  examples: Array<{ at: string; text: string }>;
  /** Literals per directory a module lives in (Android: the path before `src/`). */
  byModule: Record<string, number>;
}

const MAX_FILE_BYTES = 512 * 1024;
const LITERAL = String.raw`"((?:[^"\\\n]|\\.)*)"`;
const UI_PROPERTY =
  "text|title|label|placeholder|contentDescription|subtitle|message|description|hint|supportingText|headline|caption|confirmText|dismissText|buttonText|actionLabel";

const ANDROID_CODE: RegExp[] = [
  new RegExp(String.raw`\bText\(\s*${LITERAL}`, "g"),
  new RegExp(String.raw`\b(?:${UI_PROPERTY})\s*=\s*${LITERAL}`, "g"),
  new RegExp(String.raw`Toast\.makeText\([^,]+,\s*${LITERAL}`, "g"),
  new RegExp(
    String.raw`\.(?:setTitle|setMessage|setText|setContentTitle|setContentText|setHint)\(\s*${LITERAL}`,
    "g",
  ),
  new RegExp(String.raw`Snackbar\.make\([^,]+,\s*${LITERAL}`, "g"),
];
const ANDROID_LAYOUT = /android:(?:text|hint|contentDescription|title)="([^"@?][^"]*)"/g;
const IOS_CODE: RegExp[] = [
  new RegExp(String.raw`\.(?:text|title|placeholder|prompt)\s*=\s*${LITERAL}`, "g"),
  new RegExp(String.raw`\.setTitle\(\s*${LITERAL}`, "g"),
  new RegExp(String.raw`UIAlert(?:Controller|Action)\(\s*title:\s*${LITERAL}`, "g"),
];
/**
 * Lines about logging, analytics, navigation, tests or animations (Compose `label`s name
 * animations for tooling): their strings aren't shown to users.
 */
const NOT_UI =
  /\b(?:animate\w*\(|\w*Transition\(|Crossfade\(|AnimatedContent\(|AnimatedVisibility\(|Log\.[a-z]|Timber\.|println|print\(|logger|TAG\b|testTag|route|analytics|capture\(|track\(|putExtra|getString\(|key\s*=|contentType|const val|@Preview|NSLog|os_log)/;

/** Text a person reads: words, not keys, ids, paths, formats or URLs. */
function looksLikeUiText(text: string): boolean {
  if (!/\p{L}{2,}/u.test(text)) return false;
  if (/^[a-z0-9]+(?:[_.:/-][a-z0-9]+)+$/i.test(text)) return false; // snake_case, dotted, paths
  if (/^(?:https?:|mailto:|tel:|#[0-9a-f]{3,8}$)/i.test(text)) return false;
  if (/^%[\w$.]*$/.test(text.trim())) return false;
  if (/^[a-z]+[A-Z]\w*$/.test(text)) return false; // camelCase identifiers
  if (/^[a-z]+$/.test(text)) return false; // one lowercase word: almost always a key or name
  return true;
}

function isTestOrBuild(rel: string): boolean {
  return /(^|\/)(test|androidTest|testFixtures|debug|preview|Tests?|UITests?|Preview Content)\//.test(
    rel,
  );
}

/** Android module directory for a file: everything before `src/`, or "" at the root. */
export function androidModule(rel: string): string {
  const i = rel.indexOf("src/");
  return i < 0 ? "" : rel.slice(0, i).replace(/\/$/, "");
}

export async function estimateHardcoded(
  fs: FileSystem,
  root: string,
  files: string[],
): Promise<HardcodedText[]> {
  const out: HardcodedText[] = [];
  const scan = async (
    platform: HardcodedText["platform"],
    pick: (rel: string) => RegExp[] | undefined,
  ) => {
    const seen = new Set<string>();
    const fileSet = new Set<string>();
    const examples: HardcodedText["examples"] = [];
    const byModule: Record<string, number> = {};
    for (const rel of files) {
      const patterns = pick(rel);
      if (!patterns || isTestOrBuild(rel)) continue;
      let text: string;
      try {
        text = await fs.readFile(path.join(root, rel));
      } catch {
        continue;
      }
      if (text.length > MAX_FILE_BYTES) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (NOT_UI.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const re of patterns) {
          for (const m of line.matchAll(re)) {
            const literal = m[1] as string;
            if (!looksLikeUiText(literal)) continue;
            const id = `${rel}\u0000${i}\u0000${literal}`;
            if (seen.has(id)) continue;
            seen.add(id);
            fileSet.add(rel);
            const module = platform === "android" ? androidModule(rel) : "";
            byModule[module] = (byModule[module] ?? 0) + 1;
            // Several words read as UI text at a glance; prefer those as examples.
            if (
              literal.includes(" ") &&
              examples.length < 3 &&
              !examples.some((e) => e.at.startsWith(`${rel}:`))
            ) {
              examples.push({ at: `${rel}:${i + 1}`, text: literal });
            }
          }
        }
      });
    }
    if (seen.size) {
      out.push({ platform, literals: seen.size, files: fileSet.size, examples, byModule });
    }
  };

  await scan("android", (rel) => {
    if (/\.(kt|java)$/.test(rel)) return ANDROID_CODE;
    if (/(^|\/)res\/(layout|menu|navigation)[^/]*\/[^/]+\.xml$/.test(rel)) return [ANDROID_LAYOUT];
    return undefined;
  });
  await scan("ios", (rel) => (/\.swift$/.test(rel) ? IOS_CODE : undefined));
  return out;
}

/** Literals in code that belong to an Android res folder's module. */
export function literalsForResDir(estimate: HardcodedText | undefined, resDir: string): number {
  if (!estimate) return 0;
  return estimate.byModule[androidModule(`${resDir}/`)] ?? 0;
}

export interface CodeTextNote {
  target: string;
  resourceStrings: number;
  codeLiterals: number;
  examples: HardcodedText["examples"];
  message: string;
}

/**
 * For `status`: targets whose app still has more UI text in code than in resources, with a
 * plain-words note. Android only for now; String Catalogs are filled from code by Xcode.
 */
export async function hardcodedNotes(project: Project): Promise<CodeTextNote[]> {
  const android = project.targets.filter((t) => t.config.format === "android-xml");
  if (android.length === 0) return [];
  const { files } = await walk(project.fs, project.root);
  const estimate = (await estimateHardcoded(project.fs, project.root, files)).find(
    (h) => h.platform === "android",
  );
  const notes: CodeTextNote[] = [];
  for (const { target, config } of android) {
    const codeLiterals = literalsForResDir(estimate, config.path);
    const resourceStrings = [...target.source.entries.values()].filter(
      (e) => e.translatable,
    ).length;
    if (codeLiterals < 10 || codeLiterals <= resourceStrings) continue;
    notes.push({
      target: target.id,
      resourceStrings,
      codeLiterals,
      examples: estimate?.examples ?? [],
      message: `About ${codeLiterals} pieces of UI text are still written in the code, against ${resourceStrings} in resources, so translations cover only part of the app. Make it localizable first (the localship-extract skill).`,
    });
  }
  return notes;
}
