import { scoreColor } from "../metrics.js";
import type { Dimension, RepoScan, ScoreResult } from "../types.js";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PALETTE = ["#4f9df7", "#3fb950", "#d29922", "#bc8cff", "#f85149", "#39c5cf", "#ff9bce", "#e3742b", "#8b949e", "#7cc243"];

const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const num = (value: number): string => value.toLocaleString("en-US");
const pct = (value: number): string => {
  const ratio = value * 100;
  return ratio > 0 && ratio < 1 ? "<1%" : `${Math.round(ratio)}%`;
};
const day = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
};
const shortDay = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

const SCORE_VAR: Record<ReturnType<typeof scoreColor>, string> = {
  green: "var(--green)",
  lime: "var(--lime)",
  amber: "var(--amber)",
  orange: "var(--orange)",
  red: "var(--red)",
};

export interface RenderOptions {
  version: string;
  /** Repo URL used for links, when known. */
  repoUrl?: string | null;
}

/** Render the whole self-contained report: one file, no external assets. */
export function renderReport(scan: RepoScan, result: ScoreResult, options: RenderOptions): string {
  const color = SCORE_VAR[scoreColor(result.total)];
  const scoreText = String(result.total);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(scan.meta.name)} · RepoLens report</title>
<meta name="description" content="Repository health report for ${esc(scan.meta.name)} — scored ${scoreText}/100.">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

  <header class="hero">
    <div class="hero-text">
      <p class="eyebrow"><span class="dot"></span> REPOLENS · REPOSITORY HEALTH</p>
      <h1>${esc(scan.meta.name)}</h1>
      <p class="desc">${esc(scan.meta.description ?? (scan.meta.remote ?? "Local repository"))}</p>
      <ul class="facts">
        <li><span>Branch</span>${esc(scan.meta.branch)}</li>
        <li><span>Head</span>${esc(scan.meta.head || "—")}</li>
        <li><span>Commits</span>${num(scan.totalCommits)}</li>
        <li><span>History</span>${day(scan.firstCommit)} → ${day(scan.lastCommit)}</li>
        <li><span>Files</span>${num(scan.counts.trackedFiles)}</li>
      </ul>
    </div>
    <div class="hero-score">
      ${ring(result.total, color)}
      <div class="grade" style="color:${color}">${result.grade}</div>
      <div class="grade-label">health score</div>
    </div>
  </header>

  ${scan.meta.shallow ? shallowNotice(scan) : ""}

  <section class="card">
    <div class="card-head">
      <h2>Scorecard</h2>
      <p class="muted">Weighted across five dimensions — click a row for the evidence and next steps.</p>
    </div>
    <div class="dims">
      ${result.dimensions
        .map((dimension) =>
          dimensionRow(dimension, dimension.key === weakest(result.dimensions)?.key),
        )
        .join("\n")}
    </div>
  </section>

  <div class="cols">
    <section class="card">
      <div class="card-head">
        <h2>Commit cadence</h2>
        <p class="muted">Last 52 weeks · ${num(scan.activity.commits30d)} commits in the last 30 days</p>
      </div>
      ${activityChart(scan)}
      <div class="stats">
        ${stat("Per week", scan.activity.avgPerWeek.toFixed(1))}
        ${stat("Active weeks", `${scan.activity.activeWeeksRecent}/${scan.activity.weeksWindow}`)}
        ${stat("Longest streak", `${scan.activity.longestStreakDays}d`)}
        ${stat("Last commit", scan.activity.lastCommitAgeDays === 0 ? "today" : `${scan.activity.lastCommitAgeDays}d ago`)}
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Languages</h2>
        <p class="muted">By tracked file size</p>
      </div>
      ${donut(scan)}
    </section>
  </div>

  <div class="cols">
    <section class="card">
      <div class="card-head">
        <h2>Contributors</h2>
        <p class="muted">${scan.authors.length} author${scan.authors.length === 1 ? "" : "s"} · bus factor ${busFactor(scan)}</p>
      </div>
      ${contributors(scan)}
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Hygiene</h2>
        <p class="muted">Project files that shape how others can use and join</p>
      </div>
      ${hygiene(scan)}
    </section>
  </div>

  <section class="card">
    <div class="card-head">
      <h2>Hotspots</h2>
      <p class="muted">Files touched by the most commits — where future bugs and merge pain live</p>
    </div>
    ${churnTable(scan)}
  </section>

  <footer>
    <p>Generated by <strong>RepoLens ${esc(options.version)}</strong> on ${day(Date.now())} · ${num(scan.sampledCommits)} of ${num(scan.totalCommits)} commits analysed${scan.truncated ? " (history truncated)" : ""}.</p>
    <p>Free of network calls, accounts and telemetry. Run it again after your next release.</p>
  </footer>
</div>
</body>
</html>
`;
}

function ring(score: number, color: string): string {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
  return `<svg class="ring" viewBox="0 0 128 128" role="img" aria-label="Health score ${score} out of 100">
    <circle cx="64" cy="64" r="${radius}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"/>
    <circle cx="64" cy="64" r="${radius}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" transform="rotate(-90 64 64)"/>
    <text x="64" y="72" text-anchor="middle" font-size="34" font-weight="700" fill="#e6edf3">${score}</text>
    <text x="64" y="92" text-anchor="middle" font-size="10" fill="#8b949e" letter-spacing="1.2">/ 100</text>
  </svg>`;
}

function shallowNotice(scan: RepoScan): string {
  const many = scan.sampledCommits === 1 ? "commit" : "commits";
  const verb = scan.sampledCommits === 1 ? "is" : "are";
  return `<section class="card notice">
    <p class="notice-title">Partial history · this is a shallow clone</p>
    <p class="notice-body">Only ${num(scan.sampledCommits)} ${many} ${verb} visible, so activity and collaboration are scored on an incomplete record.
    Run <code>git fetch --unshallow</code> (or drop <code>--depth</code> from the clone) and analyse again for the real numbers.</p>
  </section>`;
}

function weakest(dimensions: Dimension[]): Dimension | undefined {
  return [...dimensions].sort((a, b) => a.score - b.score)[0];
}

function dimensionRow(dimension: Dimension, open = false): string {
  const color = SCORE_VAR[scoreColor(dimension.score)];
  const hints = dimension.hints.slice(0, 2).map((hint) => `<li>${esc(hint)}</li>`).join("");
  return `<details class="dim"${open ? " open" : ""}>
    <summary>
      <span class="dim-label">${esc(dimension.label)}<em>${pct(dimension.weight)} weight</em></span>
      <span class="track"><i style="width:${dimension.score}%;background:${color}"></i></span>
      <span class="dim-score" style="color:${color}">${dimension.score}<span class="chev">›</span></span>
    </summary>
    <div class="dim-body">
      <p>${esc(dimension.summary)}</p>
      ${hints ? `<ul class="hints">${hints}</ul>` : ""}
    </div>
  </details>`;
}

function activityChart(scan: RepoScan): string {
  const weekly = scan.weekly;
  const width = 760;
  const height = 170;
  const pad = { top: 16, right: 4, bottom: 24, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...weekly.map((point) => point.commits));
  const slot = innerW / weekly.length;
  const barWidth = Math.max(2, slot - 3);
  const avg = weekly.reduce((sum, point) => sum + point.commits, 0) / (weekly.length || 1);
  const avgY = pad.top + innerH - (avg / max) * innerH;

  const bars = weekly
    .map((point, index) => {
      const barHeight = (point.commits / max) * innerH;
      const x = pad.left + index * slot;
      const y = pad.top + innerH - barHeight;
      const label = `${day(point.weekStart)} · ${point.commits} commit${point.commits === 1 ? "" : "s"}`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, barHeight).toFixed(1)}" rx="2" class="bar"><title>${esc(label)}</title></rect>`;
    })
    .join("");

  const ticks = [0, 0.5, 1]
    .map((ratio) => {
      const value = Math.round(max * ratio);
      const y = pad.top + innerH - ratio * innerH;
      return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" class="grid"/><text x="${pad.left - 6}" y="${y + 3}" text-anchor="end" class="tickText">${value}</text>`;
    })
    .join("");

  const first = weekly[0];
  const middle = weekly[Math.floor(weekly.length / 2)];
  const last = weekly[weekly.length - 1];
  const axis = [first, middle, last]
    .filter((point): point is NonNullable<typeof point> => Boolean(point))
    .map((point, index, array) => {
      const slotIndex = weekly.indexOf(point);
      const x = pad.left + slotIndex * slot + barWidth / 2;
      const anchor = index === 0 ? "start" : index === array.length - 1 ? "end" : "middle";
      return `<text x="${x.toFixed(1)}" y="${height - 6}" text-anchor="${anchor}" class="tickText">${shortDay(point.weekStart)}</text>`;
    })
    .join("");

  return `<div class="chart">
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Commits per week over the last 52 weeks">
      ${ticks}
      ${bars}
      <line x1="${pad.left}" x2="${width - pad.right}" y1="${avgY.toFixed(1)}" y2="${avgY.toFixed(1)}" class="avg"/>
      ${axis}
    </svg>
  </div>`;
}

function donut(scan: RepoScan): string {
  const items = scan.languages.slice(0, 6);
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  if (total === 0) return `<p class="muted">No language data.</p>`;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  const segments = items
    .map((item, index) => {
      const share = item.bytes / total;
      const length = share * circumference;
      const circle = `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${PALETTE[index % PALETTE.length]}" stroke-width="20"
        stroke-dasharray="${Math.max(0, length - 1.5).toFixed(2)} ${(circumference - length + 1.5).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 80 80)"><title>${esc(item.label)} · ${pct(share)}</title></circle>`;
      offset += length;
      return circle;
    })
    .join("");

  const legend = items
    .map((item, index) => `<li><i style="background:${PALETTE[index % PALETTE.length]}"></i><span>${esc(item.label)}</span><b>${pct(item.bytes / total)}</b></li>`)
    .join("");

  return `<div class="donutWrap">
    <svg class="donut" viewBox="0 0 160 160" role="img" aria-label="Language mix">${segments}<text x="80" y="84" text-anchor="middle" class="donutText">${esc(items[0]?.label ?? "")}</text></svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

function contributors(scan: RepoScan): string {
  const authors = scan.authors.slice(0, 8);
  const max = authors[0]?.commits ?? 1;
  const rows = authors
    .map((author, index) => {
      const width = Math.max(2, (author.commits / max) * 100);
      return `<li class="author">
        <span class="avatar" style="background:${PALETTE[index % PALETTE.length]}">${esc(initials(author.name))}</span>
        <span class="who"><b>${esc(author.name)}</b><em>${esc(author.email || "—")}</em></span>
        <span class="authorBar"><i style="width:${width.toFixed(1)}%;background:${PALETTE[index % PALETTE.length]}"></i></span>
        <span class="count">${num(author.commits)}<em>${pct(author.share)}</em></span>
      </li>`;
    })
    .join("");
  return `<ul class="authors">${rows}</ul>`;
}

function busFactor(scan: RepoScan): string {
  const top = scan.authors[0]?.share ?? 1;
  return top > 0.45 ? "1" : top > 0.3 ? "1–2" : top > 0.2 ? "2–3" : "3+";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] ?? "?").slice(0, 2).toUpperCase();
  return `${(parts[0] ?? "?")[0] ?? ""}${(parts[parts.length - 1] ?? "?")[0] ?? ""}`.toUpperCase();
}

function hygiene(scan: RepoScan): string {
  const items = scan.hygiene
    .map((item) => `<li class="${item.ok ? "ok" : "miss"}" title="${esc(item.detail)}">
      <span class="mark">${item.ok ? "✓" : "✕"}</span>
      <span class="item-label">${esc(item.label)}</span>
      <em>${esc(item.detail)}</em>
    </li>`)
    .join("");
  return `<ul class="checks">${items}</ul>`;
}

function churnTable(scan: RepoScan): string {
  const rows = scan.churn.slice(0, 8);
  if (rows.length === 0) return `<p class="muted">No file changes in the sampled history.</p>`;
  const max = rows[0]?.changes ?? 1;
  const body = rows
    .map((file) => {
      const width = Math.max(2, (file.changes / max) * 100);
      return `<tr>
        <td class="path">${esc(file.path)}</td>
        <td class="numCell"><span class="fileBar"><i style="width:${width.toFixed(1)}%"></i></span>${num(file.changes)}</td>
        <td class="add">+${num(file.added)}</td>
        <td class="del">−${num(file.deleted)}</td>
        <td class="numCell">${file.authors}</td>
      </tr>`;
    })
    .join("");
  return `<table class="churn">
    <thead><tr><th>File</th><th>Commits</th><th>Added</th><th>Deleted</th><th>Authors</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

const CSS = `
:root {
  --bg: #0b0e14;
  --panel: #121722;
  --panel-2: #161d2b;
  --line: rgba(255,255,255,.08);
  --text: #e6edf3;
  --muted: #8b949e;
  --accent: #4f9df7;
  --green: #3fb950;
  --lime: #7cc243;
  --amber: #d29922;
  --orange: #e3742b;
  --red: #f85149;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background:
    radial-gradient(900px 500px at 15% -10%, rgba(79,157,247,.16), transparent 60%),
    radial-gradient(700px 400px at 92% 0%, rgba(188,140,255,.12), transparent 55%),
    var(--bg);
  color: var(--text);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1080px; margin: 0 auto; padding: 56px 24px 72px; }
.hero { display: flex; gap: 32px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 28px; }
.eyebrow { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 11px; letter-spacing: 2.4px; color: var(--muted); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
h1 { margin: 0; font-size: 44px; line-height: 1.1; letter-spacing: -1.2px; }
.desc { margin: 10px 0 0; color: var(--muted); max-width: 620px; }
.facts { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 20px 0 0; }
.facts li { font-size: 12px; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; }
.facts span { color: var(--muted); margin-right: 6px; }
.hero-score { text-align: center; }
.ring { width: 150px; height: 150px; display: block; }
.grade { font-size: 22px; font-weight: 700; letter-spacing: 2px; margin-top: 2px; }
.grade-label { font-size: 11px; letter-spacing: 1.6px; color: var(--muted); text-transform: uppercase; }
.card { background: linear-gradient(180deg, var(--panel), var(--panel-2)); border: 1px solid var(--line); border-radius: 16px; padding: 22px 24px; margin-bottom: 20px; }
.notice { border-color: rgba(210,153,34,.45); background: linear-gradient(180deg, rgba(210,153,34,.10), rgba(18,23,34,.98)); }
.notice-title { margin: 0 0 6px; font-size: 13px; letter-spacing: .3px; color: var(--amber); font-weight: 600; }
.notice-body { margin: 0; color: var(--muted); font-size: 13px; }
code { font: 12px/1.5 ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace; background: rgba(255,255,255,.07); border-radius: 5px; padding: 1px 5px; color: #c9d1d9; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
h2 { font-size: 13px; letter-spacing: 1.6px; text-transform: uppercase; margin: 0; color: #c9d1d9; }
.muted { color: var(--muted); font-size: 12.5px; margin: 0; }
.cols { display: grid; grid-template-columns: 1.55fr 1fr; gap: 20px; align-items: start; }
@media (max-width: 860px) { .cols { grid-template-columns: 1fr; } h1 { font-size: 34px; } }

.dims { display: flex; flex-direction: column; gap: 2px; }
.dim { border-top: 1px solid var(--line); }
.dim:first-child { border-top: 0; }
.dim summary { display: grid; grid-template-columns: 220px 1fr 48px; gap: 18px; align-items: center; padding: 11px 0; cursor: pointer; list-style: none; }
.dim summary::-webkit-details-marker { display: none; }
.dim-label { font-size: 14px; display: flex; align-items: baseline; gap: 10px; }
.dim-label em { font-style: normal; font-size: 11px; color: var(--muted); }
.track { height: 7px; border-radius: 6px; background: rgba(255,255,255,.06); overflow: hidden; }
.track i { display: block; height: 100%; border-radius: 6px; }
.dim-score { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; font-size: 16px; }
.chev { display: inline-block; margin-left: 8px; color: var(--muted); font-weight: 400; transition: transform .15s ease; }
details[open] .chev { transform: rotate(90deg); }
.dim-body { padding: 0 0 14px 238px; color: var(--muted); font-size: 13px; }
.dim-body p { margin: 0 0 8px; }
.hints { margin: 0; padding-left: 16px; }
.hints li { margin: 4px 0; color: #c9d1d9; }
@media (max-width: 720px) {
  .dim summary { grid-template-columns: 1fr 44px; }
  .track { grid-column: 1 / -1; order: 3; }
  .dim-body { padding-left: 0; }
}

.chart svg { width: 100%; height: 190px; display: block; }
.bar { fill: var(--accent); opacity: .85; }
.bar:hover { opacity: 1; }
.grid { stroke: rgba(255,255,255,.06); stroke-width: 1; }
.avg { stroke: rgba(255,255,255,.25); stroke-dasharray: 3 4; stroke-width: 1; }
.tickText { fill: #6e7681; font-size: 10px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 8px; border-top: 1px solid var(--line); padding-top: 14px; }
.stat b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.stat span { font-size: 11px; color: var(--muted); letter-spacing: .4px; }
@media (max-width: 520px) { .stats { grid-template-columns: repeat(2, 1fr); } }

.donutWrap { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.donut { width: 150px; height: 150px; flex: 0 0 auto; }
.donutText { fill: #c9d1d9; font-size: 12px; letter-spacing: .6px; }
.legend { list-style: none; padding: 0; margin: 0; flex: 1 1 160px; display: flex; flex-direction: column; gap: 7px; font-size: 12.5px; }
.legend li { display: flex; align-items: center; gap: 9px; }
.legend i { width: 9px; height: 9px; border-radius: 3px; flex: 0 0 auto; }
.legend span { color: #c9d1d9; }
.legend b { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 500; }

.authors { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.author { display: grid; grid-template-columns: 30px minmax(120px, 1.2fr) 1fr auto; gap: 12px; align-items: center; }
.avatar { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #0b0e14; }
.who { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
.who b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who em { font-style: normal; font-size: 10.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.authorBar { height: 6px; border-radius: 4px; background: rgba(255,255,255,.06); overflow: hidden; }
.authorBar i { display: block; height: 100%; border-radius: 4px; }
.count { font-variant-numeric: tabular-nums; font-size: 13px; text-align: right; }
.count em { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); }

.checks { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
.checks li { display: grid; grid-template-columns: 18px auto; gap: 4px 8px; font-size: 12.5px; align-items: center; }
.checks em { grid-column: 2; font-style: normal; font-size: 10.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mark { font-size: 12px; text-align: center; border-radius: 50%; width: 18px; height: 18px; line-height: 18px; }
.ok .mark { background: rgba(63,185,80,.16); color: var(--green); }
.miss .mark { background: rgba(248,81,73,.14); color: var(--red); }
.miss .item-label { color: #8b949e; }
@media (max-width: 520px) { .checks { grid-template-columns: 1fr; } }

.churn { width: 100%; border-collapse: collapse; font-size: 13px; }
.churn th { text-align: left; font-weight: 500; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); padding: 0 10px 8px 0; border-bottom: 1px solid var(--line); }
.churn td { padding: 9px 10px 9px 0; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
.churn tr:last-child td { border-bottom: 0; }
.path { font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace; font-size: 12px; color: #c9d1d9; word-break: break-all; }
.numCell { white-space: nowrap; font-variant-numeric: tabular-nums; color: #c9d1d9; }
.add { color: var(--green); font-variant-numeric: tabular-nums; white-space: nowrap; }
.del { color: var(--red); font-variant-numeric: tabular-nums; white-space: nowrap; }
.fileBar { display: inline-block; vertical-align: middle; width: 64px; height: 5px; border-radius: 4px; background: rgba(255,255,255,.06); margin-right: 8px; overflow: hidden; }
.fileBar i { display: block; height: 100%; background: var(--accent); }

footer { margin-top: 28px; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding-top: 18px; }
footer p { margin: 4px 0; }
footer strong { color: #c9d1d9; font-weight: 600; }

@media print {
  body { background: #fff; color: #111; }
  .card { background: #fff; border-color: #ddd; break-inside: avoid; }
  h1, .dim-label, .stat b, .legend span, .checks li, .path, .numCell { color: #111; }
  .muted, .facts span, .who em, .tickText { color: #555; }
  .bar { fill: #2f6fbf; }
}
`;
