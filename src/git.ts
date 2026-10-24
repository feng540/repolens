import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import type { Commit, FileChange } from "./types.js";

const run = promisify(execFile);
const MAX_BUFFER = 512 * 1024 * 1024;
const FIELD = "\u001f";
// NUL cannot be passed as a Windows process argument, so records start with \x01.
const RECORD = "\u0001";

export class GitError extends Error {}

/** Run a git command inside `root` and return stdout. */
export async function git(root: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], {
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string; message?: string; code?: number };
    const detail = (err.stderr || err.message || "").trim();
    throw new GitError(`git ${args.join(" ")} failed: ${detail}`);
  }
}

/** Run git and return null when the command fails (expected misses). */
export async function tryGit(root: string, args: string[]): Promise<string | null> {
  try {
    return await git(root, args);
  } catch {
    return null;
  }
}

export async function isGitRepo(root: string): Promise<boolean> {
  const out = await tryGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return out?.trim() === "true";
}

export async function repoMeta(root: string) {
  const [branch, remote, head, count, shallow] = await Promise.all([
    tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    tryGit(root, ["config", "--get", "remote.origin.url"]),
    tryGit(root, ["rev-parse", "--short", "HEAD"]),
    tryGit(root, ["rev-list", "--count", "HEAD"]),
    tryGit(root, ["rev-parse", "--is-shallow-repository"]),
  ]);
  const cleanRemote = remote?.trim() || null;
  return {
    root,
    name: guessName(root, cleanRemote),
    branch: branch?.trim() || "HEAD",
    remote: cleanRemote,
    head: head?.trim() || "",
    shallow: shallow?.trim() === "true",
    totalCommits: Number.parseInt(count?.trim() || "0", 10) || 0,
  };
}

function guessName(root: string, remote: string | null): string {
  if (remote) {
    const match = remote
      .replace(/\.git$/, "")
      .match(/[/:]([\w.-]+)$/);
    if (match?.[1]) return match[1];
  }
  return basename(root.replace(/[\\/]+$/, "")) || "repository";
}

const numstatPattern = /^(-|\d+)\t(-|\d+)\t(.+)$/;

/**
 * Read the commit log (newest first) together with per-file line stats.
 * A single `git log` call keeps this fast even on large histories.
 */
export async function readCommits(root: string, limit: number): Promise<{ commits: Commit[]; truncated: boolean }> {
  const raw = await git(root, [
    "log",
    `--max-count=${limit + 1}`,
    "--date=iso-strict",
    "--no-renames",
    "--numstat",
    `--pretty=format:%x01%H%x1f%an%x1f%ae%x1f%aI%x1f%s`,
  ]);

  const commits: Commit[] = [];
  const records = raw.split(RECORD);
  for (const record of records) {
    if (!record.trim()) continue;
    const newline = record.indexOf("\n");
    const header = newline === -1 ? record : record.slice(0, newline);
    const body = newline === -1 ? "" : record.slice(newline + 1);
    const [hash, author, email, iso, ...subjectParts] = header.split(FIELD);
    if (!hash || !author || !iso) continue;
    const subject = subjectParts.join(FIELD).trim();
    const files: FileChange[] = [];
    for (const line of body.split("\n")) {
      const match = numstatPattern.exec(line);
      if (!match) continue;
      files.push({
        path: match[3] ?? "",
        added: match[1] === "-" ? 0 : Number.parseInt(match[1] ?? "0", 10),
        deleted: match[2] === "-" ? 0 : Number.parseInt(match[2] ?? "0", 10),
      });
    }
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) continue;
    commits.push({
      hash,
      author: author.trim(),
      email: email?.toLowerCase().trim() ?? "",
      timestamp,
      subject,
      files,
      isMerge: files.length === 0 && /^Merge\b/i.test(subject),
    });
  }

  const truncated = commits.length > limit;
  return { commits: truncated ? commits.slice(0, limit) : commits, truncated };
}

/** Tracked file paths, relative to the repo root. */
export async function listFiles(root: string): Promise<string[]> {
  const raw = await git(root, ["ls-files", "-z"]);
  return raw.split("\u0000").filter((p) => p.length > 0);
}
