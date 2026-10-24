#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluate, scoreColor } from "./metrics.js";
import { renderBadge } from "./report/badge.js";
import { renderReport } from "./report/html.js";
import { scan } from "./scan.js";

const HELP = `repolens — a health report for any git repository

Usage
  repolens [path] [options]

Options
  -o, --out <file>     HTML report path            (default: report.html)
  -b, --badge <file>   also write an SVG badge
  -j, --json           print the raw metrics as JSON
      --limit <n>      commits to analyse          (default: 5000)
      --min <score>    exit 1 when the health score is below this value
      --open           open the report when done
      --no-color       disable terminal colours
  -h, --help           show this help
  -v, --version        print the version

Examples
  npx repolens .
  repolens ~/code/my-app --badge badge.svg --open
  repolens . --json | jq .total
`;

const VERSION = readVersion();

const useColor =
  process.env.NO_COLOR === undefined && process.stdout.isTTY === true && !process.argv.includes("--no-color");

const paint = (code: number, text: string): string => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (text: string): string => paint(90, text);
const bold = (text: string): string => paint(1, text);

const SCORE_ANSI: Record<ReturnType<typeof scoreColor>, number> = {
  green: 32,
  lime: 92,
  amber: 33,
  orange: 91,
  red: 31,
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o", default: "report.html" },
      badge: { type: "string", short: "b" },
      json: { type: "boolean", short: "j", default: false },
      limit: { type: "string" },
      min: { type: "string" },
      open: { type: "boolean", default: false },
      color: { type: "boolean", default: true },
      "no-color": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const target = resolve(positionals[0] ?? ".");
  const limit = values.limit ? Number.parseInt(values.limit, 10) : undefined;
  if (values.limit && (!Number.isFinite(limit) || (limit ?? 0) < 50)) {
    fail("--limit must be a number of at least 50 commits.");
  }

  const minimum = values.min ? Number(values.min) : undefined;
  if (values.min && (!Number.isFinite(minimum) || (minimum ?? 0) < 0 || (minimum ?? 0) > 100)) {
    fail("--min must be a score between 0 and 100.");
  }

  const result = await scan(target, { limit });
  const score = evaluate(result);

  if (values.json) {
    const payload = {
      schema: "repolens/1",
      meta: result.meta,
      total: score.total,
      grade: score.grade,
      dimensions: score.dimensions,
      activity: result.activity,
      counts: result.counts,
      authors: result.authors.map(({ name, commits, share, first, last }) => ({ name, commits, share, first, last })),
      languages: result.languages,
      hygiene: result.hygiene,
      sampledCommits: result.sampledCommits,
      totalCommits: result.totalCommits,
      truncated: result.truncated,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const outPath = resolve(values.out);
  mkdirSync(dirname(outPath), { recursive: true });
  const html = renderReport(result, score, { version: VERSION });
  writeFileSync(outPath, html, "utf8");

  let badgePath: string | null = null;
  if (values.badge) {
    badgePath = resolve(values.badge);
    mkdirSync(dirname(badgePath), { recursive: true });
    writeFileSync(badgePath, renderBadge(score.total, score.grade), "utf8");
  }

  printSummary(target, score, result.meta.name);
  if (result.meta.shallow) {
    process.stdout.write(
      `\n${paint(33, "note")} ${dim("shallow clone — history is partial, so activity and collaboration read low. Run \`git fetch --unshallow\` for the full picture.")}\n`,
    );
  }
  process.stdout.write(`\n${dim("Report")} ${displayPath(outPath)}${dim(` (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`)}\n`);
  if (badgePath) process.stdout.write(`${dim("Badge ")} ${displayPath(badgePath)}\n`);

  if (values.open) openInBrowser(outPath);

  if (minimum !== undefined && score.total < minimum) {
    process.stderr.write(`repolens: health score ${score.total} is below the required ${minimum}\n`);
    process.exitCode = 1;
  }
}

function printSummary(target: string, score: ReturnType<typeof evaluate>, name: string): void {
  const colour = SCORE_ANSI[scoreColor(score.total)];
  process.stdout.write(`\n${bold(name)} ${dim(target)}\n\n`);
  for (const dimension of score.dimensions) {
    const colourCode = SCORE_ANSI[scoreColor(dimension.score)];
    const filled = Math.round(dimension.score / 5);
    const bar = `${paint(colourCode, "█".repeat(filled))}${dim("░".repeat(20 - filled))}`;
    const label = dimension.label.padEnd(18);
    process.stdout.write(`  ${label} ${bar} ${paint(colourCode, String(dimension.score).padStart(3))}  ${dim(dimension.summary)}\n`);
  }
  const hints = score.dimensions.flatMap((dimension) => dimension.hints).slice(0, 3);
  if (hints.length > 0) {
    process.stdout.write(`\n${dim("Next moves")}\n`);
    for (const hint of hints) process.stdout.write(`  ${paint(36, "→")} ${hint}\n`);
  }
  process.stdout.write(`\n  ${dim("Health")} ${paint(1, String(score.total))}${dim("/100")} ${paint(colour, score.grade)}\n`);
}

function displayPath(path: string): string {
  const relativePath = relative(process.cwd(), path);
  return relativePath.startsWith("..") || relativePath === "" ? path : relativePath;
}

function openInBrowser(path: string): void {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  try {
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    process.stderr.write(`Could not open ${path} automatically.\n`);
  }
}

function fail(message: string): never {
  process.stderr.write(`repolens: ${message}\n`);
  process.exit(1);
}

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
