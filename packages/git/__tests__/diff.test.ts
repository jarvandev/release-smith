import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getChangedFiles } from "../src/diff";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function initRepo(dir: string) {
  const run = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

describe("getChangedFiles", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "rs-diff-")); await initRepo(tempDir); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

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
