import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTag,
  findLatestVersionTag,
  getLatestVersionTag,
  getTagCommit,
  getTags,
  tagExists,
} from "../src/tag";

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
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

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
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns null when no version tags", async () => {
    const tag = await getLatestVersionTag(tempDir, "v");
    expect(tag).toBeNull();
  });

  it("finds latest v-prefixed tag for single-package", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.1.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "v");
    expect(tag).toBe("v1.1.0");
  });

  it("finds latest package-scoped tag for monorepo", async () => {
    await Bun.spawn(["git", "tag", "@myapp/cli@1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/cli@1.2.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/core@2.0.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "@myapp/cli@");
    expect(tag).toBe("@myapp/cli@1.2.0");
  });

  it("finds tags with custom prefix", async () => {
    await Bun.spawn(["git", "tag", "release-1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "release-2.0.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "release-");
    expect(tag).toBe("release-2.0.0");
  });

  it("excludes pre-release tags", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v2.0.0-beta.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v2.0.0-rc.1"], { cwd: tempDir }).exited;
    // Should return v1.0.0 (the latest stable), not v2.0.0-beta.0 or v2.0.0-rc.1
    const tag = await getLatestVersionTag(tempDir, "v");
    expect(tag).toBe("v1.0.0");
  });

  it("ignores tags with invalid semver suffix", async () => {
    await Bun.spawn(["git", "tag", "v1.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "vabc"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "v");
    expect(tag).toBe("v1.0.0");
  });

  it("returns higher version regardless of creation order", async () => {
    // Create v2.0.0 first, then v1.0.0 (reverse order)
    await Bun.spawn(["git", "tag", "v2.0.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    const tag = await getLatestVersionTag(tempDir, "v");
    expect(tag).toBe("v2.0.0");
  });
});

describe("findLatestVersionTag", () => {
  it("returns null for empty tag list", () => {
    expect(findLatestVersionTag([], "v")).toBeNull();
  });

  it("returns null when no tags match prefix", () => {
    const tags = ["release-1.0.0", "release-2.0.0"];
    expect(findLatestVersionTag(tags, "v")).toBeNull();
  });

  it("finds latest v-prefixed tag", () => {
    const tags = ["v1.0.0", "v1.1.0", "v0.9.0"];
    expect(findLatestVersionTag(tags, "v")).toBe("v1.1.0");
  });

  it("finds latest package-scoped tag", () => {
    const tags = ["@myapp/cli@1.0.0", "@myapp/cli@1.2.0", "@myapp/core@2.0.0"];
    expect(findLatestVersionTag(tags, "@myapp/cli@")).toBe("@myapp/cli@1.2.0");
  });

  it("excludes pre-release tags", () => {
    const tags = ["v1.0.0", "v2.0.0-beta.0", "v2.0.0-rc.1"];
    expect(findLatestVersionTag(tags, "v")).toBe("v1.0.0");
  });

  it("ignores tags with invalid semver suffix", () => {
    const tags = ["v1.0", "vabc", "v1.0.0"];
    expect(findLatestVersionTag(tags, "v")).toBe("v1.0.0");
  });

  it("returns higher version regardless of array order", () => {
    const tags = ["v2.0.0", "v1.0.0", "v3.0.0", "v1.5.0"];
    expect(findLatestVersionTag(tags, "v")).toBe("v3.0.0");
  });

  it("compares patch versions correctly", () => {
    const tags = ["v1.0.0", "v1.0.1", "v1.0.2", "v1.0.10"];
    expect(findLatestVersionTag(tags, "v")).toBe("v1.0.10");
  });

  it("handles custom prefix", () => {
    const tags = ["release-1.0.0", "release-2.0.0", "v1.0.0"];
    expect(findLatestVersionTag(tags, "release-")).toBe("release-2.0.0");
  });

  it("produces same result as getLatestVersionTag", async () => {
    const tags = ["v1.0.0", "v2.0.0", "v1.5.0", "other-tag", "v3.0.0-beta.0"];
    expect(findLatestVersionTag(tags, "v")).toBe("v2.0.0");
  });
});

describe("tagExists", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns false when tag does not exist", async () => {
    expect(await tagExists(tempDir, "v1.0.0")).toBe(false);
  });

  it("returns true when tag exists", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    expect(await tagExists(tempDir, "v1.0.0")).toBe(true);
  });
});

describe("getTagCommit", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns null for non-existent tag", async () => {
    expect(await getTagCommit(tempDir, "v999.0.0")).toBeNull();
  });

  it("returns the commit hash for an existing tag", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    const commit = await getTagCommit(tempDir, "v1.0.0");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("createTag", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates a tag at HEAD", async () => {
    await createTag(tempDir, "v1.0.0");
    const tags = await getTags(tempDir);
    expect(tags).toContain("v1.0.0");
  });
});
