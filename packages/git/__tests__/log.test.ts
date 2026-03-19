import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCommits } from "../src/log";

async function initRepo(dir: string) {
  const run = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

async function commit(dir: string, message: string, file: string = "file.txt") {
  await writeFile(join(dir, file), `${Date.now()}`);
  await Bun.spawn(["git", "add", "."], { cwd: dir }).exited;
  await Bun.spawn(["git", "commit", "-m", message], { cwd: dir }).exited;
}

describe("getCommits", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-log-"));
    await initRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns commits from HEAD to beginning when no fromRef given", async () => {
    await commit(tempDir, "feat: first feature");
    await commit(tempDir, "fix: a bug fix");

    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe("fix: a bug fix");
    expect(commits[1].message).toBe("feat: first feature");
  });

  it("returns commits between two refs", async () => {
    await commit(tempDir, "feat: first");
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await commit(tempDir, "fix: second");
    await commit(tempDir, "feat: third");

    const commits = await getCommits(tempDir, "v1.0.0", "HEAD");
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe("feat: third");
    expect(commits[1].message).toBe("fix: second");
  });

  it("includes full commit hash", async () => {
    await commit(tempDir, "feat: test");
    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits[0].hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("filters commits by path", async () => {
    await Bun.spawn(["mkdir", "-p", "src", "docs"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "src/index.ts"), "export default 1;");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add index"], { cwd: tempDir }).exited;

    await writeFile(join(tempDir, "docs/readme.md"), "# Docs");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "docs: add readme"], { cwd: tempDir }).exited;

    await writeFile(join(tempDir, "src/utils.ts"), "export const x = 1;");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add utils"], { cwd: tempDir }).exited;

    const srcCommits = await getCommits(tempDir, null, "HEAD", ["src"]);
    expect(srcCommits).toHaveLength(2);
    expect(srcCommits[0].message).toBe("feat: add utils");
    expect(srcCommits[1].message).toBe("feat: add index");

    const docsCommits = await getCommits(tempDir, null, "HEAD", ["docs"]);
    expect(docsCommits).toHaveLength(1);
    expect(docsCommits[0].message).toBe("docs: add readme");
  });

  it("path filtering works with ref range", async () => {
    await Bun.spawn(["mkdir", "-p", "pkg-a", "pkg-b"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "pkg-a/file.ts"), "a1");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: a1"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;

    await writeFile(join(tempDir, "pkg-a/file.ts"), "a2");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: a2"], { cwd: tempDir }).exited;

    await writeFile(join(tempDir, "pkg-b/file.ts"), "b1");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: b1"], { cwd: tempDir }).exited;

    const aCommits = await getCommits(tempDir, "v1.0.0", "HEAD", ["pkg-a"]);
    expect(aCommits).toHaveLength(1);
    expect(aCommits[0].message).toBe("feat: a2");

    const bCommits = await getCommits(tempDir, "v1.0.0", "HEAD", ["pkg-b"]);
    expect(bCommits).toHaveLength(1);
    expect(bCommits[0].message).toBe("feat: b1");
  });

  it("returns empty when no commits match the path", async () => {
    await Bun.spawn(["mkdir", "-p", "src"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "src/index.ts"), "code");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: code"], { cwd: tempDir }).exited;

    const commits = await getCommits(tempDir, null, "HEAD", ["nonexistent"]);
    expect(commits).toHaveLength(0);
  });

  it("includes multiline body", async () => {
    await writeFile(join(tempDir, "file.txt"), "content");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(
      [
        "git",
        "commit",
        "-m",
        "feat: with body\n\nThis is the body.\n\nBREAKING CHANGE: something broke",
      ],
      { cwd: tempDir },
    ).exited;

    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits[0].message).toBe("feat: with body");
    expect(commits[0].body).toContain("This is the body.");
    expect(commits[0].body).toContain("BREAKING CHANGE: something broke");
  });
});
