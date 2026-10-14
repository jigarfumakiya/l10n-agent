import type { Issue } from "../core/model.js";
import type { Project } from "../core/project.js";
import { ENTRY_STATES, type LocaleStatus } from "../core/status.js";

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
    const rows = status.filter((s) => s.target === t.loaded.id);
    const total =
      rows[0]?.total ?? [...t.loaded.source.entries.values()].filter((e) => e.translatable).length;
    console.log(bold(`${t.loaded.id}`) + dim(` · ${t.loaded.label} · ${total} source strings`));
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
    const where = [i.locale, i.key && (i.form ? `${i.key}[${i.form}]` : i.key)]
      .filter(Boolean)
      .join(" ");
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
