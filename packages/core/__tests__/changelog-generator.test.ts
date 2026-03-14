import { describe, it, expect } from "bun:test";
import { generateChangelog, insertChangelog } from "../src/changelog-generator";
import type { VersionBump, ConventionalCommit } from "../src/types";

function makeCommit(overrides: Partial<ConventionalCommit> = {}): ConventionalCommit {
  return { hash: "abcdef1234567890abcdef1234567890abcdef12", type: "fix", scope: null, description: "a fix", body: "", breaking: false, rawMessage: "fix: a fix", ...overrides };
}

describe("generateChangelog", () => {
  it("generates changelog with features and fixes", () => {
    const bump: VersionBump = {
      packagePath: "packages/core", packageName: "@myapp/core", currentVersion: "1.0.0", newVersion: "1.1.0", level: "minor",
      commits: [
        makeCommit({ type: "feat", description: "add login", hash: "aaa111aaa111aaa111aaa111aaa111aaa111aaa1" }),
        makeCommit({ type: "fix", description: "fix crash", hash: "bbb222bbb222bbb222bbb222bbb222bbb222bbb2" }),
      ],
      propagated: false,
    };
    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("## [1.1.0]");
    expect(result).toContain("2026-03-14");
    expect(result).toContain("### Features");
    expect(result).toContain("add login");
    expect(result).toContain("### Bug Fixes");
    expect(result).toContain("fix crash");
  });

  it("includes breaking changes section", () => {
    const bump: VersionBump = {
      packagePath: ".", packageName: "my-tool", currentVersion: "1.0.0", newVersion: "2.0.0", level: "major",
      commits: [makeCommit({ type: "feat", description: "new API", breaking: true, hash: "ccc333ccc333ccc333ccc333ccc333ccc333ccc3" })],
      propagated: false,
    };
    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("### Breaking Changes");
  });

  it("includes short commit hash with link when repoUrl provided", () => {
    const bump: VersionBump = {
      packagePath: ".", packageName: "my-tool", currentVersion: "1.0.0", newVersion: "1.0.1", level: "patch",
      commits: [makeCommit({ hash: "abcdef1234567890abcdef1234567890abcdef12" })],
      propagated: false,
    };
    const result = generateChangelog(bump, "2026-03-14", "https://github.com/user/repo");
    expect(result).toContain("[abcdef1](https://github.com/user/repo/commit/abcdef1234567890abcdef1234567890abcdef12)");
  });

  it("includes short hash without link when no repoUrl", () => {
    const bump: VersionBump = {
      packagePath: ".", packageName: "my-tool", currentVersion: "1.0.0", newVersion: "1.0.1", level: "patch",
      commits: [makeCommit({ hash: "abcdef1234567890abcdef1234567890abcdef12" })],
      propagated: false,
    };
    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("abcdef1");
    expect(result).not.toContain("https://");
  });

  it("includes scope in entry when present", () => {
    const bump: VersionBump = {
      packagePath: ".", packageName: "my-tool", currentVersion: "1.0.0", newVersion: "1.0.1", level: "patch",
      commits: [makeCommit({ scope: "auth", description: "fix token" })],
      propagated: false,
    };
    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("**auth:**");
  });

  it("generates note for propagated bump with no direct commits", () => {
    const bump: VersionBump = {
      packagePath: "packages/cli", packageName: "@myapp/cli", currentVersion: "1.0.0", newVersion: "1.0.1", level: "patch",
      commits: [], propagated: true,
    };
    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("1.0.1");
    expect(result).toContain("dependency update");
  });
});

describe("insertChangelog", () => {
  it("prepends to empty changelog", () => {
    const result = insertChangelog("", "## [1.0.0] - 2026-03-14\n\n### Features\n\n- add login");
    expect(result).toContain("# Changelog");
    expect(result).toContain("## [1.0.0]");
  });

  it("inserts after header in existing changelog", () => {
    const existing = "# Changelog\n\n## [0.1.0] - 2026-03-01\n\n### Features\n\n- initial release\n";
    const newEntry = "## [0.2.0] - 2026-03-14\n\n### Bug Fixes\n\n- fix bug";
    const result = insertChangelog(existing, newEntry);
    const idx1 = result.indexOf("## [0.2.0]");
    const idx2 = result.indexOf("## [0.1.0]");
    expect(idx1).toBeLessThan(idx2);
  });
});
