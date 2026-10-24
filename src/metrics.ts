import type { Dimension, RepoScan, ScoreResult } from "./types.js";

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const pct = (value: number): string => `${Math.round(value * 100)}%`;

const WEIGHTS = {
  hygiene: 0.25,
  activity: 0.2,
  collaboration: 0.2,
  structure: 0.2,
  quality: 0.15,
} as const;

/** Turn one scan into five scored dimensions and a weighted total. */
export function evaluate(scan: RepoScan): ScoreResult {
  const dimensions = [
    hygieneDimension(scan),
    activityDimension(scan),
    collaborationDimension(scan),
    structureDimension(scan),
    qualityDimension(scan),
  ];
  const total = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0));
  return { total, grade: grade(total), dimensions };
}

export function grade(total: number): string {
  if (total >= 90) return "A+";
  if (total >= 80) return "A";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  return "E";
}

/** 0..1 colour ramp used by the report and the badge. */
export function scoreColor(total: number): "green" | "lime" | "amber" | "orange" | "red" {
  if (total >= 85) return "green";
  if (total >= 70) return "lime";
  if (total >= 55) return "amber";
  if (total >= 40) return "orange";
  return "red";
}

function hygieneDimension(scan: RepoScan): Dimension {
  const total = scan.hygiene.reduce((sum, item) => sum + item.weight, 0) || 1;
  const earned = scan.hygiene.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0);
  const missing = scan.hygiene.filter((item) => !item.ok);
  const hints = missing
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((item) => `Add ${item.label} — ${item.detail.toLowerCase()}`);
  return {
    key: "hygiene",
    label: "Project hygiene",
    score: Math.round((earned / total) * 100),
    weight: WEIGHTS.hygiene,
    summary: `${scan.hygiene.length - missing.length}/${scan.hygiene.length} project files present`,
    hints,
  };
}

function activityDimension(scan: RepoScan): Dimension {
  const { commits30d, commits90d, activeWeeksRecent, weeksWindow, lastCommitAgeDays } = scan.activity;
  const recent = clamp01(commits30d / 20);
  const quarter = clamp01(commits90d / 60);
  const consistency = clamp01(activeWeeksRecent / Math.max(1, weeksWindow));
  const score = Math.round(100 * (recent * 0.45 + quarter * 0.3 + consistency * 0.25));

  const hints: string[] = [];
  if (lastCommitAgeDays > 180) hints.push(`No commits for ${lastCommitAgeDays} days — ship a small change or archive the project`);
  else if (commits30d === 0) hints.push("No commits in the last 30 days — steady small commits beat rare big drops");
  if (consistency < 0.4) hints.push(`Commits landed in only ${activeWeeksRecent}/${weeksWindow} recent weeks`);
  if (commits30d > 0 && commits30d < 3) hints.push("Commit volume is low — even docs and tests count");

  return {
    key: "activity",
    label: "Activity",
    score,
    weight: WEIGHTS.activity,
    summary: `${commits30d} commits in 30 days · ${commits90d} in 90 · ${pct(consistency)} of recent weeks active`,
    hints,
  };
}

function collaborationDimension(scan: RepoScan): Dimension {
  const contributors = scan.authors.length;
  const topShare = scan.authors[0]?.share ?? 1;
  const breadth = clamp01(contributors / 8);
  const busFactor = topShare <= 0.3 ? 1 : clamp01(1 - (topShare - 0.3) / 0.6);
  const score = Math.round(100 * (breadth * 0.45 + busFactor * 0.55));

  const hints: string[] = [];
  if (contributors === 1) hints.push("Single author — every external PR is a bus-factor improvement");
  else if (topShare > 0.7) hints.push(`${pct(topShare)} of commits come from one person — review and release access are concentrated`);
  if (contributors < 3) hints.push("Document setup steps so a new contributor can open a first PR in minutes");

  return {
    key: "collaboration",
    label: "Collaboration",
    score,
    weight: WEIGHTS.collaboration,
    summary: `${contributors} contributor${contributors === 1 ? "" : "s"} · top author owns ${pct(topShare)} of commits`,
    hints,
  };
}

function structureDimension(scan: RepoScan): Dimension {
  const { testFiles, largestFileBytes, largestFilePath, todoMentions } = scan.counts;
  const testScore = testFiles > 0 ? 1 : 0.3;
  const sizeScore = clamp01(1 - (largestFileBytes - 100 * 1024) / (1900 * 1024));
  const totalChanges = scan.churn.reduce((sum, file) => sum + file.changes, 0) || 1;
  const hotspot = (scan.churn[0]?.changes ?? 0) / totalChanges;
  const hotspotScore = clamp01(1 - (hotspot - 0.05) / 0.2);
  const todoScore = todoMentions <= 5 ? 1 : clamp01(1 - (todoMentions - 5) / 45);
  const score = Math.round(100 * (testScore * 0.3 + sizeScore * 0.2 + hotspotScore * 0.25 + todoScore * 0.25));

  const hints: string[] = [];
  if (testFiles === 0) hints.push("No tests found — one smoke test already unlocks CI and confidence");
  if (largestFilePath && largestFileBytes > 512 * 1024) {
    hints.push(`${largestFilePath} is ${Math.round(largestFileBytes / 1024)} KB — split it before it becomes unmergeable`);
  }
  if (hotspot > 0.15 && scan.churn[0]) hints.push(`${scan.churn[0].path} absorbs ${pct(hotspot)} of all file changes — a refactor hotspot`);
  if (todoMentions > 20) hints.push(`${todoMentions} TODO/FIXME markers — convert the oldest ones into issues`);

  return {
    key: "structure",
    label: "Code structure",
    score,
    weight: WEIGHTS.structure,
    summary: `${scan.counts.sourceFiles} source files · ${testFiles} test files · ${todoMentions} TODO markers`,
    hints,
  };
}

const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: /i;
const VAGUE = /^(wip|wip:|update|updates|fix|fixes|changes?|stuff|misc|temp|test|save|commit|\.+)$/i;

function qualityDimension(scan: RepoScan): Dimension {
  const subjects = scan.commits.filter((commit) => !commit.isMerge).map((commit) => commit.subject.trim());
  const total = subjects.length || 1;
  const conventional = subjects.filter((subject) => CONVENTIONAL.test(subject)).length / total;
  const goodLength = subjects.filter((subject) => subject.length >= 20 && subject.length <= 72).length / total;
  const vague = subjects.filter((subject) => VAGUE.test(subject) || subject.length < 8).length / total;
  const score = Math.round(100 * (clamp01(conventional) * 0.45 + clamp01(goodLength) * 0.25 + (1 - clamp01(vague)) * 0.3));

  const hints: string[] = [];
  if (conventional < 0.5) hints.push("Adopt Conventional Commits (feat:/fix:) so history generates changelogs and reads as intent");
  if (goodLength < 0.5) hints.push("Keep subjects in the 20–72 character window; the body holds the why");
  if (vague > 0.1) hints.push(`${Math.round(vague * 100)}% of subjects are vague ("update", "fix", "wip") — name what changed`);

  return {
    key: "quality",
    label: "Commit quality",
    score,
    weight: WEIGHTS.quality,
    summary: `${pct(conventional)} conventional · ${pct(goodLength)} well-sized subjects · ${pct(vague)} vague`,
    hints,
  };
}
