import { describe, expect, it } from "vitest";
import { findPlaceholders, type PlaceholderSyntax } from "../src/core/placeholders.js";

const ids = (text: string, syntax: PlaceholderSyntax) =>
  findPlaceholders(text, syntax).map((p) => (p.type ? `${p.id}:${p.type}` : p.id));

describe("placeholder syntaxes", () => {
  it.each<[PlaceholderSyntax, string, string[]]>([
    ["java", "%1$s has %2$d, 50% off, 100%%", ["1:s", "2:d"]],
    ["c", "%s used %lu of %zu (%.1f%%)", ["1:s", "2:u", "3:u", "4:f"]],
    ["c", "%2$s %1$i", ["2:s", "1:d"]],
    ["python", "Hi %(name)s, %(count)d new", ["name:s", "count:d"]],
    ["python", "%s and %d", ["1:s", "2:d"]],
    ["python-brace", "Spent {amount} of {budget:.2f}, {{literal}}", ["amount", "budget"]],
    ["python-brace", "{0} and {1}, {}", ["1", "2", "1"]],
    ["java-message", "{0} files in {1,number}", ["1", "2"]],
    ["qt", "%1 of %2 (%10)", ["1", "2", "10"]],
    ["ruby", "Hello %{name}", ["name"]],
    ["i18next", "Hello {{name}}, {{- html}} {{count, number}}", ["name", "html", "count"]],
    ["none", "%s {x} {{y}}", []],
  ])("%s: %s", (syntax, text, expected) => {
    expect(ids(text, syntax)).toEqual(expected);
  });
});
