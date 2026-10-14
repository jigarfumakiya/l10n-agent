import path from "node:path";
import {
  type Catalog,
  type Entry,
  type Issue,
  type Message,
  PLURAL_CATEGORIES,
  type PluralCategory,
} from "../../core/model.js";
import { relativePath } from "../../core/paths.js";
import { cldrPluralSpec } from "../../core/plurals.js";
import type { FormatAdapter, Target, WriteResult } from "../types.js";
import { folderToLocale, localeToFolder } from "./folders.js";
import { analyzeAndroidValue, isReference } from "./value.js";
import {
  childElements,
  escapeAttr,
  innerRaw,
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
    /** Root element attributes per file, so new files keep their namespaces. */
    const rootAttrs = new Map<string, Array<[string, string]>>();
    /** Existing translation files, kept as text so updates are spliced in and comments survive. */
    const localeFiles = new Map<string, LocaleFile>();

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
        const rel = relativePath(root, abs);
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
        const spans = new Map<string, Span>();
        readEntries(
          doc,
          resources,
          rel,
          catalog,
          (issue) => issues.push({ ...issue, target: id, locale: locale ?? sourceLocale }),
          spans,
        );
        if (locale !== null && spans.size > 0) localeFiles.set(abs, { doc, resources, spans });
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
        const known = localeFiles.get(abs);
        let text: string;
        if (known) {
          text = spliceEntries(known, entries, existing, [...source.entries.keys()]);
          if (text === known.doc.source) continue;
        } else {
          const sourceFile = path.join(resDir, "values", path.basename(abs));
          const attrs = [...(rootAttrs.get(abs) ?? rootAttrs.get(sourceFile) ?? [])];
          text = serializeResources(entries, attrs);
        }
        await fs.writeFile(abs, text);
        written.push(relativePath(root, abs));
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
  spans?: Map<string, Span>,
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
    const line = doc.lineOf(node.start);
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
    spans?.set(key, {
      start: node.start,
      end: node.end,
      attrs: node.attrOrder.filter((a) => a !== "name").map((a) => [a, node.attrs[a] ?? ""]),
    });
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
  if (usesXliff(entries) && !attrs.some(([n]) => n === "xmlns:xliff")) {
    attrs.push(["xmlns:xliff", XLIFF_NS]);
  }
  const rootOpen = attrs.length
    ? `<resources ${attrs.map(([n, v]) => `${n}="${escapeAttr(v)}"`).join(" ")}>`
    : "<resources>";
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', rootOpen];
  for (const e of entries) lines.push(INDENT + renderEntry(e, INDENT, "\n"));
  lines.push("</resources>", "");
  return lines.join("\n");
}

/** One element. Continuation lines get `indent`; items inside get one more `step`. */
function renderEntry(e: Entry, indent: string, eol: string, step = INDENT): string {
  const name = e.key.replace(/\[.*\]$/, "");
  const extra = Object.entries(e.attrs ?? {})
    .map(([n, v]) => ` ${n}="${escapeAttr(v)}"`)
    .join("");
  const open = (tag: string) => `<${tag} name="${escapeAttr(name)}"${extra}>`;
  const inner = indent + step;
  switch (e.message.kind) {
    case "text":
      return `${open("string")}${e.message.value}</string>`;
    case "plural": {
      const forms = e.message.forms;
      const items = PLURAL_CATEGORIES.flatMap((c) =>
        forms[c] === undefined ? [] : [`${inner}<item quantity="${c}">${forms[c]}</item>`],
      );
      return [open("plurals"), ...items, `${indent}</plurals>`].join(eol);
    }
    case "array": {
      const items = e.message.items.map((v) => `${inner}<item>${v}</item>`);
      return [open("string-array"), ...items, `${indent}</string-array>`].join(eol);
    }
  }
}

function usesXliff(entries: Entry[]): boolean {
  return entries.some((e) => JSON.stringify(e.message).includes("<xliff:"));
}

interface Span {
  start: number;
  end: number;
  /** Every attribute but `name`, in file order, so replaced elements keep the ones we don't model. */
  attrs: Array<[string, string]>;
}

interface LocaleFile {
  doc: XmlDocument;
  resources: XmlElement;
  spans: Map<string, Span>;
}

/**
 * Applies `entries` to an existing translation file as text edits: changed elements are
 * replaced in place, new ones go after their nearest neighbour in source order, and
 * everything else (comments, blank lines, formatting) is left exactly as it was.
 */
function spliceEntries(
  file: LocaleFile,
  entries: Entry[],
  existing: Map<string, Entry>,
  sourceOrder: string[],
): string {
  const src = file.doc.source;
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lineIndent = (offset: number) =>
    /[ \t]*$/.exec(src.slice(src.lastIndexOf("\n", offset - 1) + 1, offset))?.[0] ?? "";
  const first = [...file.spans.values()].sort((a, b) => a.start - b.start)[0];
  const indent = first ? lineIndent(first.start) : INDENT;
  // Elements sit one level inside <resources>, so their indent is also the file's step.
  const step = indent || INDENT;
  const edits: Array<{ at: number; end: number; text: string }> = [];

  for (const entry of entries) {
    const span = file.spans.get(entry.key);
    if (span) {
      const before = existing.get(entry.key);
      const same =
        before &&
        JSON.stringify(before.message) === JSON.stringify(entry.message) &&
        JSON.stringify(before.attrs ?? {}) === JSON.stringify(entry.attrs ?? {});
      if (!same) {
        // Keep attributes the file had (e.g. Google's `msgid`), then any new modeled ones.
        const attrs = Object.fromEntries(span.attrs);
        for (const [k, v] of Object.entries(entry.attrs ?? {})) attrs[k] = v;
        const text = renderEntry({ ...entry, attrs }, lineIndent(span.start), eol, step);
        edits.push({ at: span.start, end: span.end, text });
      }
      continue;
    }
    const position = sourceOrder.indexOf(entry.key);
    const previous = sourceOrder
      .slice(0, Math.max(position, 0))
      .reverse()
      .map((k) => file.spans.get(k))
      .find((x) => x !== undefined);
    const element = renderEntry(entry, indent, eol, step);
    if (previous)
      edits.push({ at: previous.end, end: previous.end, text: `${eol}${indent}${element}` });
    else if (first)
      edits.push({ at: first.start, end: first.start, text: `${element}${eol}${indent}` });
    else
      edits.push({
        at: file.resources.innerEnd,
        end: file.resources.innerEnd,
        text: `${indent}${element}${eol}`,
      });
  }

  // Declare the xliff namespace if new content needs it.
  if (usesXliff(entries) && !("xmlns:xliff" in file.resources.attrs)) {
    const close = src.indexOf(">", file.resources.start);
    const at = src[close - 1] === "/" ? close - 1 : close;
    edits.push({ at, end: at, text: ` xmlns:xliff="${XLIFF_NS}"` });
  }

  let out = src;
  // Same-offset inserts keep entry order: apply later entries first.
  const ordered = edits.map((e, i) => ({ ...e, i })).sort((a, b) => b.at - a.at || b.i - a.i);
  for (const e of ordered) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}
