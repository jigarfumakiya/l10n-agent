import { describe, expect, it } from "vitest";
import { innerRaw, parseXml, type XmlError } from "../src/formats/android/xml.js";

describe("parseXml", () => {
  it("keeps exact inner text with markup and entities", () => {
    const doc = parseXml('<resources><string name="a">Hi <b>you</b> &amp; me</string></resources>');
    const el = doc.root?.children[0];
    expect(el?.type).toBe("element");
    if (el?.type !== "element") return;
    expect(el.attrs.name).toBe("a");
    expect(innerRaw(doc, el)).toBe("Hi <b>you</b> &amp; me");
  });

  it("reads comments, CDATA, prolog and self-closing tags", () => {
    const doc = parseXml('<?xml version="1.0"?>\n<!-- c --><r><x/><![CDATA[<i>]]></r>');
    expect(doc.children[1]).toMatchObject({ type: "comment", value: " c " });
    expect(doc.root?.children.map((c) => c.type)).toEqual(["element", "cdata"]);
  });

  it.each([
    ["<r><a></r>", /Expected <\/a>/],
    ["<r>Tom & Jerry</r>", /Unescaped &/],
    ["<r a='1' a='2'/>", /Duplicate attribute/],
    ["<r>", /Unclosed <r>/],
    ["<r/><s/>", /More than one root/],
  ])("rejects %s", (src, msg) => {
    expect(() => parseXml(src)).toThrow(msg);
  });

  it("reports the line of the problem", () => {
    try {
      parseXml("<r>\n\n<a></b></r>");
      expect.unreachable();
    } catch (e) {
      expect((e as XmlError).line).toBe(3);
    }
  });
});
