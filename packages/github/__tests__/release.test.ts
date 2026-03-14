import { describe, it, expect } from "bun:test";
import { parseGitHubUrl, createGitHubRelease } from "../src/release";

describe("parseGitHubUrl", () => {
  it("parses HTTPS URL", () => {
    expect(parseGitHubUrl("https://github.com/user/repo.git")).toEqual({ owner: "user", repo: "repo" });
  });
  it("parses HTTPS URL without .git", () => {
    expect(parseGitHubUrl("https://github.com/user/repo")).toEqual({ owner: "user", repo: "repo" });
  });
  it("parses SSH URL", () => {
    expect(parseGitHubUrl("git@github.com:user/repo.git")).toEqual({ owner: "user", repo: "repo" });
  });
  it("returns null for non-GitHub URL", () => {
    expect(parseGitHubUrl("https://gitlab.com/user/repo")).toBeNull();
  });
});

describe("createGitHubRelease", () => {
  it("skips when no token", async () => {
    const result = await createGitHubRelease({ owner: "user", repo: "repo", tag: "v1.0.0", name: "v1.0.0", body: "changelog", token: null });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("GITHUB_TOKEN");
  });
});
