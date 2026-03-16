import { describe, expect, it } from "bun:test";
import { assignCommitsToPackages, parseConventionalCommit } from "../src/commit-parser";

describe("parseConventionalCommit", () => {
  it("parses simple commit", () => {
    const result = parseConventionalCommit("abc123", "feat: add login", "");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("feat");
    expect(result!.scope).toBeNull();
    expect(result!.description).toBe("add login");
    expect(result!.breaking).toBe(false);
  });

  it("parses commit with scope", () => {
    const result = parseConventionalCommit("abc123", "fix(auth): token refresh", "");
    expect(result!.type).toBe("fix");
    expect(result!.scope).toBe("auth");
    expect(result!.description).toBe("token refresh");
  });

  it("detects breaking change via !", () => {
    const result = parseConventionalCommit("abc123", "feat!: remove old API", "");
    expect(result!.breaking).toBe(true);
    expect(result!.type).toBe("feat");
  });

  it("detects breaking change via scope and !", () => {
    const result = parseConventionalCommit("abc123", "refactor(core)!: rewrite engine", "");
    expect(result!.breaking).toBe(true);
    expect(result!.scope).toBe("core");
  });

  it("detects BREAKING CHANGE in footer", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: new API",
      "Some details\n\nBREAKING CHANGE: old API removed",
    );
    expect(result!.breaking).toBe(true);
  });

  it("detects BREAKING-CHANGE (hyphen) in footer", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: new API",
      "BREAKING-CHANGE: old API removed",
    );
    expect(result!.breaking).toBe(true);
  });

  it("returns null for non-conventional commit", () => {
    expect(parseConventionalCommit("abc123", "just a random commit", "")).toBeNull();
  });

  it("returns null for merge commits", () => {
    expect(parseConventionalCommit("abc123", "Merge branch 'main'", "")).toBeNull();
  });

  it("handles colon in description", () => {
    const result = parseConventionalCommit("abc123", "fix: handle edge case: empty input", "");
    expect(result!.description).toBe("handle edge case: empty input");
  });

  it("detects BREAKING CHANGE in body after other text", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: new API",
      "Some context here.\n\nBREAKING CHANGE: old API removed",
    );
    expect(result!.breaking).toBe(true);
  });

  it("does not detect breaking change without colon", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: change behavior",
      "BREAKING CHANGE without colon",
    );
    // The regex requires BREAKING CHANGE: (with colon)
    expect(result!.breaking).toBe(false);
  });

  it("parses commit with special characters in scope", () => {
    const result = parseConventionalCommit("abc123", "fix(api/v2): handle error", "");
    expect(result!.scope).toBe("api/v2");
    expect(result!.description).toBe("handle error");
  });

  it("parses chore and docs types", () => {
    const chore = parseConventionalCommit("abc123", "chore: update deps", "");
    expect(chore!.type).toBe("chore");
    const docs = parseConventionalCommit("abc123", "docs: update readme", "");
    expect(docs!.type).toBe("docs");
  });

  it("trims leading/trailing whitespace in description", () => {
    const result = parseConventionalCommit("abc123", "feat:   add feature  ", "");
    expect(result!.description).toBe("add feature");
  });

  it("returns null for empty string message", () => {
    expect(parseConventionalCommit("abc123", "", "")).toBeNull();
  });
});

describe("assignCommitsToPackages", () => {
  it("assigns commit to package by file path", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "add feature",
      body: "",
      breaking: false,
      rawMessage: "feat: add feature",
    };
    const filesMap = new Map([["abc123", ["packages/core/src/index.ts"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core", "packages/cli"]);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe("packages/core");
  });

  it("assigns commit to multiple packages", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "shared fix",
      body: "",
      breaking: false,
      rawMessage: "fix: shared fix",
    };
    const filesMap = new Map([["abc123", ["packages/core/src/a.ts", "packages/cli/src/b.ts"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core", "packages/cli"]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.packagePath).sort()).toEqual(["packages/cli", "packages/core"]);
  });

  it("assigns root-level changes to single-package '.' path", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "root change",
      body: "",
      breaking: false,
      rawMessage: "feat: root change",
    };
    const filesMap = new Map([["abc123", ["src/index.ts"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["."]);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe(".");
  });

  it("ignores files not matching any package", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "root fix",
      body: "",
      breaking: false,
      rawMessage: "fix: root fix",
    };
    const filesMap = new Map([["abc123", ["README.md"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"]);
    expect(result).toHaveLength(0);
  });

  it("deduplicates when multiple files hit the same package", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "multi file change",
      body: "",
      breaking: false,
      rawMessage: "feat: multi file change",
    };
    const filesMap = new Map([
      ["abc123", ["packages/core/src/a.ts", "packages/core/src/b.ts", "packages/core/src/c.ts"]],
    ]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"]);
    // Same commit, same package -> should appear only once
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe("packages/core");
  });

  it("handles commit with no files in filesMap", () => {
    const commit = {
      hash: "missing",
      type: "fix",
      scope: null,
      description: "ghost commit",
      body: "",
      breaking: false,
      rawMessage: "fix: ghost commit",
    };
    const filesMap = new Map<string, string[]>();
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"]);
    expect(result).toHaveLength(0);
  });

  it("does not match package path without trailing slash", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "change",
      body: "",
      breaking: false,
      rawMessage: "feat: change",
    };
    // "packages/core-extra/..." should NOT match "packages/core"
    const filesMap = new Map([["abc123", ["packages/core-extra/src/index.ts"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"]);
    expect(result).toHaveLength(0);
  });

  it("skips package when all changed files match ignoreFiles", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "correct assertion",
      body: "",
      breaking: false,
      rawMessage: "fix: correct assertion",
    };
    const filesMap = new Map([["abc123", ["packages/core/__tests__/foo.test.ts"]]]);
    const ignoreFilesMap = new Map([["packages/core", ["**/__tests__/**", "**/*.test.*"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"], ignoreFilesMap);
    expect(result).toHaveLength(0);
  });

  it("assigns package when some files are not ignored", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "add feature with tests",
      body: "",
      breaking: false,
      rawMessage: "feat: add feature with tests",
    };
    const filesMap = new Map([
      ["abc123", ["packages/core/src/index.ts", "packages/core/__tests__/index.test.ts"]],
    ]);
    const ignoreFilesMap = new Map([["packages/core", ["**/__tests__/**"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"], ignoreFilesMap);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe("packages/core");
  });

  it("behaves normally when no ignoreFilesMap is provided", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "fix test",
      body: "",
      breaking: false,
      rawMessage: "fix: fix test",
    };
    const filesMap = new Map([["abc123", ["packages/core/__tests__/foo.test.ts"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"]);
    expect(result).toHaveLength(1);
  });

  it("ignores files matching nested test directories", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "nested test",
      body: "",
      breaking: false,
      rawMessage: "feat: nested test",
    };
    const filesMap = new Map([["abc123", ["packages/core/src/__tests__/nested/deep.test.ts"]]]);
    const ignoreFilesMap = new Map([["packages/core", ["**/__tests__/**"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/core"], ignoreFilesMap);
    expect(result).toHaveLength(0);
  });

  it("handles ignoreFiles for root package (path='.')", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "update docs",
      body: "",
      breaking: false,
      rawMessage: "feat: update docs",
    };
    const filesMap = new Map([["abc123", ["README.md"]]]);
    const ignoreFilesMap = new Map([[".", ["**/*.md"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["."], ignoreFilesMap);
    expect(result).toHaveLength(0);
  });

  it("ignores files matching *.spec.* pattern", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "fix spec",
      body: "",
      breaking: false,
      rawMessage: "fix: fix spec",
    };
    const filesMap = new Map([["abc123", ["packages/cli/src/app.spec.ts"]]]);
    const ignoreFilesMap = new Map([["packages/cli", ["**/*.spec.*"]]]);
    const result = assignCommitsToPackages([commit], filesMap, ["packages/cli"], ignoreFilesMap);
    expect(result).toHaveLength(0);
  });
});
