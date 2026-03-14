import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getCommits } from "../src/log";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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

  it("includes multiline body", async () => {
    await writeFile(join(tempDir, "file.txt"), "content");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(
      ["git", "commit", "-m", "feat: with body\n\nThis is the body.\n\nBREAKING CHANGE: something broke"],
      { cwd: tempDir },
    ).exited;

    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits[0].message).toBe("feat: with body");
    expect(commits[0].body).toContain("This is the body.");
    expect(commits[0].body).toContain("BREAKING CHANGE: something broke");
  });
});
