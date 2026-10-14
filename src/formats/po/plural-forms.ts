import type { PluralSpec } from "../../core/model.js";
import { describeSamples, SAMPLE_INTEGERS } from "../../core/plurals.js";

/**
 * gettext `Plural-Forms: nplurals=N; plural=EXPR;`. EXPR is a C expression over `n` that
 * returns the form index. It is parsed into a function here; nothing is ever `eval`ed.
 */
export interface PluralForms {
  nplurals: number;
  expression: string;
  select: (n: number) => number;
}

export class PluralFormsError extends Error {}

export function parsePluralForms(header: string): PluralForms {
  const np = /nplurals\s*=\s*(\d+)/.exec(header);
  const ex = /plural\s*=\s*([^;]+);?/.exec(header.replace(/nplurals\s*=\s*\d+\s*;?/, ""));
  if (!np?.[1] || !ex?.[1]) throw new PluralFormsError(`Cannot read Plural-Forms: "${header}"`);
  const nplurals = Number(np[1]);
  if (nplurals < 1) throw new PluralFormsError("nplurals must be at least 1");
  const expression = ex[1].trim();
  return { nplurals, expression, select: compile(expression) };
}

type Fn = (n: number) => number;

function compile(src: string): Fn {
  const tokens = src.match(/\s*(\d+|n|&&|\|\||==|!=|<=|>=|[-+*/%<>!?:()])\s*/gy);
  if (!tokens || tokens.join("").length !== src.length) {
    throw new PluralFormsError(`Unsupported plural expression: "${src}"`);
  }
  const toks = tokens.map((t) => t.trim());
  let pos = 0;
  const peek = () => toks[pos];
  const take = (t?: string) => {
    const v = toks[pos];
    if (t !== undefined && v !== t)
      throw new PluralFormsError(`Expected "${t}" in plural expression "${src}"`);
    pos++;
    return v;
  };
  const bin = (next: () => Fn, ops: Record<string, (a: number, b: number) => number>) => (): Fn => {
    let left = next();
    for (let op = peek(); op !== undefined && op in ops; op = peek()) {
      take();
      const right = next();
      const f = ops[op] as (a: number, b: number) => number;
      const l = left;
      left = (n) => f(l(n), right(n));
    }
    return left;
  };
  const num = (b: boolean) => (b ? 1 : 0);
  const primary = (): Fn => {
    const t = take();
    if (t === "n") return (n) => n;
    if (t !== undefined && /^\d+$/.test(t)) {
      const v = Number(t);
      return () => v;
    }
    if (t === "(") {
      const e = ternary();
      take(")");
      return e;
    }
    if (t === "!") {
      const e = primary();
      return (n) => num(e(n) === 0);
    }
    if (t === "-") {
      const e = primary();
      return (n) => -e(n);
    }
    throw new PluralFormsError(`Unexpected "${t ?? "end"}" in plural expression "${src}"`);
  };
  const mul = bin(primary, {
    "*": (a, b) => a * b,
    "/": (a, b) => (b === 0 ? 0 : Math.trunc(a / b)),
    "%": (a, b) => (b === 0 ? 0 : a % b),
  });
  const add = bin(mul, { "+": (a, b) => a + b, "-": (a, b) => a - b });
  const rel = bin(add, {
    "<": (a, b) => num(a < b),
    ">": (a, b) => num(a > b),
    "<=": (a, b) => num(a <= b),
    ">=": (a, b) => num(a >= b),
  });
  const eq = bin(rel, { "==": (a, b) => num(a === b), "!=": (a, b) => num(a !== b) });
  const and = bin(eq, { "&&": (a, b) => num(a !== 0 && b !== 0) });
  const or = bin(and, { "||": (a, b) => num(a !== 0 || b !== 0) });
  function ternary(): Fn {
    const cond = or();
    if (peek() !== "?") return cond;
    take("?");
    const yes = ternary();
    take(":");
    const no = ternary();
    return (n) => (cond(n) !== 0 ? yes(n) : no(n));
  }
  const fn = ternary();
  if (pos !== toks.length)
    throw new PluralFormsError(`Unexpected "${toks[pos]}" in plural expression "${src}"`);
  return fn;
}

/**
 * Standard rules for languages with more than two forms, as gettext, Weblate and most
 * PO editors write them. Two-form languages are derived from CLDR instead.
 */
const STANDARD: Record<string, string> = {
  ar: "nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5);",
  ru: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  uk: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  be: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  sr: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  hr: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  bs: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  pl: "nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);",
  cs: "nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;",
  sk: "nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;",
  lt: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && (n%100<10 || n%100>=20) ? 1 : 2);",
  lv: "nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n != 0 ? 1 : 2);",
  ro: "nplurals=3; plural=(n==1 ? 0 : (n==0 || (n%100 > 0 && n%100 < 20)) ? 1 : 2);",
  sl: "nplurals=4; plural=(n%100==1 ? 0 : n%100==2 ? 1 : n%100==3 || n%100==4 ? 2 : 3);",
  ga: "nplurals=5; plural=(n==1 ? 0 : n==2 ? 1 : n<7 ? 2 : n<11 ? 3 : 4);",
};

/**
 * The rule a new PO file for `locale` should get. Uses the standard table, else derives it
 * from CLDR for one- and two-form languages. Returns undefined when neither works (then
 * the user sets `pluralForms` in the config).
 */
export function defaultPluralForms(locale: string): string | undefined {
  const lang = locale.split("-")[0] ?? locale;
  const std = STANDARD[locale] ?? STANDARD[lang];
  if (std) return std;
  const rules = new Intl.PluralRules(locale);
  const ints = SAMPLE_INTEGERS.slice(0, 1001);
  const used = new Set(ints.map((n) => rules.select(n)));
  if (used.size === 1) return "nplurals=1; plural=0;";
  if (used.size === 2) {
    const one = ints.filter((n) => rules.select(n) !== "other");
    if (one.length === 1 && one[0] === 1) return "nplurals=2; plural=(n != 1);";
    if (one.length === 2 && one[0] === 0 && one[1] === 1) return "nplurals=2; plural=(n > 1);";
  }
  return undefined;
}

/** Describes each form of a gettext rule with sample counts, for checks and for translators. */
export function gettextPluralSpec(forms: PluralForms, source: string): PluralSpec {
  const byIndex = Array.from({ length: forms.nplurals }, () => [] as number[]);
  for (const n of SAMPLE_INTEGERS) {
    const i = forms.select(n);
    if (i >= 0 && i < forms.nplurals) byIndex[i]?.push(n);
  }
  return {
    scheme: "gettext",
    source,
    forms: byIndex.map((ns, i) => ({
      id: String(i),
      examples: ns.length ? describeSamples(ns) : "never used",
      countImplied: ns.length === 1,
    })),
  };
}

/** Indexes the rule can return that are outside `0 … nplurals-1` (a broken header). */
export function outOfRangeForms(forms: PluralForms): number[] {
  const bad = new Set<number>();
  for (const n of SAMPLE_INTEGERS) {
    const i = forms.select(n);
    if (i < 0 || i >= forms.nplurals) bad.add(i);
  }
  return [...bad].sort((a, b) => a - b);
}
