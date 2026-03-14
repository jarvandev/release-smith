import { describe, expect, it } from "bun:test";
import { createGitHubRelease, parseGitHubUrl } from "../src/release";

describe("parseGitHubUrl", () => {
  it("parses HTTPS URL", () => {
    expect(parseGitHubUrl("https://github.com/user/repo.git")).toEqual({
      owner: "user",
      repo: "repo",
    });
  });
  it("parses HTTPS URL without .git", () => {
    expect(parseGitHubUrl("https://github.com/user/repo")).toEqual({ owner: "user", repo: "repo" });
  });
  it("parses SSH URL", () => {
    expect(parseGitHubUrl("git@github.com:user/repo.git")).toEqual({ owner: "user", repo: "repo" });
  });
  it("parses SSH URL without .git", () => {
    expect(parseGitHubUrl("git@github.com:user/repo")).toEqual({ owner: "user", repo: "repo" });
  });
  it("returns null for non-GitHub URL", () => {
    expect(parseGitHubUrl("https://gitlab.com/user/repo")).toBeNull();
  });
  it("returns null for empty string", () => {
    expect(parseGitHubUrl("")).toBeNull();
  });
  it("parses URL with org containing hyphens", () => {
    expect(parseGitHubUrl("https://github.com/my-org/my-repo.git")).toEqual({
      owner: "my-org",
      repo: "my-repo",
    });
  });
});

describe("createGitHubRelease", () => {
  it("skips when no token", async () => {
    const result = await createGitHubRelease({
      owner: "user",
      repo: "repo",
      tag: "v1.0.0",
      name: "v1.0.0",
      body: "changelog",
      token: null,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("GITHUB_TOKEN");
  });

  it("creates release and returns URL on success", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ html_url: "https://github.com/u/r/releases/v1.0.0" }), {
        status: 201,
      });
    };
    try {
      const result = await createGitHubRelease({
        owner: "user",
        repo: "repo",
        tag: "v1.0.0",
        name: "v1.0.0",
        body: "## Changes\n\n- feature",
        token: "test-token",
      });
      expect(result.skipped).toBe(false);
      expect(result.url).toBe("https://github.com/u/r/releases/v1.0.0");
      expect(capturedBody.tag_name).toBe("v1.0.0");
      expect(capturedBody.name).toBe("v1.0.0");
      expect(capturedBody.body).toContain("## Changes");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
