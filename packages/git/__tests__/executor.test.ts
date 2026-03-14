import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "../src/executor";

describe("execGit", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-git-"));
    await Bun.spawn(["git", "init"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "config", "user.name", "Test"], { cwd: tempDir }).exited;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("executes a git command and returns stdout", async () => {
    const result = await execGit(["status"], tempDir);
    expect(result).toContain("On branch");
  });

  it("throws on non-zero exit code", async () => {
    expect(execGit(["log"], tempDir)).rejects.toThrow();
  });
});
