/**
 * A small XML scanner that keeps source offsets, so values can be read back exactly as
 * written (escapes, markup and all). Android resource files only need elements, text,
 * comments, CDATA and a prolog, which is all this handles.
 */

export interface XmlElement {
  type: "element";
  name: string;
  /** Attribute values with entities decoded. */
  attrs: Record<string, string>;
  attrOrder: string[];
  children: XmlNode[];
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}
export interface XmlText {
  type: "text";
  raw: string;
  start: number;
}
export interface XmlComment {
  type: "comment";
  value: string;
  start: number;
}
export interface XmlCData {
  type: "cdata";
  value: string;
  start: number;
}
export type XmlNode = XmlElement | XmlText | XmlComment | XmlCData;

export interface XmlDocument {
  source: string;
  children: XmlNode[];
  root: XmlElement | undefined;
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
  }
}

export function lineAt(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

const NAME = /[A-Za-z_][\w:.-]*/y;
const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const WS = /\s*/y;
const BAD_AMP = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

export function parseXml(src: string): XmlDocument {
  const fail = (msg: string, at: number): never => {
    throw new XmlError(msg, at, lineAt(src, at));
  };
  const top: XmlNode[] = [];
  const stack: XmlElement[] = [];
  const push = (n: XmlNode) => (stack.at(-1)?.children ?? top).push(n);
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      if (e < 0) fail("Unclosed comment", i);
      push({ type: "comment", value: src.slice(i + 4, e), start: i });
      i = e + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const e = src.indexOf("]]>", i + 9);
      if (e < 0) fail("Unclosed CDATA section", i);
      push({ type: "cdata", value: src.slice(i + 9, e), start: i });
      i = e + 3;
    } else if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i + 2);
      if (e < 0) fail("Unclosed processing instruction", i);
      i = e + 2;
    } else if (src.startsWith("<!", i)) {
      const e = src.indexOf(">", i + 2);
      if (e < 0) fail("Unclosed declaration", i);
      i = e + 1;
    } else if (src.startsWith("</", i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(src);
      if (!m) fail("Malformed closing tag", i);
      const name = (m as RegExpExecArray)[0];
      let j = NAME.lastIndex;
      WS.lastIndex = j;
      WS.exec(src);
      j = WS.lastIndex;
      if (src[j] !== ">") fail(`Malformed closing tag </${name}>`, i);
      const el = stack.pop();
      if (!el) fail(`Unexpected </${name}>`, i);
      const open = el as XmlElement;
      if (open.name !== name) fail(`Expected </${open.name}> but found </${name}>`, i);
      open.innerEnd = i;
      open.end = j + 1;
      i = j + 1;
    } else if (src[i] === "<") {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(src);
      if (!m) fail("Malformed tag", i);
      const el: XmlElement = {
        type: "element",
        name: (m as RegExpExecArray)[0],
        attrs: {},
        attrOrder: [],
        children: [],
        start: i,
        end: -1,
        innerStart: -1,
        innerEnd: -1,
      };
      let j = NAME.lastIndex;
      for (;;) {
        WS.lastIndex = j;
        WS.exec(src);
        j = WS.lastIndex;
        if (src.startsWith("/>", j)) {
          el.innerStart = el.innerEnd = j;
          el.end = j + 2;
          push(el);
          break;
        }
        if (src[j] === ">") {
          el.innerStart = j + 1;
          push(el);
          stack.push(el);
          break;
        }
        ATTR.lastIndex = j;
        const a = ATTR.exec(src);
        if (!a) fail(`Malformed attribute in <${el.name}>`, j);
        const attr = a as RegExpExecArray;
        const raw = attr[2] ?? attr[3] ?? "";
        if (BAD_AMP.test(raw)) fail(`Unescaped & in attribute of <${el.name}>`, j);
        const attrName = attr[1] as string;
        if (attrName in el.attrs) fail(`Duplicate attribute ${attrName}`, j);
        el.attrs[attrName] = decodeEntities(raw);
        el.attrOrder.push(attrName);
        j = ATTR.lastIndex;
      }
      i = el.end > 0 ? el.end : el.innerStart;
    } else {
      const next = src.indexOf("<", i);
      const end = next < 0 ? src.length : next;
      const raw = src.slice(i, end);
      const bad = BAD_AMP.exec(raw);
      if (bad) fail("Unescaped & (write &amp;)", i + bad.index);
      if (stack.length === 0 && raw.trim() !== "") fail("Text outside the root element", i);
      push({ type: "text", raw, start: i });
      i = end;
    }
  }
  const open = stack.at(-1);
  if (open) fail(`Unclosed <${open.name}>`, open.start);
  const roots = top.filter((n): n is XmlElement => n.type === "element");
  if (roots.length > 1) fail("More than one root element", (roots[1] as XmlElement).start);
  return { source: src, children: top, root: roots[0] };
}

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return String.fromCodePoint(
          e.startsWith("#x") ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10),
        );
    }
  });
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

/** Raw text of an element's content, exactly as in the file. */
export function innerRaw(doc: XmlDocument, el: XmlElement): string {
  return doc.source.slice(el.innerStart, el.innerEnd);
}

export function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter((n): n is XmlElement => n.type === "element");
}
