import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { isGitRepo, readCommits } from "../dist/git.js";
import { scan } from "../dist/scan.js";
import { evaluate } from "../dist/metrics.js";
import { renderReport } from "../dist/report/html.js";

const created: string[] = [];

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "repolens-"));
  created.push(dir);
  const run = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  run("init", "--initial-branch=main");
  run("config", "user.email", "dev@example.com");
  run("config", "user.name", "Dev Example");
  run("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# demo\n\nA demo project.\n");
  writeFileSync(join(dir, "src", "index.ts"), "export const answer = 42;\n");
  run("add", "-A");
  run("commit", "-m", "feat: initial commit with a useful message");
  writeFileSync(join(dir, "src", "extra.ts"), "export const extra = true;\n");
  run("add", "-A");
  run("commit", "-m", "fix(core): handle the empty case correctly");
  return dir;
}

after(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows keeps git objects read-only; a leftover temp dir must not fail the suite.
    }
  }
});

describe("git layer", () => {
  it("detects a repository", async () => {
    const dir = makeRepo();
    assert.equal(await isGitRepo(dir), true);
    assert.equal(await isGitRepo(tmpdir()), false);
  });

  it("parses commits with per-file line stats", async () => {
    const dir = makeRepo();
    const { commits, truncated } = await readCommits(dir, 100);
    assert.equal(commits.length, 2);
    assert.equal(truncated, false);
    assert.equal(commits[0]?.subject, "fix(core): handle the empty case correctly");
    const files = commits[0]?.files.map((file) => file.path) ?? [];
    assert.deepEqual(files, ["src/extra.ts"]);
    assert.equal(commits[0]?.files[0]?.added, 1);
  });

  it("reports truncation when history exceeds the limit", async () => {
    const dir = makeRepo();
    const { commits, truncated } = await readCommits(dir, 1);
    assert.equal(truncated, true);
    assert.equal(commits.length, 1);
  });
});

describe("scan", () => {
  it("builds a full report model for a small repository", async () => {
    const dir = makeRepo();
    const result = await scan(dir);
    assert.equal(result.meta.name, dir.split(/[\\/]/).pop());
    assert.equal(result.sampledCommits, 2);
    assert.equal(result.authors.length, 1);
    assert.equal(result.weekly.length, 52);
    assert.equal(result.hygiene.length, 11);
    assert.ok(result.churn.some((file) => file.path === "src/index.ts"));
    assert.ok(result.languages.some((language) => language.label === "TypeScript"));

    const score = evaluate(result);
    assert.ok(score.total >= 0 && score.total <= 100);
    assert.equal(score.dimensions.length, 5);
    assert.match(score.grade, /^[ABCDE]\+?$/);
  });

  it("flags a shallow clone so partial history is not read as decline", async () => {
    const source = makeRepo();
    const shallow = mkdtempSync(join(tmpdir(), "repolens-shallow-"));
    created.push(shallow);
    execFileSync("git", ["clone", "--depth", "1", `file://${source.replace(/\\/g, "/")}`, shallow], { encoding: "utf8" });

    const partial = await scan(shallow);
    assert.equal(partial.meta.shallow, true);
    assert.equal(partial.sampledCommits, 1);
    const html = renderReport(partial, evaluate(partial), { version: "test" });
    assert.match(html, /shallow clone/);
    assert.match(html, /git fetch --unshallow/);

    const full = await scan(source);
    assert.equal(full.meta.shallow, false);
  });

  it("refuses a directory that is not a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repolens-plain-"));
    created.push(dir);
    await assert.rejects(() => scan(dir), /Not a git repository/);
  });
});
