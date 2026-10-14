import { describe, expect, it } from "vitest";
import { pluralCategories } from "../src/core/plurals.js";

describe("pluralCategories", () => {
  it.each([
    ["en", ["one", "other"]],
    ["hi", ["one", "other"]],
    ["ar", ["zero", "one", "two", "few", "many", "other"]],
    ["ja", ["other"]],
    ["ru", ["one", "few", "many", "other"]],
  ])("%s", (locale, expected) => {
    expect(pluralCategories(locale)).toEqual(expected);
  });
});
