import { describe, expect, it } from "bun:test";
import {
  createPullRequest,
  findOpenPullRequest,
  getPullRequest,
  updatePullRequest,
} from "../src/pull-request";

describe("findOpenPullRequest", () => {
  it("constructs correct query parameters", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      await findOpenPullRequest("owner", "repo", "release/next", "main", "test-token");
      expect(capturedUrl).toContain("/repos/owner/repo/pulls?");
      expect(capturedUrl).toContain("state=open");
      expect(capturedUrl).toContain(`head=${encodeURIComponent("owner:release/next")}`);
      expect(capturedUrl).toContain("base=main");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns null when no PRs found", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200 });
    try {
      const result = await findOpenPullRequest("o", "r", "head", "base", "token");
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns first PR when found", async () => {
    const pr = {
      number: 42,
      title: "Release",
      body: "",
      html_url: "url",
      head: { ref: "h" },
      base: { ref: "b" },
      state: "open",
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([pr]), { status: 200 });
    try {
      const result = await findOpenPullRequest("o", "r", "head", "base", "token");
      expect(result?.number).toBe(42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves colon in head if already qualified", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      await findOpenPullRequest("owner", "repo", "other:branch", "main", "token");
      expect(capturedUrl).toContain(`head=${encodeURIComponent("other:branch")}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createPullRequest", () => {
  it("sends correct request body", async () => {
    let capturedBody: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ number: 1, html_url: "url" }), { status: 201 });
    };
    try {
      await createPullRequest("o", "r", "release/next", "main", "Title", "Body", "token");
      expect(capturedBody.head).toBe("release/next");
      expect(capturedBody.base).toBe("main");
      expect(capturedBody.title).toBe("Title");
      expect(capturedBody.body).toBe("Body");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("updatePullRequest", () => {
  it("sends PATCH with title and body", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
      capturedMethod = init?.method ?? "";
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ number: 5 }), { status: 200 });
    };
    try {
      await updatePullRequest("o", "r", 5, "New Title", "New Body", "token");
      expect(capturedMethod).toBe("PATCH");
      expect(capturedBody.title).toBe("New Title");
      expect(capturedBody.body).toBe("New Body");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getPullRequest", () => {
  it("fetches correct PR URL", async () => {
    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ number: 10 }), { status: 200 });
    };
    try {
      await getPullRequest("owner", "repo", 10, "token");
      expect(capturedUrl).toContain("/repos/owner/repo/pulls/10");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
