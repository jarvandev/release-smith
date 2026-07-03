import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@release-smith/git";
import releaseTags from "../src/commands/release-tags";

async function initRepoWithRemote(dir: string): Promise<string> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "my-pkg", version: "1.0.0" }));
  await execGit(["init"], dir);
  await execGit(["config", "user.email", "test@test.com"], dir);
  await execGit(["config", "user.name", "Test"], dir);
  await execGit(["add", "."], dir);
  await execGit(["commit", "-m", "chore: init"], dir);
  await execGit(["remote", "add", "origin", "https://github.com/user/repo.git"], dir);
  return (await execGit(["rev-parse", "HEAD"], dir)).trim();
}

function prResponse(body: string, mergeCommitSha: string) {
  return {
    number: 42,
    title: "chore(release): my-pkg@1.1.0",
    body,
    html_url: "https://github.com/user/repo/pull/42",
    head: { ref: "release/next" },
    base: { ref: "main" },
    state: "closed",
    merged: true,
    merge_commit_sha: mergeCommitSha,
  };
}

const METADATA_BODY = [
  "## Release Summary",
  "<!-- release-smith:metadata",
  JSON.stringify([
    {
      packageName: "my-pkg",
      packagePath: ".",
      version: "1.1.0",
      tagName: "v1.1.0",
      changelog: "## 1.1.0",
    },
  ]),
  "-->",
].join("\n");

describe("release-tags merge commit verification", () => {
  let tempDir: string;
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-release-tags-"));
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it("fails when HEAD does not match the PR merge commit", async () => {
    await initRepoWithRemote(tempDir);
    const staleSha = "0000000000000000000000000000000000000000";
    globalThis.fetch = async () =>
      new Response(JSON.stringify(prResponse(METADATA_BODY, staleSha)), { status: 200 });

    await expect(
      // @ts-expect-error citty run context is larger than what the command uses
      releaseTags.run({
        args: { "pr-number": "42", "github-release": false, cwd: tempDir, _: [] },
      }),
    ).rejects.toThrow(/merge commit/);

    const tags = await execGit(["tag", "--list"], tempDir);
    expect(tags.trim()).toBe("");
  });
});
