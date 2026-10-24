import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { grade, scoreColor } from "../dist/metrics.js";
import { renderBadge } from "../dist/report/badge.js";
import { renderReport } from "../dist/report/html.js";
import type { RepoScan, ScoreResult } from "../dist/types.js";

const scan: RepoScan = {
  meta: {
    root: "/tmp/demo",
    name: "demo",
    branch: "main",
    remote: "https://github.com/acme/demo.git",
    head: "abc1234",
    version: "1.0.0",
    description: "A <demo> & sample",
  },
  sampledCommits: 3,
  totalCommits: 3,
  truncated: false,
  firstCommit: Date.UTC(2024, 0, 1),
  lastCommit: Date.UTC(2024, 5, 1),
  commits: [],
  authors: [
    { name: "Ada", email: "ada@example.com", commits: 2, share: 2 / 3, first: 0, last: 0 },
    { name: "Bo", email: "bo@example.com", commits: 1, share: 1 / 3, first: 0, last: 0 },
  ],
  weekly: Array.from({ length: 52 }, (_, index) => ({
    weekStart: Date.UTC(2024, 0, 1) + index * 7 * 86_400_000,
    commits: index % 3,
  })),
  churn: [{ path: "src/<index>.ts", changes: 9, added: 10, deleted: 2, authors: 2 }],
  languages: [
    { ext: ".ts", label: "TypeScript", files: 4, bytes: 1000, share: 0.8 },
    { ext: ".md", label: "Markdown", files: 1, bytes: 250, share: 0.2 },
  ],
  hygiene: [
    { id: "readme", label: "README", ok: true, weight: 12, detail: "README.md" },
    { id: "license", label: "License", ok: false, weight: 10, detail: "No license file" },
  ],
  counts: {
    trackedFiles: 5,
    testFiles: 1,
    sourceFiles: 4,
    largestFileBytes: 2048,
    largestFilePath: "src/index.ts",
    todoMentions: 2,
  },
  activity: {
    commits30d: 3,
    commits90d: 3,
    activeWeeksRecent: 2,
    weeksWindow: 4,
    avgPerWeek: 0.75,
    longestStreakDays: 2,
    lastCommitAgeDays: 12,
  },
};

const score: ScoreResult = {
  total: 78,
  grade: "B",
  dimensions: [
    { key: "hygiene", label: "Project hygiene", score: 60, weight: 0.25, summary: "1/2 files", hints: ["Add License"] },
    { key: "activity", label: "Activity", score: 80, weight: 0.2, summary: "3 commits", hints: [] },
    { key: "collaboration", label: "Collaboration", score: 70, weight: 0.2, summary: "2 authors", hints: [] },
    { key: "structure", label: "Code structure", score: 90, weight: 0.2, summary: "4 files", hints: [] },
    { key: "quality", label: "Commit quality", score: 85, weight: 0.15, summary: "ok", hints: [] },
  ],
};

describe("html report", () => {
  const html = renderReport(scan, score, { version: "0.1.0" });

  it("is a standalone document with no external requests", () => {
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /width:\s*100%/);
  });

  it("escapes repository content", () => {
    assert.match(html, /A &lt;demo&gt; &amp; sample/);
    assert.match(html, /src\/&lt;index&gt;\.ts/);
    assert.doesNotMatch(html, /<demo>/);
  });

  it("states the score and grade", () => {
    assert.match(html, />78</);
    assert.match(html, />B</);
    assert.match(html, /health score/i);
  });

  it("renders one row per dimension", () => {
    const rows = html.match(/class="dim"/g) ?? [];
    assert.equal(rows.length, 5);
  });
});

describe("badge", () => {
  it("renders a valid svg with the score", () => {
    const svg = renderBadge(78, "B");
    assert.match(svg, /^<svg xmlns=/);
    assert.match(svg, />78\/100</);
    assert.match(svg, /width="\d+"/);
    assert.match(svg, /#7cc243/); // lime bucket for 78
  });
});

describe("scoring helpers", () => {
  it("maps totals to grades", () => {
    assert.equal(grade(95), "A+");
    assert.equal(grade(84), "A");
    assert.equal(grade(71), "B");
    assert.equal(grade(10), "E");
  });

  it("maps totals to colour buckets", () => {
    assert.equal(scoreColor(95), "green");
    assert.equal(scoreColor(30), "red");
  });
});
