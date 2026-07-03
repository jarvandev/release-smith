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
  it("parses repo names containing dots", () => {
    expect(parseGitHubUrl("https://github.com/vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
    expect(parseGitHubUrl("https://github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
    expect(parseGitHubUrl("git@github.com:vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
    });
  });
  it("parses URL with trailing slash", () => {
    expect(parseGitHubUrl("https://github.com/user/repo/")).toEqual({
      owner: "user",
      repo: "repo",
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
    let callCount = 0;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const url = typeof input === "string" ? input : input.toString();
      // First call: GET to check existing release -> 404
      if (init?.method === "GET" && url.includes("/releases/tags/")) {
        return new Response("Not found", { status: 404 });
      }
      // Second call: POST to create release
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
      expect(callCount).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips when release already exists for tag", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      // GET to check existing release -> 200 (exists)
      if (init?.method === "GET" && url.includes("/releases/tags/")) {
        return new Response(
          JSON.stringify({ html_url: "https://github.com/u/r/releases/tag/v1.0.0" }),
          { status: 200 },
        );
      }
      throw new Error("Should not reach POST when release already exists");
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
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("already exists");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("url-encodes the tag in the existence check", async () => {
    const originalFetch = globalThis.fetch;
    let getUrl = "";
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "GET") {
        getUrl = url;
        return new Response("Not found", { status: 404 });
      }
      return new Response(JSON.stringify({ html_url: "https://github.com/u/r/releases/x" }), {
        status: 201,
      });
    };
    try {
      await createGitHubRelease({
        owner: "user",
        repo: "repo",
        tag: "@myapp/core@1.2.3",
        name: "@myapp/core@1.2.3",
        body: "changelog",
        token: "test-token",
      });
      expect(getUrl).toContain("/releases/tags/%40myapp%2Fcore%401.2.3");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("propagates non-404 errors from the existence check instead of creating", async () => {
    const originalFetch = globalThis.fetch;
    let postAttempted = false;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response("rate limited", { status: 403 });
      }
      postAttempted = true;
      return new Response("{}", { status: 201 });
    };
    try {
      await expect(
        createGitHubRelease({
          owner: "user",
          repo: "repo",
          tag: "v1.0.0",
          name: "v1.0.0",
          body: "changelog",
          token: "test-token",
        }),
      ).rejects.toThrow(/403/);
      expect(postAttempted).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
