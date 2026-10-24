/** Shared data model for a scanned repository. */

export interface FileChange {
  path: string;
  added: number;
  deleted: number;
}

export interface Commit {
  hash: string;
  author: string;
  email: string;
  /** Commit time in milliseconds since epoch. */
  timestamp: number;
  subject: string;
  files: FileChange[];
  isMerge: boolean;
}

export interface AuthorStat {
  name: string;
  email: string;
  commits: number;
  /** Fraction of sampled commits, 0..1. */
  share: number;
  first: number;
  last: number;
}

export interface WeeklyPoint {
  /** Monday 00:00 UTC of that week, ms. */
  weekStart: number;
  commits: number;
}

export interface FileChurn {
  path: string;
  changes: number;
  added: number;
  deleted: number;
  authors: number;
}

export interface LanguageStat {
  ext: string;
  label: string;
  files: number;
  bytes: number;
  /** Fraction of total bytes, 0..1. */
  share: number;
}

export interface HygieneItem {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  detail: string;
}

export interface RepoMeta {
  root: string;
  name: string;
  branch: string;
  remote: string | null;
  head: string;
  /** True when the history is clipped by a shallow clone (CI checkouts often are). */
  shallow: boolean;
  version: string | null;
  description: string | null;
}

export interface RepoScan {
  meta: RepoMeta;
  /** Number of commits actually read. */
  sampledCommits: number;
  /** Total commits in the repository history. */
  totalCommits: number;
  truncated: boolean;
  firstCommit: number;
  lastCommit: number;
  commits: Commit[];
  authors: AuthorStat[];
  weekly: WeeklyPoint[];
  churn: FileChurn[];
  languages: LanguageStat[];
  hygiene: HygieneItem[];
  counts: {
    trackedFiles: number;
    testFiles: number;
    sourceFiles: number;
    largestFileBytes: number;
    largestFilePath: string | null;
    todoMentions: number;
  };
  activity: {
    commits30d: number;
    commits90d: number;
    activeWeeksRecent: number;
    weeksWindow: number;
    avgPerWeek: number;
    longestStreakDays: number;
    lastCommitAgeDays: number;
  };
}

export interface Dimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  summary: string;
  hints: string[];
}

export interface ScoreResult {
  total: number;
  grade: string;
  dimensions: Dimension[];
}
