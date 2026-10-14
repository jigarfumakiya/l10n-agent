import path from "node:path";
import {
  type Catalog,
  type Entry,
  type Issue,
  type Message,
  PLURAL_CATEGORIES,
  type PluralCategory,
} from "../../core/model.js";
import { cldrPluralSpec } from "../../core/plurals.js";
import type { FormatAdapter, Target, WriteResult } from "../types.js";
import { folderToLocale, localeToFolder } from "./folders.js";
import { analyzeAndroidValue, isReference } from "./value.js";
import {
  childElements,
  escapeAttr,
  innerRaw,
  lineAt,
  parseXml,
  type XmlDocument,
  type XmlElement,
  XmlError,
} from "./xml.js";

export interface AndroidTarget {
  id?: string;
  format: "android-xml";
  /** Resource directory, relative to the project root (e.g. `app/src/main/res`). */
  path: string;
}

const XLIFF_NS = "urn:oasis:names:tc:xliff:document:1.2";
/** Entry attributes carried through a round trip. `name` and `translatable` are modeled. */
const KEPT_ATTRS = ["formatted", "product", "tools:ignore"];

export const androidAdapter: FormatAdapter<AndroidTarget> = {
  format: "android-xml",

  async open(config, { fs, root, sourceLocale, id }) {
    const resDir = path.resolve(root, config.path);
    const source: Catalog = { locale: sourceLocale, entries: new Map() };
    const locales = new Map<string, Catalog>();
    const issues: Issue[] = [];
    /** Root element attributes per file, so rewritten files keep their namespaces. */
    const rootAttrs = new Map<string, Array<[string, string]>>();

    const target: Target = {
      id,
      format: "android-xml",
      label: config.path,
      source,
      locales,
      issues,
      analyze: (value, entry) =>
        analyzeAndroidValue(value, { formatted: entry.attrs?.formatted !== "false" }),
      pluralSpec: (locale) => cldrPluralSpec(locale),
      writeLocale: (catalog) => writeLocale(catalog),
    };

    if (!(await fs.exists(resDir))) {
      issues.push({
        severity: "error",
        code: "target-missing",
        message: `Resource directory not found: ${config.path}`,
        target: id,
      });
      return target;
    }

    const dirs = (await fs.listDir(resDir))
      .filter((d) => d.isDirectory && d.name.startsWith("values"))
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      const locale = folderToLocale(dir);
      if (locale === undefined) continue;
      const catalog: Catalog = locale === null ? source : { locale, entries: new Map() };
      const xmlFiles = (await fs.listDir(path.join(resDir, dir)))
        .filter((f) => !f.isDirectory && f.name.endsWith(".xml"))
        .map((f) => f.name)
        .sort();
      for (const name of xmlFiles) {
        const abs = path.join(resDir, dir, name);
        const rel = path.relative(root, abs);
        let doc: XmlDocument;
        try {
          doc = parseXml(await fs.readFile(abs));
        } catch (e) {
          if (!(e instanceof XmlError)) throw e;
          issues.push({
            severity: "error",
            code: "xml-malformed",
            message: e.message.replace(/ \(line \d+\)$/, ""),
            target: id,
            locale: locale ?? sourceLocale,
            file: rel,
            line: e.line,
          });
          continue;
        }
        const resources = doc.root;
        if (resources?.name !== "resources") continue;
        const before = catalog.entries.size;
        readEntries(doc, resources, rel, catalog, (issue) =>
          issues.push({ ...issue, target: id, locale: locale ?? sourceLocale }),
        );
        if (catalog.entries.size > before || locale === null) {
          rootAttrs.set(
            abs,
            resources.attrOrder.map((a) => [a, resources.attrs[a] ?? ""]),
          );
        }
      }
      if (locale !== null && catalog.entries.size > 0) locales.set(locale, catalog);
    }

    async function writeLocale(catalog: Catalog): Promise<WriteResult> {
      const folder = path.join(resDir, localeToFolder(catalog.locale));
      const existing = locales.get(catalog.locale)?.entries ?? new Map<string, Entry>();

      // Each key stays in the locale file it already lives in; new keys follow the source file name.
      const byFile = new Map<string, Entry[]>();
      const merged = new Map(existing);
      for (const [k, e] of catalog.entries) merged.set(k, e);
      const orphans = [...merged.keys()].filter((k) => !source.entries.has(k));
      for (const key of [...source.entries.keys(), ...orphans]) {
        const entry = merged.get(key);
        if (!entry) continue;
        const src = source.entries.get(key);
        const prior = existing.get(key);
        const file = prior
          ? path.resolve(root, prior.file)
          : path.join(folder, path.basename(src?.file ?? "strings.xml"));
        const list = byFile.get(file) ?? [];
        list.push({ ...entry, attrs: entry.attrs ?? src?.attrs });
        byFile.set(file, list);
      }

      const written: string[] = [];
      for (const [abs, entries] of byFile) {
        const sourceFile = path.join(resDir, "values", path.basename(abs));
        const attrs = [...(rootAttrs.get(abs) ?? rootAttrs.get(sourceFile) ?? [])];
        await fs.writeFile(abs, serializeResources(entries, attrs));
        written.push(path.relative(root, abs));
      }
      return { files: written };
    }

    return target;
  },
};

function readEntries(
  doc: XmlDocument,
  resources: XmlElement,
  file: string,
  catalog: Catalog,
  report: (issue: Issue) => void,
) {
  let pendingComment: string | undefined;
  for (const node of resources.children) {
    if (node.type === "comment") {
      pendingComment = node.value.trim();
      continue;
    }
    if (node.type === "text") {
      // A blank line between a comment and an element still counts; anything else resets.
      if (node.raw.trim() !== "") pendingComment = undefined;
      continue;
    }
    if (node.type !== "element") continue;
    const comment = pendingComment;
    pendingComment = undefined;

    const message = readMessage(doc, node);
    if (!message) continue;
    const name = node.attrs.name;
    const line = lineAt(doc.source, node.start);
    if (!name) {
      report({
        severity: "error",
        code: "name-missing",
        message: `<${node.name}> without a name`,
        file,
        line,
      });
      continue;
    }
    const key = node.attrs.product ? `${name}[${node.attrs.product}]` : name;
    const prior = catalog.entries.get(key);
    if (prior) {
      report({
        severity: "error",
        code: "duplicate-key",
        message: `"${key}" is also defined in ${prior.file}:${prior.line}`,
        key,
        file,
        line,
      });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of KEPT_ATTRS) if (node.attrs[a] !== undefined) attrs[a] = node.attrs[a];
    const entry: Entry = {
      key,
      message,
      // An alias like `@string/ok` follows whatever it points at; there is nothing to translate.
      translatable:
        node.attrs.translatable !== "false" &&
        !(message.kind === "text" && isReference(message.value)),
      file,
      line,
    };
    if (comment) entry.comment = comment;
    if (Object.keys(attrs).length > 0) entry.attrs = attrs;
    catalog.entries.set(key, entry);
  }
}

function readMessage(doc: XmlDocument, el: XmlElement): Message | undefined {
  switch (el.name) {
    case "string":
      return { kind: "text", value: innerRaw(doc, el) };
    case "plurals": {
      const forms: Record<string, string> = {};
      for (const item of childElements(el)) {
        const q = item.attrs.quantity;
        if (item.name === "item" && q && PLURAL_CATEGORIES.includes(q as PluralCategory))
          forms[q] = innerRaw(doc, item);
      }
      return { kind: "plural", forms };
    }
    case "string-array":
      return {
        kind: "array",
        items: childElements(el)
          .filter((i) => i.name === "item")
          .map((i) => innerRaw(doc, i)),
      };
    default:
      return undefined;
  }
}

const INDENT = "    ";

/** Writes a resources file in Android Studio's layout: 4-space indent, CLDR plural order. */
export function serializeResources(entries: Entry[], rootAttrs: Array<[string, string]>): string {
  const attrs = [...rootAttrs];
  const usesXliff = entries.some((e) => JSON.stringify(e.message).includes("<xliff:"));
  if (usesXliff && !attrs.some(([n]) => n === "xmlns:xliff")) attrs.push(["xmlns:xliff", XLIFF_NS]);
  const rootOpen = attrs.length
    ? `<resources ${attrs.map(([n, v]) => `${n}="${escapeAttr(v)}"`).join(" ")}>`
    : "<resources>";

  const lines = ['<?xml version="1.0" encoding="utf-8"?>', rootOpen];
  for (const e of entries) {
    const name = e.key.replace(/\[.*\]$/, "");
    const extra = Object.entries(e.attrs ?? {})
      .map(([n, v]) => ` ${n}="${escapeAttr(v)}"`)
      .join("");
    const open = (tag: string) => `<${tag} name="${escapeAttr(name)}"${extra}>`;
    switch (e.message.kind) {
      case "text":
        lines.push(`${INDENT}${open("string")}${e.message.value}</string>`);
        break;
      case "plural":
        lines.push(`${INDENT}${open("plurals")}`);
        for (const c of PLURAL_CATEGORIES) {
          const v = e.message.forms[c];
          if (v !== undefined) lines.push(`${INDENT}${INDENT}<item quantity="${c}">${v}</item>`);
        }
        lines.push(`${INDENT}</plurals>`);
        break;
      case "array":
        lines.push(`${INDENT}${open("string-array")}`);
        for (const v of e.message.items) lines.push(`${INDENT}${INDENT}<item>${v}</item>`);
        lines.push(`${INDENT}</string-array>`);
        break;
    }
  }
  lines.push("</resources>", "");
  return lines.join("\n");
}
