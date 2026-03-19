import { describe, expect, it } from "bun:test";
import type { ResolvedPackage } from "@release-smith/config";
import type { ConventionalCommit, VersionBump } from "../src/types";
import {
  applyVersionGroups,
  bumpPrerelease,
  bumpVersion,
  detectCircularDeps,
  getHighestBump,
} from "../src/version-calculator";

function makeCommit(overrides: Partial<ConventionalCommit> = {}): ConventionalCommit {
  return {
    hash: "abc123",
    type: "fix",
    scope: null,
    description: "a fix",
    body: "",
    breaking: false,
    rawMessage: "fix: a fix",
    ...overrides,
  };
}

function makePackage(overrides: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return {
    name: "@myapp/core",
    path: "packages/core",
    publish: true,
    changelogPath: "/tmp/CHANGELOG.md",
    version: "1.0.0",
    isPrivate: false,
    workspaceDeps: [],
    ignoreFiles: [],
    ...overrides,
  };
}

function makeBump(overrides: Partial<VersionBump> = {}): VersionBump {
  return {
    packagePath: "packages/core",
    packageName: "@myapp/core",
    currentVersion: "1.0.0",
    newVersion: "1.0.1",
    level: "patch",
    commits: [],
    propagated: false,
    ...overrides,
  };
}

describe("bumpVersion", () => {
  it("bumps patch", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });
  it("bumps minor", () => {
    expect(bumpVersion("1.0.0", "minor")).toBe("1.1.0");
  });
  it("bumps major", () => {
    expect(bumpVersion("1.0.0", "major")).toBe("2.0.0");
  });
  it("resets lower on minor", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });
  it("resets lower on major", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
  it("handles 0.x with breaking", () => {
    expect(bumpVersion("0.2.1", "major")).toBe("1.0.0");
  });

  it("throws on invalid version string", () => {
    expect(() => bumpVersion("not-a-version", "patch")).toThrow("Failed to bump version");
  });

  it("bumps prerelease version to next stable", () => {
    // semver.inc("1.0.0-beta.0", "patch") -> "1.0.0"
    // semver treats 1.0.0-beta.0 as a prerelease OF 1.0.0, so patch just drops the prerelease
    expect(bumpVersion("1.0.0-beta.0", "patch")).toBe("1.0.0");
  });
});

describe("getHighestBump", () => {
  it("returns null for empty commits", () => {
    expect(getHighestBump([])).toBeNull();
  });

  it("returns null for chore-only commits", () => {
    expect(getHighestBump([makeCommit({ type: "chore" })])).toBeNull();
  });

  it("returns patch for fix", () => {
    expect(getHighestBump([makeCommit({ type: "fix" })])).toBe("patch");
  });

  it("returns minor for feat", () => {
    expect(getHighestBump([makeCommit({ type: "feat" })])).toBe("minor");
  });

  it("returns major for breaking change", () => {
    expect(getHighestBump([makeCommit({ type: "feat", breaking: true })])).toBe("major");
  });

  it("returns highest level among multiple commits", () => {
    expect(getHighestBump([makeCommit({ type: "fix" }), makeCommit({ type: "feat" })])).toBe(
      "minor",
    );
  });

  it("breaking wins over everything", () => {
    expect(
      getHighestBump([
        makeCommit({ type: "fix" }),
        makeCommit({ type: "feat" }),
        makeCommit({ type: "fix", breaking: true }),
      ]),
    ).toBe("major");
  });

  it("ignores non-bump types like docs, test, ci", () => {
    expect(
      getHighestBump([
        makeCommit({ type: "docs" }),
        makeCommit({ type: "test" }),
        makeCommit({ type: "ci" }),
      ]),
    ).toBeNull();
  });
});

describe("bumpPrerelease", () => {
  it("starts new prerelease from stable version", () => {
    expect(bumpPrerelease("1.0.0", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.0");
  });

  it("starts new prerelease for patch", () => {
    expect(bumpPrerelease("1.0.0", "1.0.0", "patch", "beta")).toBe("1.0.1-beta.0");
  });

  it("starts new prerelease for major", () => {
    expect(bumpPrerelease("1.0.0", "1.0.0", "major", "beta")).toBe("2.0.0-beta.0");
  });

  it("increments existing prerelease with same target", () => {
    expect(bumpPrerelease("1.1.0-beta.0", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.1");
  });

  it("increments higher prerelease number", () => {
    expect(bumpPrerelease("1.1.0-beta.5", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.6");
  });

  it("escalates to new major when level increases", () => {
    expect(bumpPrerelease("1.1.0-beta.3", "1.0.0", "major", "beta")).toBe("2.0.0-beta.0");
  });

  it("starts new sequence when preid changes", () => {
    expect(bumpPrerelease("1.1.0-alpha.5", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.0");
  });

  it("supports rc preid", () => {
    expect(bumpPrerelease("2.0.0-beta.3", "1.0.0", "major", "rc")).toBe("2.0.0-rc.0");
  });

  it("uses current version as stable base when no tag", () => {
    expect(bumpPrerelease("0.0.0", "0.0.0", "minor", "beta")).toBe("0.1.0-beta.0");
  });

  it("throws on invalid lastStableVersion", () => {
    expect(() => bumpPrerelease("1.0.0", "invalid", "patch", "beta")).toThrow(
      "Failed to bump version",
    );
  });

  it("starts new sequence when current is stable but higher than lastStable", () => {
    // current=2.0.0 (stable), lastStable=1.0.0, level=minor
    // targetStable = 1.1.0; current is stable, no prerelease -> new sequence
    expect(bumpPrerelease("2.0.0", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.0");
  });

  it("0.x breaking prerelease goes to 1.0.0-beta.0", () => {
    expect(bumpPrerelease("0.5.3", "0.5.3", "major", "beta")).toBe("1.0.0-beta.0");
  });

  it("0.x minor prerelease", () => {
    expect(bumpPrerelease("0.5.3", "0.5.3", "minor", "beta")).toBe("0.6.0-beta.0");
  });

  it("handles prerelease with different preid and same base", () => {
    // current=1.1.0-alpha.5 (preid=alpha), but requesting beta
    // targetStable = 1.1.0; current preid != requested preid -> new sequence
    expect(bumpPrerelease("1.1.0-alpha.5", "1.0.0", "minor", "beta")).toBe("1.1.0-beta.0");
  });
});

describe("applyVersionGroups", () => {
  describe("fixed groups", () => {
    it("aligns versions across fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      expect(result[0].newVersion).toBe("1.1.0");
      expect(result[1].newVersion).toBe("1.1.0");
    });

    it("adds missing packages in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
      ];
      // cli has no commits, but should be added due to fixed group
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      expect(result).toHaveLength(2);
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      expect(cli.newVersion).toBe("1.1.0");
    });

    it("does nothing when no bumps in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core" }),
        makePackage({ name: "@a/cli", path: "a/cli" }),
      ];
      const result = applyVersionGroups([], packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      expect(result).toHaveLength(0);
    });

    it("uses highest current version in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.2.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      // Should use 1.2.0 (highest current) + patch = 1.2.1
      const core = result.find((b) => b.packageName === "@a/core")!;
      expect(core.newVersion).toBe("1.2.1");
    });
  });

  describe("linked groups", () => {
    it("aligns versions across linked group", () => {
      const packages = [
        makePackage({ name: "@a/ui", path: "a/ui", version: "1.0.0" }),
        makePackage({ name: "@a/theme", path: "a/theme", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/ui",
          packageName: "@a/ui",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/theme",
          packageName: "@a/theme",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        linked: [["@a/ui", "@a/theme"]],
      });
      expect(result[0].newVersion).toBe("1.1.0");
      expect(result[1].newVersion).toBe("1.1.0");
    });

    it("does not add missing packages in linked group", () => {
      const packages = [
        makePackage({ name: "@a/ui", path: "a/ui", version: "1.0.0" }),
        makePackage({ name: "@a/theme", path: "a/theme", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/ui",
          packageName: "@a/ui",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        linked: [["@a/ui", "@a/theme"]],
      });
      // theme has no changes, should not be added
      expect(result).toHaveLength(1);
      expect(result[0].packageName).toBe("@a/ui");
    });

    it("does nothing for single bump in linked group", () => {
      const packages = [
        makePackage({ name: "@a/ui", path: "a/ui", version: "1.0.0" }),
        makePackage({ name: "@a/theme", path: "a/theme", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/ui",
          packageName: "@a/ui",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        linked: [["@a/ui", "@a/theme"]],
      });
      expect(result[0].newVersion).toBe("1.0.1");
    });
  });

  describe("with prerelease versions", () => {
    it("aligns prerelease versions in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const prereleaseOpts = {
        preid: "beta",
        lastStableVersions: new Map([
          ["a/core", "1.0.0"],
          ["a/cli", "1.0.0"],
        ]),
      };
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0-beta.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.0.1-beta.0",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(
        bumps,
        packages,
        { fixed: [["@a/core", "@a/cli"]] },
        prereleaseOpts,
      );
      // Both should have the same (highest) prerelease version
      expect(result[0].newVersion).toBe(result[1].newVersion);
      expect(result[0].newVersion).toBe("1.1.0-beta.0");
    });

    it("aligns prerelease versions in linked group", () => {
      const packages = [
        makePackage({ name: "@a/ui", path: "a/ui", version: "1.0.0" }),
        makePackage({ name: "@a/theme", path: "a/theme", version: "1.0.0" }),
      ];
      const prereleaseOpts = {
        preid: "beta",
        lastStableVersions: new Map([
          ["a/ui", "1.0.0"],
          ["a/theme", "1.0.0"],
        ]),
      };
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/ui",
          packageName: "@a/ui",
          currentVersion: "1.0.0",
          newVersion: "1.1.0-beta.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/theme",
          packageName: "@a/theme",
          currentVersion: "1.0.0",
          newVersion: "1.0.1-beta.0",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(
        bumps,
        packages,
        { linked: [["@a/ui", "@a/theme"]] },
        prereleaseOpts,
      );
      expect(result[0].newVersion).toBe("1.1.0-beta.0");
      expect(result[1].newVersion).toBe("1.1.0-beta.0");
    });

    it("fixed group adds non-bumped package with prerelease version (not stable)", () => {
      // BUG-3 regression: non-bumped packages in fixed group must use prerelease version
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const prereleaseOpts = {
        preid: "beta",
        lastStableVersions: new Map([
          ["a/core", "1.0.0"],
          ["a/cli", "1.0.0"],
        ]),
      };
      // Only core has commits
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0-beta.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(
        bumps,
        packages,
        { fixed: [["@a/core", "@a/cli"]] },
        prereleaseOpts,
      );
      // cli has no commits but should be added with prerelease version
      expect(result).toHaveLength(2);
      const core = result.find((b) => b.packageName === "@a/core")!;
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      expect(core.newVersion).toBe("1.1.0-beta.0");
      expect(cli.newVersion).toBe("1.1.0-beta.0");
      // Must NOT be a stable version like "1.1.0"
      expect(cli.newVersion).toContain("-beta.");
    });

    it("fixed group with higher-version non-bumped package in prerelease mode", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.2.0" }),
      ];
      const prereleaseOpts = {
        preid: "beta",
        lastStableVersions: new Map([
          ["a/core", "1.0.0"],
          ["a/cli", "1.2.0"],
        ]),
      };
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.0.1-beta.0",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(
        bumps,
        packages,
        { fixed: [["@a/core", "@a/cli"]] },
        prereleaseOpts,
      );
      // cli has higher base (1.2.0), so patch from 1.2.0 -> 1.2.1-beta.0
      // which is higher than core's 1.0.1-beta.0
      const core = result.find((b) => b.packageName === "@a/core")!;
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      expect(core.newVersion).toBe(cli.newVersion);
      expect(cli.newVersion).toContain("-beta.");
    });

    it("fixed group prerelease does not produce stable version", () => {
      // Edge case: all bumps are prerelease, non-bumped pkg wouldBe must also be prerelease
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "2.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const prereleaseOpts = {
        preid: "rc",
        lastStableVersions: new Map([
          ["a/core", "2.0.0"],
          ["a/cli", "1.0.0"],
        ]),
      };
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.1.0-rc.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(
        bumps,
        packages,
        { fixed: [["@a/core", "@a/cli"]] },
        prereleaseOpts,
      );
      // core has no commits but higher base version (2.0.0)
      // wouldBe prerelease: bumpPrerelease("2.0.0", "2.0.0", "minor", "rc") = "2.1.0-rc.0"
      // cli: 1.1.0-rc.0
      // finalVersion = max(1.1.0-rc.0, 2.1.0-rc.0) = 2.1.0-rc.0
      for (const b of result) {
        expect(b.newVersion).toContain("-rc.");
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty groups object", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core" })];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {});
      expect(result).toHaveLength(1);
      expect(result[0].newVersion).toBe("1.0.1");
    });

    it("handles empty fixed and linked arrays", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core" })];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, { fixed: [], linked: [] });
      expect(result).toHaveLength(1);
      expect(result[0].newVersion).toBe("1.0.1");
    });

    it("skips non-publish packages when adding missing in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/internal", path: "a/internal", version: "1.0.0", publish: false }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/internal"]],
      });
      // @a/internal should NOT be added because publish=false
      expect(result).toHaveLength(1);
      expect(result[0].packageName).toBe("@a/core");
    });

    it("skips fixed group member that already has the target version", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.1.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      // cli is not bumped. Its "wouldBe" = bumpVersion("1.1.0", "minor") = 1.2.0.
      // finalVersion = max(1.1.0, 1.2.0) = 1.2.0.
      // cli gets added with 1.2.0.
      const core = result.find((b) => b.packageName === "@a/core")!;
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      expect(core.newVersion).toBe(cli.newVersion);
    });

    it("fixed group with non-existent package name is ignored", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" })];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      // "nonexistent" is not in packages
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "nonexistent"]],
      });
      expect(result).toHaveLength(1);
      expect(result[0].newVersion).toBe("1.0.1");
    });

    it("fixed group with propagated package aligns version", () => {
      // core(pub, feat) -> cli(pub, propagated). Both in fixed group.
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({
          name: "@a/cli",
          path: "a/cli",
          version: "1.0.0",
          workspaceDeps: ["@a/core"],
        }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
          propagated: true,
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      const core = result.find((b) => b.packageName === "@a/core")!;
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      // Fixed group: both should get the same version (core's 1.1.0 wins over cli's 1.0.1)
      expect(core.newVersion).toBe("1.1.0");
      expect(cli.newVersion).toBe("1.1.0");
    });

    it("fixed group with rollup package aligns version", () => {
      // lib(unpub, feat) -> cli(pub, rollup minor). cli in fixed group with app(pub, no changes).
      const packages = [
        makePackage({ name: "@a/lib", path: "a/lib", publish: false }),
        makePackage({
          name: "@a/cli",
          path: "a/cli",
          version: "1.0.0",
          workspaceDeps: ["@a/lib"],
        }),
        makePackage({ name: "@a/app", path: "a/app", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
          commits: [makeCommit({ type: "feat" })],
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/cli", "@a/app"]],
      });
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      const app = result.find((b) => b.packageName === "@a/app")!;
      // cli gets minor from rollup (1.1.0). app should be added to match.
      expect(cli.newVersion).toBe("1.1.0");
      expect(app.newVersion).toBe("1.1.0");
    });

    it("linked group with propagated packages aligns to highest", () => {
      const packages = [
        makePackage({ name: "hub", path: "hub", publish: true }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["hub"] }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "hub",
          packageName: "hub",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a",
          packageName: "a",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
          propagated: true,
        }),
        makeBump({
          packagePath: "b",
          packageName: "b",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
      ];
      const result = applyVersionGroups(bumps, packages, {
        linked: [["a", "b"]],
      });
      const a = result.find((b) => b.packageName === "a")!;
      const b = result.find((b) => b.packageName === "b")!;
      // b has direct feat (1.1.0), a is propagated (1.0.1). Linked aligns to highest.
      expect(a.newVersion).toBe(b.newVersion);
      expect(b.newVersion).toBe("1.1.0");
    });
  });

  describe("does not mutate input", () => {
    it("preserves original bumps", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const bumps: VersionBump[] = [
        makeBump({
          packagePath: "a/core",
          packageName: "@a/core",
          currentVersion: "1.0.0",
          newVersion: "1.1.0",
          level: "minor",
        }),
        makeBump({
          packagePath: "a/cli",
          packageName: "@a/cli",
          currentVersion: "1.0.0",
          newVersion: "1.0.1",
          level: "patch",
        }),
      ];
      const originalVersions = bumps.map((b) => b.newVersion);
      applyVersionGroups(bumps, packages, { fixed: [["@a/core", "@a/cli"]] });
      // Original bumps should not be mutated
      expect(bumps.map((b) => b.newVersion)).toEqual(originalVersions);
    });
  });
});

describe("detectCircularDeps", () => {
  it("null when no cycles", () => {
    expect(
      detectCircularDeps([
        makePackage({ name: "a", path: "a", workspaceDeps: [] }),
        makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
      ]),
    ).toBeNull();
  });

  it("returns cycle when circular (2-node)", () => {
    const cycle = detectCircularDeps([
      makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it("detects 3-node cycle", () => {
    const cycle = detectCircularDeps([
      makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["c"] }),
      makePackage({ name: "c", path: "c", workspaceDeps: ["a"] }),
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });

  it("handles self-loop", () => {
    const cycle = detectCircularDeps([makePackage({ name: "a", path: "a", workspaceDeps: ["a"] })]);
    expect(cycle).not.toBeNull();
  });

  it("handles missing dep reference gracefully", () => {
    // "nonexistent" is not in the packages list
    const result = detectCircularDeps([
      makePackage({ name: "a", path: "a", workspaceDeps: ["nonexistent"] }),
    ]);
    // Should not crash, no cycle found
    expect(result).toBeNull();
  });

  it("null for deep linear chain", () => {
    expect(
      detectCircularDeps([
        makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
        makePackage({ name: "b", path: "b", workspaceDeps: ["c"] }),
        makePackage({ name: "c", path: "c", workspaceDeps: [] }),
      ]),
    ).toBeNull();
  });
});
