import type { ValueAnalysis } from "../../core/model.js";
import { findPlaceholders } from "../../core/placeholders.js";
import { decodeEntities, parseXml, XmlError, type XmlNode } from "./xml.js";

type Lint = ValueAnalysis["lints"][number];

/** A whole value that points at another resource, e.g. `@string/ok` or `?attr/label`. */
const REFERENCE = /^[@?](?:\+?[A-Za-z0-9_.]+:)?[A-Za-z_]+\/[A-Za-z0-9_.]+$/;

export function isReference(raw: string): boolean {
  return REFERENCE.test(raw.trim());
}

/**
 * Resolves an Android string value the way aapt2 does: XML entities, then backslash
 * escapes, double-quote regions and whitespace collapsing. Collects problems on the way.
 */
export function analyzeAndroidValue(
  raw: string,
  opts: { formatted?: boolean } = {},
): ValueAnalysis {
  if (isReference(raw)) return { text: raw.trim(), placeholders: [], tags: [], lints: [] };
  const lints: Lint[] = [];
  const tags: string[] = [];
  let flat = "";
  try {
    const doc = parseXml(`<v>${raw}</v>`);
    const walk = (nodes: XmlNode[]) => {
      for (const n of nodes) {
        if (n.type === "text") flat += decodeEntities(n.raw);
        else if (n.type === "cdata") flat += n.value;
        else if (n.type === "element") {
          tags.push(n.name === "xliff:g" && n.attrs.id ? `xliff:g#${n.attrs.id}` : n.name);
          walk(n.children);
        }
      }
    };
    walk(doc.root?.children ?? []);
  } catch (e) {
    if (!(e instanceof XmlError)) throw e;
    lints.push({
      severity: "error",
      code: "xml-malformed",
      message: e.message.replace(/ \(line \d+\)$/, ""),
    });
    flat = raw;
  }

  const text = resolveEscapes(flat, lints);
  const placeholders = opts.formatted === false ? [] : findPlaceholders(text, "java");
  return { text, placeholders, tags, lints };
}

function resolveEscapes(flat: string, lints: Lint[]): string {
  const out: string[] = [];
  /** true for characters that came from unquoted whitespace and may be trimmed. */
  const soft: boolean[] = [];
  const add = (s: string, isSoft = false) => {
    out.push(s);
    soft.push(isSoft);
  };
  let inQuotes = false;
  let quotes = 0;
  let apostrophe = false;

  const lead = flat.trimStart()[0];
  if (lead === "@" || lead === "?") {
    lints.push({
      severity: "error",
      code: "escape-leading-reference",
      message: `A value starting with "${lead}" is read as a resource reference. Write \\${lead}.`,
    });
  }

  for (let i = 0; i < flat.length; i++) {
    const c = flat[i] as string;
    if (c === "\\") {
      const n = flat[i + 1];
      i++;
      switch (n) {
        case "n":
          add("\n");
          break;
        case "t":
          add("\t");
          break;
        case "u": {
          const hex = flat.slice(i + 1, i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            add(String.fromCharCode(Number.parseInt(hex, 16)));
            i += 4;
          } else {
            lints.push({
              severity: "error",
              code: "escape-invalid",
              message: "\\u needs four hex digits.",
            });
          }
          break;
        }
        case "\\":
        case "'":
        case '"':
        case "@":
        case "?":
          add(n);
          break;
        case undefined:
          lints.push({
            severity: "error",
            code: "escape-invalid",
            message: "Value ends with a lone backslash.",
          });
          break;
        default:
          lints.push({
            severity: "warning",
            code: "escape-unknown",
            message: `Unknown escape \\${n}; Android drops the backslash.`,
          });
          add(n);
      }
    } else if (c === '"') {
      inQuotes = !inQuotes;
      quotes++;
    } else if (c === "'" && !inQuotes) {
      apostrophe = true;
      add(c);
    } else if (/\s/.test(c) && !inQuotes) {
      while (i + 1 < flat.length && /\s/.test(flat[i + 1] as string)) i++;
      add(" ", true);
    } else {
      add(c);
    }
  }

  if (apostrophe) {
    lints.push({
      severity: "error",
      code: "escape-apostrophe",
      message: "Unescaped apostrophe. Write \\' (aapt2 rejects or drops it).",
    });
  }
  const t = flat.trim();
  const wrapped = quotes === 2 && t.startsWith('"') && t.endsWith('"');
  if (quotes % 2 === 1) {
    lints.push({
      severity: "error",
      code: "escape-quote",
      message: 'Unbalanced ". Write \\" for a visible quote.',
    });
  } else if (quotes > 0 && !wrapped) {
    lints.push({
      severity: "warning",
      code: "escape-quote",
      message: 'Unescaped " is removed by Android. Write \\" for a visible quote.',
    });
  }

  let start = 0;
  let end = out.length;
  while (start < end && soft[start]) start++;
  while (end > start && soft[end - 1]) end--;
  return out.slice(start, end).join("");
}
