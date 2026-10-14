import { displayKey, type Issue } from "../core/model.js";
import type { Project } from "../core/project.js";
import { ENTRY_STATES, type LocaleStatus } from "../core/status.js";
import type { DetectResult } from "../detect/detect.js";

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint(31);
const yellow = paint(33);
const green = paint(32);
const dim = paint(2);
const bold = paint(1);

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length))) ?? [];
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === 0 ? cell.padEnd(widths[c] ?? 0) : cell.padStart(widths[c] ?? 0)))
        .join("  "),
    )
    .join("\n");
}

export function printStatus(project: Project, status: LocaleStatus[]): void {
  for (const t of project.targets) {
    const rows = status.filter((s) => s.target === t.target.id);
    const total =
      rows[0]?.total ?? [...t.target.source.entries.values()].filter((e) => e.translatable).length;
    console.log(bold(`${t.target.id}`) + dim(` · ${t.target.label} · ${total} source strings`));
    if (rows.length === 0) {
      console.log(dim("  No target locales. Add `locales:` to the config.\n"));
      continue;
    }
    const header = ["locale", "done", ...ENTRY_STATES];
    const body = rows.map((s) => {
      const done =
        s.counts.draft +
        s.counts.reviewed +
        s.counts.approved +
        s.counts.untracked +
        s.counts.edited;
      const pct = s.total === 0 ? 100 : Math.floor((done / s.total) * 100);
      return [s.locale, `${pct}%`, ...ENTRY_STATES.map((k) => String(s.counts[k]))];
    });
    console.log(
      table([header, ...body])
        .split("\n")
        .map((l, i) => `  ${i === 0 ? dim(l) : l}`)
        .join("\n"),
    );
    console.log();
  }
}

export function printIssues(issues: Issue[]): void {
  const shown = issues.filter((i) => i.severity !== "info");
  const infos = issues.filter((i) => i.severity === "info");
  for (const i of shown) {
    const mark = i.severity === "error" ? red("✖") : yellow("▲");
    const key = i.key === undefined ? undefined : truncate(displayKey(i.key), 48);
    const where = [i.locale, key && (i.form ? `${key}[${i.form}]` : key)].filter(Boolean).join(" ");
    const loc = i.file ? dim(` ${i.file}${i.line ? `:${i.line}` : ""}`) : "";
    console.log(`${mark} ${bold(where)} ${dim(i.code)} ${i.message}${loc}`);
  }
  for (const i of infos)
    console.log(`${dim("·")} ${i.locale ? `${i.locale} ` : ""}${dim(i.message)}`);
  const errors = shown.filter((i) => i.severity === "error").length;
  const warnings = shown.length - errors;
  const summary = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`;
  console.log(errors > 0 ? red(summary) : warnings > 0 ? yellow(summary) : green(`✔ ${summary}`));
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ");
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const FORMAT_LABEL: Record<string, string> = {
  "android-xml": "Android resources",
  po: "gettext PO",
  xcstrings: "String Catalog",
};

/** Human summary of `detect`, as lines. */
export function describeDetect(result: DetectResult): string[] {
  const n = result.candidates.length;
  const lines = [
    bold(`Found ${n} localization setup${n === 1 ? "" : "s"}`) + dim(` in ${result.root}`),
    "",
  ];
  const rows = result.candidates.map((c, i) => [
    `${i + 1}.`,
    FORMAT_LABEL[c.target.format] ?? c.target.format,
    c.target.path,
    `${c.strings} string${c.strings === 1 ? "" : "s"}`,
    c.locales.length ? c.locales.join(", ") : "no translations",
    c.confidence,
  ]);
  const widths = [0, 1, 2, 3, 4].map((col) => Math.max(...rows.map((r) => (r[col] ?? "").length)));
  result.candidates.forEach((c, i) => {
    const r = rows[i] as string[];
    const conf =
      c.confidence === "high"
        ? green(c.confidence)
        : c.confidence === "medium"
          ? yellow(c.confidence)
          : red(c.confidence);
    lines.push(
      `  ${r
        .slice(0, 5)
        .map((cell, col) => cell.padEnd(widths[col] ?? 0))
        .join("  ")}  ${conf}`,
    );
    const indent = " ".repeat((widths[0] ?? 2) + 4);
    lines.push(dim(`${indent}${c.evidence.join(" · ")}`));
    if (c.target.format === "po" && c.target.template === undefined)
      lines.push(dim(`${indent}no .pot template; msgids are the source`));
    for (const q of c.questions) lines.push(`${indent}${yellow("?")} ${q}`);
  });
  for (const h of result.hints) lines.push("", yellow(h));
  const s = result.sourceLocale;
  lines.push("", `Source language: ${bold(s.value)}${dim(` (${s.reason})`)}`);
  if (result.unsupported.length) {
    lines.push("", dim("Also found, not supported yet:"));
    for (const u of result.unsupported) {
      lines.push(
        dim(
          `  · ${u.format}: ${u.files} file${u.files === 1 ? "" : "s"} (${u.examples.join(", ")}${u.files > u.examples.length ? ", …" : ""})`,
        ),
      );
    }
  }
  if (result.truncated)
    lines.push(
      "",
      yellow("Stopped after 50,000 files; run in a narrower folder with --cwd to see everything."),
    );
  return lines;
}

/** What `detect` and `init` say when nothing supported is found. */
export function describeNone(result: DetectResult): string[] {
  const lines = [
    `No supported translation files found in ${result.root}.`,
    dim("Supported: Android res/values*/strings.xml, gettext .po/.pot, Apple .xcstrings."),
  ];
  for (const h of result.hints) lines.push("", h);
  if (result.unsupported.length) {
    lines.push("", "Found, but not supported yet:");
    for (const u of result.unsupported) {
      lines.push(
        `  · ${u.format}: ${u.files} file${u.files === 1 ? "" : "s"} (${u.examples.join(", ")})`,
      );
    }
  }
  lines.push(
    "",
    dim(
      "You can also write l10n.config.yaml by hand: https://github.com/jigarfumakiya/l10n-agent#configuration",
    ),
  );
  return lines;
}
