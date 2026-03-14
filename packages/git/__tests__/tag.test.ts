import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTags, getLatestVersionTag, createTag } from "../src/tag";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function initRepoWithCommit(dir: string) {
  const run = (args: string[]) => Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
  await writeFile(join(dir, "file.txt"), "init");
  await run(["add", "."]);
  await run(["commit", "-m", "init"]);
}

describe("getTags", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "rs-tag-")); await initRepoWithCommit(tempDir); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  it("returns empty array when no tags", async () => {
    const tags = await getTags(tempDir);
    expect(tags).toEqual([]);
  });

  it("returns all tags", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v2.0.0"], { cwd: tempDir }).exited;
    const tags = await getTags(tempDir);
    expect(tags).toContain("v1.0.0");
    expect(tags).toContain("v2.0.0");
  });
});

describe("getLatestVersionTag", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "rs-tag-")); await initRepoWithCommit(tempDir); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  it("returns null when no version tags", async () => {
    const tag = await getLatestVersionTag(tempDir, null);
    expect(tag).toBeNull();
  });

  it("finds latest v-prefixed tag for single-package", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.1.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, null);
    expect(tag).toBe("v1.1.0");
  });

  it("finds latest package-scoped tag for monorepo", async () => {
    await Bun.spawn(["git", "tag", "@myapp/cli@1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/cli@1.2.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/core@2.0.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "@myapp/cli");
    expect(tag).toBe("@myapp/cli@1.2.0");
  });
});

describe("createTag", () => {
  let tempDir: string;
  beforeEach(async () => { tempDir = await mkdtemp(join(tmpdir(), "rs-tag-")); await initRepoWithCommit(tempDir); });
  afterEach(async () => { await rm(tempDir, { recursive: true }); });

  it("creates a tag at HEAD", async () => {
    await createTag(tempDir, "v1.0.0");
    const tags = await getTags(tempDir);
    expect(tags).toContain("v1.0.0");
  });
});
