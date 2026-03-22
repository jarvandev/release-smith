import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getChangedFiles, getChangedFilesForCommits } from "../src/diff";

async function initRepo(dir: string) {
  const run = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

describe("getChangedFiles", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-diff-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns files changed in a commit", async () => {
    await mkdir(join(tempDir, "packages/core/src"), { recursive: true });
    await writeFile(join(tempDir, "packages/core/src/index.ts"), "export {}");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: init"], { cwd: tempDir }).exited;
    const log = await new Response(
      Bun.spawn(["git", "log", "--format=%H", "-1"], { cwd: tempDir, stdout: "pipe" }).stdout,
    ).text();
    const hash = log.trim();
    const files = await getChangedFiles(tempDir, hash);
    expect(files).toContain("packages/core/src/index.ts");
  });

  it("returns multiple files from a single commit", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await writeFile(join(tempDir, "b.txt"), "b");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: two files"], { cwd: tempDir }).exited;
    const log = await new Response(
      Bun.spawn(["git", "log", "--format=%H", "-1"], { cwd: tempDir, stdout: "pipe" }).stdout,
    ).text();
    const hash = log.trim();
    const files = await getChangedFiles(tempDir, hash);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });
});

async function getLatestHash(dir: string): Promise<string> {
  const log = await new Response(
    Bun.spawn(["git", "log", "--format=%H", "-1"], { cwd: dir, stdout: "pipe" }).stdout,
  ).text();
  return log.trim();
}

describe("getChangedFilesForCommits", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-diff-batch-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns empty map for empty hashes array", async () => {
    const result = await getChangedFilesForCommits(tempDir, []);
    expect(result.size).toBe(0);
  });

  it("returns changed files for a single commit", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add a"], { cwd: tempDir }).exited;
    const hash = await getLatestHash(tempDir);

    const result = await getChangedFilesForCommits(tempDir, [hash]);
    expect(result.size).toBe(1);
    expect(result.get(hash)).toContain("a.txt");
  });

  it("returns changed files for multiple commits", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add a"], { cwd: tempDir }).exited;
    const hash1 = await getLatestHash(tempDir);

    await writeFile(join(tempDir, "b.txt"), "b");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add b"], { cwd: tempDir }).exited;
    const hash2 = await getLatestHash(tempDir);

    await mkdir(join(tempDir, "packages/core"), { recursive: true });
    await writeFile(join(tempDir, "packages/core/index.ts"), "export {}");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add core"], { cwd: tempDir }).exited;
    const hash3 = await getLatestHash(tempDir);

    const result = await getChangedFilesForCommits(tempDir, [hash1, hash2, hash3]);
    expect(result.size).toBe(3);
    expect(result.get(hash1)).toContain("a.txt");
    expect(result.get(hash2)).toContain("b.txt");
    expect(result.get(hash3)).toContain("packages/core/index.ts");
  });

  it("returns same results as individual getChangedFiles calls", async () => {
    await writeFile(join(tempDir, "x.txt"), "x");
    await writeFile(join(tempDir, "y.txt"), "y");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add xy"], { cwd: tempDir }).exited;
    const hash1 = await getLatestHash(tempDir);

    await writeFile(join(tempDir, "z.txt"), "z");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: add z"], { cwd: tempDir }).exited;
    const hash2 = await getLatestHash(tempDir);

    const [individual1, individual2, batched] = await Promise.all([
      getChangedFiles(tempDir, hash1),
      getChangedFiles(tempDir, hash2),
      getChangedFilesForCommits(tempDir, [hash1, hash2]),
    ]);

    expect(batched.get(hash1)?.sort()).toEqual(individual1.sort());
    expect(batched.get(hash2)?.sort()).toEqual(individual2.sort());
  });

  it("handles commits with multiple changed files", async () => {
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/a.ts"), "a");
    await writeFile(join(tempDir, "src/b.ts"), "b");
    await writeFile(join(tempDir, "README.md"), "readme");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: multi-file commit"], { cwd: tempDir }).exited;
    const hash = await getLatestHash(tempDir);

    const result = await getChangedFilesForCommits(tempDir, [hash]);
    const files = result.get(hash) ?? [];
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
    expect(files).toContain("README.md");
  });
});
