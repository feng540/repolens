import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, sep } from "node:path";
import { isGitRepo, listFiles, readCommits, repoMeta, tryGit } from "./git.js";
import type {
  AuthorStat,
  Commit,
  FileChurn,
  HygieneItem,
  LanguageStat,
  RepoScan,
  WeeklyPoint,
} from "./types.js";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

const LANGUAGE_LABELS: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C/C++ header",
  ".cpp": "C++",
  ".cc": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".sh": "Shell",
  ".ps1": "PowerShell",
  ".lua": "Lua",
  ".dart": "Dart",
  ".scala": "Scala",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".html": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sql": "SQL",
  ".md": "Markdown",
  ".json": "JSON",
  ".yml": "YAML",
  ".yaml": "YAML",
};

const SKIP_BYTES_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz",
  ".tar", ".7z", ".mp4", ".mp3", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".exe",
  ".dll", ".so", ".dylib", ".node", ".wasm", ".map",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go",
  ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".cc", ".hpp", ".cs", ".rb", ".php",
  ".sh", ".ps1", ".lua", ".dart", ".scala", ".vue", ".svelte", ".sql",
]);

const TEST_PATTERN = /(^|[\\/])(tests?|__tests__|spec|e2e)([\\/]|$)|[._-](test|spec)\.[a-z]+$/i;

export interface ScanOptions {
  /** Maximum commits to read. Default 5000. */
  limit?: number;
  /** Files to stat for the language mix. Default 20000. */
  maxFiles?: number;
}

/** Collect everything the report needs from one repository. */
export async function scan(target: string, options: ScanOptions = {}): Promise<RepoScan> {
  if (!(await isGitRepo(target))) {
    throw new Error(`Not a git repository: ${target}`);
  }
  // Accepting a subdirectory is useful; every path below is relative to the top level.
  const root = (await tryGit(target, ["rev-parse", "--show-toplevel"]))?.trim() || target;
  const limit = Math.max(50, options.limit ?? 5000);
  const maxFiles = Math.max(100, options.maxFiles ?? 20000);

  const [metaBase, log, files] = await Promise.all([
    repoMeta(root),
    readCommits(root, limit),
    listFiles(root),
  ]);

  const packageJson = readPackageJson(root);
  const meta = {
    ...metaBase,
    version: packageJson?.version ?? null,
    description: packageJson?.description ?? null,
  };

  const commits = log.commits;
  if (commits.length === 0) {
    throw new Error("Repository has no commits yet.");
  }

  const authors = buildAuthors(commits);
  const weekly = buildWeekly(commits, 52);
  const churn = buildChurn(commits);
  const languages = buildLanguages(root, files, maxFiles);
  const counts = buildCounts(root, files);
  const todoMentions = await countTodos(root);
  counts.todoMentions = todoMentions;

  const firstCommit = commits[commits.length - 1]?.timestamp ?? 0;
  const lastCommit = commits[0]?.timestamp ?? 0;
  const now = Date.now();

  const activity = buildActivity(commits, now, firstCommit);

  const hygiene = buildHygiene(root, packageJson, counts.testFiles);

  return {
    meta,
    sampledCommits: commits.length,
    totalCommits: metaBase.totalCommits,
    truncated: log.truncated,
    firstCommit,
    lastCommit,
    commits,
    authors,
    weekly,
    churn,
    languages,
    hygiene,
    counts,
    activity,
  };
}

function buildAuthors(commits: Commit[]): AuthorStat[] {
  const byKey = new Map<string, AuthorStat>();
  // One person often commits under several names; keep the one they use most.
  const nameCounts = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    const key = commit.email || commit.author.toLowerCase();
    const names = nameCounts.get(key) ?? new Map<string, number>();
    names.set(commit.author, (names.get(commit.author) ?? 0) + 1);
    nameCounts.set(key, names);
    const existing = byKey.get(key);
    if (existing) {
      existing.commits += 1;
      existing.last = Math.max(existing.last, commit.timestamp);
      existing.first = Math.min(existing.first, commit.timestamp);
    } else {
      byKey.set(key, {
        name: commit.author,
        email: commit.email,
        commits: 1,
        share: 0,
        first: commit.timestamp,
        last: commit.timestamp,
      });
    }
  }
  const total = commits.length || 1;
  const list = [...byKey.values()];
  for (const author of list) {
    author.share = author.commits / total;
    const names = nameCounts.get(author.email || author.name.toLowerCase());
    if (names) {
      const best = [...names.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best?.[0]) author.name = best[0];
    }
  }
  return list.sort((a, b) => b.commits - a.commits);
}

function weekStart(timestamp: number): number {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.getTime();
}

function buildWeekly(commits: Commit[], weeks: number): WeeklyPoint[] {
  const currentWeek = weekStart(Date.now());
  const buckets: WeeklyPoint[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    buckets.push({ weekStart: currentWeek - i * WEEK, commits: 0 });
  }
  const index = new Map(buckets.map((bucket, i) => [bucket.weekStart, i]));
  for (const commit of commits) {
    const at = index.get(weekStart(commit.timestamp));
    const bucket = at === undefined ? undefined : buckets[at];
    if (bucket) bucket.commits += 1;
  }
  return buckets;
}

function buildChurn(commits: Commit[]): FileChurn[] {
  const map = new Map<string, { changes: number; added: number; deleted: number; authors: Set<string> }>();
  for (const commit of commits) {
    for (const file of commit.files) {
      const entry = map.get(file.path) ?? { changes: 0, added: 0, deleted: 0, authors: new Set<string>() };
      entry.changes += 1;
      entry.added += file.added;
      entry.deleted += file.deleted;
      entry.authors.add(commit.email || commit.author);
      map.set(file.path, entry);
    }
  }
  return [...map.entries()]
    .map(([path, entry]) => ({
      path,
      changes: entry.changes,
      added: entry.added,
      deleted: entry.deleted,
      authors: entry.authors.size,
    }))
    .sort((a, b) => b.changes - a.changes);
}

function buildLanguages(root: string, files: string[], maxFiles: number): LanguageStat[] {
  const sample = files.slice(0, maxFiles);
  const byExt = new Map<string, { files: number; bytes: number }>();
  for (const relative of sample) {
    const ext = extname(relative).toLowerCase();
    if (!ext || SKIP_BYTES_EXT.has(ext)) continue;
    if (/\.(lock|min\.js|min\.css|map)$/i.test(relative)) continue;
    let bytes = 0;
    try {
      bytes = statSync(join(root, relative)).size;
    } catch {
      bytes = 0;
    }
    const entry = byExt.get(ext) ?? { files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += bytes;
    byExt.set(ext, entry);
  }
  const entries = [...byExt.entries()];
  const totalBytes = entries.reduce((sum, [, value]) => sum + value.bytes, 0) || 1;
  return entries
    .map(([ext, value]) => ({
      ext,
      label: LANGUAGE_LABELS[ext] ?? ext.replace(".", "").toUpperCase(),
      files: value.files,
      bytes: value.bytes,
      share: value.bytes / totalBytes,
    }))
    .filter((item) => item.bytes > 0 || item.files > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);
}

function buildCounts(root: string, files: string[]) {
  let testFiles = 0;
  let sourceFiles = 0;
  let largestFileBytes = 0;
  let largestFilePath: string | null = null;

  for (const relative of files) {
    const ext = extname(relative).toLowerCase();
    if (CODE_EXTENSIONS.has(ext)) sourceFiles += 1;
    if (TEST_PATTERN.test(relative)) testFiles += 1;
    if (SKIP_BYTES_EXT.has(ext)) continue;
    try {
      const size = statSync(join(root, relative)).size;
      if (size > largestFileBytes) {
        largestFileBytes = size;
        largestFilePath = relative;
      }
    } catch {
      // Ignore unreadable files.
    }
  }

  return {
    trackedFiles: files.length,
    testFiles,
    sourceFiles,
    largestFileBytes,
    largestFilePath,
    todoMentions: 0,
  };
}

async function countTodos(root: string): Promise<number> {
  const out = await tryGit(root, ["grep", "-c", "-I", "-E", "\\b(TODO|FIXME|HACK)\\b"]);
  if (!out) return 0;
  let total = 0;
  for (const line of out.split("\n")) {
    const count = Number.parseInt(line.slice(line.lastIndexOf(":") + 1), 10);
    if (!Number.isNaN(count)) total += count;
  }
  return total;
}

function buildActivity(commits: Commit[], now: number, firstCommit: number) {
  const c30 = commits.filter((c) => now - c.timestamp <= 30 * DAY).length;
  const c90 = commits.filter((c) => now - c.timestamp <= 90 * DAY).length;

  const windowWeeks = Math.max(1, Math.min(26, Math.ceil((now - firstCommit) / WEEK) || 1));
  const windowStart = now - windowWeeks * WEEK;
  const weeksWithCommits = new Set<number>();
  let inWindow = 0;
  for (const commit of commits) {
    if (commit.timestamp < windowStart) continue;
    inWindow += 1;
    weeksWithCommits.add(weekStart(commit.timestamp));
  }

  const days = new Set<number>();
  for (const commit of commits) {
    const date = new Date(commit.timestamp);
    date.setUTCHours(0, 0, 0, 0);
    days.add(date.getTime());
  }
  const sortedDays = [...days].sort((a, b) => a - b);
  let longestStreak = 0;
  let streak = 0;
  let previous = 0;
  for (const day of sortedDays) {
    streak = previous && day - previous === DAY ? streak + 1 : 1;
    previous = day;
    longestStreak = Math.max(longestStreak, streak);
  }

  const lastCommit = commits[0]?.timestamp ?? now;
  return {
    commits30d: c30,
    commits90d: c90,
    activeWeeksRecent: weeksWithCommits.size,
    weeksWindow: windowWeeks,
    avgPerWeek: inWindow / windowWeeks,
    longestStreakDays: longestStreak,
    lastCommitAgeDays: Math.max(0, Math.floor((now - lastCommit) / DAY)),
  };
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function findFirst(root: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

function globExists(root: string, directory: string, pattern: RegExp): string | null {
  const dir = join(root, directory);
  if (!existsSync(dir)) return null;
  try {
    for (const entry of readdirSync(dir)) {
      if (pattern.test(entry)) return join(directory, entry);
    }
  } catch {
    return null;
  }
  return null;
}

function buildHygiene(root: string, pkg: PackageJson | null, testFiles: number): HygieneItem[] {
  const readme = findFirst(root, ["README.md", "README.markdown", "readme.md", "README.rst", "README.txt"]);
  const license = findFirst(root, ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "COPYING"]);
  const ci =
    findFirst(root, [".gitlab-ci.yml", ".travis.yml", "azure-pipelines.yml", "Jenkinsfile", ".circleci/config.yml"]) ??
    globExists(root, ".github/workflows", /\.ya?ml$/i);
  const gitignore = findFirst(root, [".gitignore"]);
  const lockfile = findFirst(root, [
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock",
    "Cargo.lock", "poetry.lock", "uv.lock", "go.sum", "Gemfile.lock", "composer.lock",
  ]);
  const contributing = findFirst(root, ["CONTRIBUTING.md", "CONTRIBUTING.MD", "docs/CONTRIBUTING.md"]);
  const changelog = findFirst(root, ["CHANGELOG.md", "CHANGELOG.MD", "HISTORY.md", "CHANGES.md"]);
  const security = findFirst(root, ["SECURITY.md", ".github/SECURITY.md"]);
  const editorconfig = findFirst(root, [".editorconfig"]);
  const hasMetadata = Boolean(pkg?.description && (pkg?.keywords?.length ?? 0) >= 3);
  const hasLicenseField = Boolean(pkg?.license) || Boolean(license);

  return [
    { id: "readme", label: "README", ok: Boolean(readme), weight: 12, detail: readme ?? "No README found" },
    { id: "license", label: "License", ok: hasLicenseField, weight: 10, detail: license ?? (pkg?.license ? `package.json: ${pkg.license}` : "No license file") },
    { id: "ci", label: "CI pipeline", ok: Boolean(ci), weight: 12, detail: ci ?? "No CI configuration" },
    { id: "tests", label: "Tests", ok: testFiles > 0, weight: 12, detail: testFiles > 0 ? `${testFiles} test files` : "No test files detected" },
    { id: "metadata", label: "Package metadata", ok: hasMetadata, weight: 8, detail: hasMetadata ? "description + keywords present" : "Missing description or keywords" },
    { id: "gitignore", label: ".gitignore", ok: Boolean(gitignore), weight: 6, detail: gitignore ?? "Not present" },
    { id: "lockfile", label: "Lockfile", ok: Boolean(lockfile), weight: 6, detail: lockfile ?? "No dependency lockfile" },
    { id: "contributing", label: "CONTRIBUTING", ok: Boolean(contributing), weight: 6, detail: contributing ?? "Not present" },
    { id: "changelog", label: "CHANGELOG", ok: Boolean(changelog), weight: 6, detail: changelog ?? "Not present" },
    { id: "security", label: "Security policy", ok: Boolean(security), weight: 4, detail: security ?? "Not present" },
    { id: "editorconfig", label: ".editorconfig", ok: Boolean(editorconfig), weight: 4, detail: editorconfig ?? "Not present" },
  ];
}
