/**
 * gettext PO / POT files.
 *
 * The file is kept as a list of blocks (entries separated by blank lines), each with its
 * original text. Writing emits untouched blocks verbatim and regenerates only changed
 * entries, wrapped the way the file already is, so diffs show just what changed.
 */

export interface PoEntry {
  /** `# ` lines, without the marker. */
  translatorComments: string[];
  /** `#.` lines, without the marker. */
  extractedComments: string[];
  /** `#:` references, one per item (`src/app.py:12`). */
  references: string[];
  /** `#,` flags (`fuzzy`, `python-format`, …). */
  flags: string[];
  msgctxt?: string;
  msgid: string;
  msgidPlural?: string;
  /** One item for singular entries; `msgstr[0]` … for plural ones. */
  msgstr: string[];
  /** 1-based line of `msgid`. */
  line: number;
}

interface Block {
  /** Original text, or undefined for new and changed blocks (regenerated on write). */
  raw: string[] | undefined;
  /** Blank lines that followed the block, as written. */
  after: string[];
  /** Comment lines kept verbatim when regenerating, in their original order. */
  keptComments: string[];
  /** Original `msgctxt` / `msgid` / `msgid_plural` lines, reused when regenerating. */
  idLines: string[] | undefined;
  kind: "entry" | "header" | "obsolete" | "comment";
  entry?: PoEntry;
}

export class PoParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
  }
}

export const DEFAULT_WRAP = 79;

export class PoFile {
  private constructor(
    private blocks: Block[],
    private leading: string[],
    readonly eol: string,
    /** Column to wrap at, or false when the file is written with `--no-wrap`. */
    readonly wrap: number | false,
    private trailingNewline: boolean,
  ) {}

  static parse(text: string): PoFile {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const lines = src.split(/\r?\n/);
    const trailingNewline = lines.at(-1) === "";
    if (trailingNewline) lines.pop();

    const leading: string[] = [];
    const blocks: Block[] = [];
    let i = 0;
    while (i < lines.length && (lines[i] as string).trim() === "")
      leading.push(lines[i++] as string);
    while (i < lines.length) {
      const start = i;
      const raw: string[] = [];
      while (i < lines.length && (lines[i] as string).trim() !== "") raw.push(lines[i++] as string);
      const after: string[] = [];
      while (i < lines.length && (lines[i] as string).trim() === "")
        after.push(lines[i++] as string);
      blocks.push({ ...parseBlock(raw, start + 1), raw, after });
    }
    const quoted = lines.filter((l) => /^\s*(msg\w+(\[\d+\])?\s+)?"/.test(l));
    const wrap = quoted.some((l) => l.length > DEFAULT_WRAP + 1) ? false : DEFAULT_WRAP;
    return new PoFile(blocks, leading, eol, wrap, trailingNewline);
  }

  static create(opts: { eol?: string; wrap?: number | false } = {}): PoFile {
    return new PoFile([], [], opts.eol ?? "\n", opts.wrap ?? DEFAULT_WRAP, true);
  }

  /** Live entries (no header, no obsolete `#~` entries). */
  entries(): PoEntry[] {
    return this.blocks.flatMap((b) => (b.kind === "entry" && b.entry ? [b.entry] : []));
  }

  header(): PoEntry | undefined {
    return this.blocks.find((b) => b.kind === "header")?.entry;
  }

  headerFields(): Map<string, string> {
    return parseHeaderFields(this.header()?.msgstr[0] ?? "");
  }

  setHeader(fields: Map<string, string>, comments: string[] = []): void {
    const msgstr = [...fields].map(([k, v]) => `${k}: ${v}\n`).join("");
    const existing = this.blocks.find((b) => b.kind === "header");
    if (existing?.entry) {
      existing.entry.msgstr = [msgstr];
      existing.raw = undefined;
      return;
    }
    const entry: PoEntry = { ...emptyEntry(""), translatorComments: comments, msgstr: [msgstr] };
    this.blocks.unshift({
      raw: undefined,
      after: [""],
      keptComments: [],
      idLines: undefined,
      kind: "header",
      entry,
    });
  }

  /** Replaces an entry's translation (and fuzzy flag). The entry must come from {@link entries}. */
  update(entry: PoEntry, msgstr: string[], fuzzy: boolean): void {
    const block = this.blocks.find((b) => b.entry === entry);
    if (!block) throw new Error("Entry is not part of this file");
    const flags = entry.flags.filter((f) => f !== "fuzzy");
    if (fuzzy) flags.unshift("fuzzy");
    if (same(entry.msgstr, msgstr) && same(entry.flags, flags)) return;
    entry.msgstr = msgstr;
    entry.flags = flags;
    // gettext only keeps the previous msgid (#|) on fuzzy entries.
    if (!fuzzy) block.keptComments = block.keptComments.filter((l) => !l.startsWith("#|"));
    block.raw = undefined;
  }

  add(entry: PoEntry): void {
    const last = this.blocks.at(-1);
    if (last && last.after.length === 0) last.after = [""];
    this.blocks.push({
      raw: undefined,
      after: [],
      keptComments: [],
      idLines: undefined,
      kind: "entry",
      entry,
    });
  }

  toString(): string {
    const out: string[] = [...this.leading];
    for (const b of this.blocks) {
      out.push(...(b.raw ?? this.render(b)), ...b.after);
    }
    let text = out.join(this.eol);
    if (this.trailingNewline) text += this.eol;
    return text;
  }

  private render(b: Block): string[] {
    const e = b.entry;
    if (!e) return [];
    const lines: string[] = [];
    if (b.raw === undefined && b.keptComments.length === 0 && b.idLines === undefined) {
      // A new entry: comments come from the model.
      for (const c of e.translatorComments) lines.push(c === "" ? "#" : `# ${c}`);
      for (const c of e.extractedComments) lines.push(`#. ${c}`);
      if (e.references.length) lines.push(...wrapReferences(e.references, this.wrap));
    } else {
      lines.push(...b.keptComments.filter((l) => !l.startsWith("#,") && !l.startsWith("#|")));
    }
    if (e.flags.length) lines.push(`#, ${e.flags.join(", ")}`);
    lines.push(...b.keptComments.filter((l) => l.startsWith("#|")));
    if (b.idLines) {
      lines.push(...b.idLines);
    } else {
      if (e.msgctxt !== undefined) lines.push(...formatString("msgctxt", e.msgctxt, this.wrap));
      lines.push(...formatString("msgid", e.msgid, this.wrap));
      if (e.msgidPlural !== undefined)
        lines.push(...formatString("msgid_plural", e.msgidPlural, this.wrap));
    }
    if (e.msgidPlural !== undefined) {
      e.msgstr.forEach((v, i) => {
        lines.push(...formatString(`msgstr[${i}]`, v, this.wrap));
      });
    } else {
      lines.push(...formatString("msgstr", e.msgstr[0] ?? "", this.wrap));
    }
    return lines;
  }
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function emptyEntry(msgid: string): PoEntry {
  return {
    translatorComments: [],
    extractedComments: [],
    references: [],
    flags: [],
    msgid,
    msgstr: [""],
    line: 0,
  };
}

export function entryKey(e: Pick<PoEntry, "msgctxt" | "msgid">): string {
  return e.msgctxt === undefined ? e.msgid : `${e.msgctxt}\u0004${e.msgid}`;
}

function parseBlock(raw: string[], firstLine: number): Omit<Block, "raw" | "after"> {
  const keptComments: string[] = [];
  const idLines: string[] = [];
  const entry: PoEntry = { ...emptyEntry(""), msgstr: [], line: 0 };
  const strings: Record<string, string> = {};
  let current: string | undefined;
  let sawMsgid = false;
  const isObsolete = raw.every((l) => l.startsWith("#"));

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i] as string;
    const n = firstLine + i;
    if (line.startsWith("#")) {
      keptComments.push(line);
      const marker = line.slice(0, 2);
      const body = line.slice(2).replace(/^ /, "");
      if (marker === "#,")
        entry.flags.push(
          ...body
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
        );
      else if (marker === "#:") entry.references.push(...body.split(/\s+/).filter(Boolean));
      else if (marker === "#.") entry.extractedComments.push(body);
      else if (marker === "#|" || marker === "#~") {
        // previous msgid / obsolete entry: kept as text only
      } else entry.translatorComments.push(line.slice(1).replace(/^ /, ""));
      continue;
    }
    const kw = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")\s*$/.exec(line);
    if (kw) {
      current = kw[1] as string;
      if (current === "msgid") {
        sawMsgid = true;
        entry.line = n;
      }
      strings[current] = decodeQuoted(kw[3] as string, n);
      if (!current.startsWith("msgstr")) idLines.push(line);
      continue;
    }
    if (/^\s*".*"\s*$/.test(line) && current) {
      strings[current] += decodeQuoted(line.trim(), n);
      if (!current.startsWith("msgstr")) idLines.push(line);
      continue;
    }
    throw new PoParseError(`Unexpected line: ${line.slice(0, 60)}`, n);
  }

  if (!sawMsgid) {
    return {
      kind: isObsolete && raw.some((l) => l.startsWith("#~")) ? "obsolete" : "comment",
      keptComments,
      idLines: undefined,
    };
  }
  entry.msgctxt = strings.msgctxt;
  entry.msgid = strings.msgid ?? "";
  entry.msgidPlural = strings.msgid_plural;
  if (entry.msgidPlural !== undefined) {
    const forms = Object.keys(strings)
      .map((k) => /^msgstr\[(\d+)\]$/.exec(k)?.[1])
      .filter((v): v is string => v !== undefined)
      .map(Number);
    const count = forms.length ? Math.max(...forms) + 1 : 0;
    entry.msgstr = Array.from({ length: count }, (_, i) => strings[`msgstr[${i}]`] ?? "");
  } else {
    entry.msgstr = [strings.msgstr ?? ""];
  }
  const kind = entry.msgid === "" && entry.msgctxt === undefined ? "header" : "entry";
  return { kind, keptComments, idLines, entry };
}

function decodeQuoted(q: string, line: number): string {
  if (!q.startsWith('"') || !q.endsWith('"') || q.length < 2)
    throw new PoParseError("Malformed string", line);
  const body = q.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c === '"') throw new PoParseError('Unescaped " inside a string', line);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i];
    const simple: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      a: "\x07",
      b: "\b",
      f: "\f",
      v: "\v",
      '"': '"',
      "\\": "\\",
      "'": "'",
      "?": "?",
    };
    if (n !== undefined && n in simple) out += simple[n];
    else if (n !== undefined && /[0-7]/.test(n)) {
      const oct = /^[0-7]{1,3}/.exec(body.slice(i))?.[0] ?? n;
      out += String.fromCharCode(Number.parseInt(oct, 8));
      i += oct.length - 1;
    } else if (n === "x") {
      const hex = /^[0-9a-fA-F]+/.exec(body.slice(i + 1))?.[0];
      if (!hex) throw new PoParseError("\\x needs hex digits", line);
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += hex.length;
    } else throw new PoParseError(`Unknown escape \\${n ?? ""}`, line);
  }
  return out;
}

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
  "\x07": "\\a",
  "\b": "\\b",
  "\f": "\\f",
  "\v": "\\v",
};

export function escapeString(s: string): string {
  let out = "";
  for (const c of s) out += ESCAPES[c] ?? c;
  return out;
}

/**
 * Formats `keyword "value"` the way gettext's tools do: one line when it fits and has no
 * inner newline; otherwise `keyword ""` followed by lines split after each `\n` and
 * wrapped at spaces to `width` columns.
 */
export function formatString(keyword: string, value: string, width: number | false): string[] {
  const segments = value.split(/(?<=\n)/).map(escapeString);
  if (segments.length === 0) segments.push("");
  const single = `${keyword} "${segments.join("")}"`;
  const innerNewline = value.indexOf("\n") >= 0 && value.indexOf("\n") < value.length - 1;
  if (!innerNewline && (width === false || displayWidth(single) <= width)) return [single];
  const pieces =
    width === false ? segments : segments.flatMap((seg) => wrapSegment(seg, width - 2));
  // Nothing to break at: gettext keeps the long line as is.
  if (
    !innerNewline &&
    width !== false &&
    pieces.length === 1 &&
    displayWidth(pieces[0] ?? "") > width - 2
  ) {
    return [single];
  }
  return [`${keyword} ""`, ...pieces.map((s) => `"${s}"`)];
}

/** Splits after spaces so each piece fits `max` columns; never inside an escape. */
function wrapSegment(seg: string, max: number): string[] {
  const out: string[] = [];
  let rest = seg;
  while (displayWidth(rest) > max) {
    const chars = [...rest];
    let cut = -1;
    let col = 0;
    let pos = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i] as string;
      if (c === "\\") {
        col += 2;
        pos += 1 + (chars[i + 1]?.length ?? 0);
        i++;
      } else {
        col += charWidth(c);
        pos += c.length;
      }
      if (col > max) break;
      if (c === " ") cut = pos;
    }
    if (cut <= 0) {
      // No space within the width: break at the first space after it, as gettext does.
      const next = rest.indexOf(" ", 1);
      if (next < 0) break;
      cut = next + 1;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest !== "" || out.length === 0) out.push(rest);
  return out;
}

/** Terminal columns, as gettext counts them: combining marks take none, wide CJK takes two. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const c of s) w += charWidth(c);
  return w;
}

const ZERO_WIDTH = /[\p{Mn}\p{Me}\p{Cf}]/u;
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]/u;

function charWidth(c: string): number {
  if (ZERO_WIDTH.test(c)) return 0;
  return WIDE.test(c) ? 2 : 1;
}

function wrapReferences(refs: string[], width: number | false): string[] {
  if (width === false) return [`#: ${refs.join(" ")}`];
  const lines: string[] = [];
  let line = "#:";
  for (const r of refs) {
    if (line !== "#:" && displayWidth(line) + 1 + displayWidth(r) > width) {
      lines.push(line);
      line = "#:";
    }
    line += ` ${r}`;
  }
  lines.push(line);
  return lines;
}

export function parseHeaderFields(msgstr: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of msgstr.split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  return fields;
}
