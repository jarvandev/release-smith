import { describe, expect, it } from "bun:test";
import type { ResolvedPackage } from "@release-smith/config";
import type { ConventionalCommit } from "../src/types";
import {
  applyVersionGroups,
  bumpPrerelease,
  bumpVersion,
  calculateVersionBumps,
  detectCircularDeps,
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
});

describe("calculateVersionBumps", () => {
  it("patch for fix", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "fix" }) }],
    );
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("1.0.1");
    expect(bumps[0].level).toBe("patch");
  });

  it("minor for feat", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
    );
    expect(bumps[0].newVersion).toBe("1.1.0");
  });

  it("major for breaking", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat", breaking: true }) }],
    );
    expect(bumps[0].newVersion).toBe("2.0.0");
  });

  it("highest bump wins", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [
        { packagePath: "packages/core", commit: makeCommit({ type: "fix" }) },
        { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
      ],
    );
    expect(bumps[0].newVersion).toBe("1.1.0");
  });

  it("skips packages with no commits", () => {
    const bumps = calculateVersionBumps(
      [makePackage(), makePackage({ name: "@myapp/cli", path: "packages/cli" })],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "fix" }) }],
    );
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/core");
  });

  it("only publish:true packages", () => {
    const bumps = calculateVersionBumps(
      [makePackage({ publish: false })],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
    );
    expect(bumps).toHaveLength(0);
  });

  it("rolls up commits from unpublished deps", () => {
    const featCommit = makeCommit({ type: "feat", description: "new feature" });
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: featCommit },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/cli");
    // feat from unpublished dep -> minor bump (not just patch)
    expect(bumps[0].newVersion).toBe("1.1.0");
    expect(bumps[0].propagated).toBe(false);
    expect(bumps[0].commits).toContain(featCommit);
  });

  it("propagates with patch from published deps", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: true }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ]);
    const cli = bumps.find((b) => b.packageName === "@myapp/cli")!;
    // Published dep -> no rollup, just patch propagation
    expect(cli.newVersion).toBe("1.0.1");
    expect(cli.propagated).toBe(true);
    expect(cli.commits).toHaveLength(0);
  });

  it("rolls up transitively from nested unpublished deps", () => {
    const packages = [
      makePackage({ name: "@myapp/utils", path: "packages/utils", publish: false }),
      makePackage({
        name: "@myapp/core",
        path: "packages/core",
        publish: false,
        workspaceDeps: ["@myapp/utils"],
      }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/utils", commit: makeCommit({ type: "feat" }) },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/cli");
    expect(bumps[0].newVersion).toBe("1.1.0");
    expect(bumps[0].commits).toHaveLength(1);
  });

  it("merges own commits with rolled-up commits", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: makeCommit({ hash: "aaa", type: "feat" }) },
      { packagePath: "packages/cli", commit: makeCommit({ hash: "bbb", type: "fix" }) },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins over fix
    expect(bumps[0].commits).toHaveLength(2);
  });

  it("rolls up breaking change from unpublished dep as major", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      {
        packagePath: "packages/core",
        commit: makeCommit({ type: "feat", breaking: true, description: "rewrite API" }),
      },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("2.0.0");
    expect(bumps[0].level).toBe("major");
  });

  it("rolls up commits from multiple unpublished deps", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({ name: "@myapp/utils", path: "packages/utils", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core", "@myapp/utils"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: makeCommit({ hash: "aaa", type: "feat" }) },
      { packagePath: "packages/utils", commit: makeCommit({ hash: "bbb", type: "fix" }) },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins
    expect(bumps[0].commits).toHaveLength(2);
  });

  it("deduplicates commits touching both parent and unpublished dep", () => {
    const sharedCommit = makeCommit({ hash: "shared1", type: "feat", description: "refactor" });
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: sharedCommit },
      { packagePath: "packages/cli", commit: sharedCommit },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].commits).toHaveLength(1);
    expect(bumps[0].commits[0].hash).toBe("shared1");
  });

  it("does not bump when unpublished dep has only non-bump commits", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      {
        packagePath: "packages/core",
        commit: makeCommit({ type: "chore", description: "update deps" }),
      },
    ]);
    // chore does not produce a bump level, so no bump for core,
    // which means no propagation and no rollup
    expect(bumps).toHaveLength(0);
  });

  it("rolls up with prerelease mode", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(
      packages,
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
      { preid: "beta", lastStableVersions: new Map([["packages/cli", "1.0.0"]]) },
    );
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("1.1.0-beta.0");
    expect(bumps[0].commits).toHaveLength(1);
  });

  it("direct bump over propagated", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: true }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(packages, [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
      { packagePath: "packages/cli", commit: makeCommit({ type: "feat" }) },
    ]);
    const cli = bumps.find((b) => b.packageName === "@myapp/cli")!;
    expect(cli.newVersion).toBe("1.1.0");
    expect(cli.propagated).toBe(false);
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
});

describe("calculateVersionBumps with prerelease", () => {
  it("produces prerelease version for fix", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "fix" }) }],
      { preid: "beta", lastStableVersions: new Map([["packages/core", "1.0.0"]]) },
    );
    expect(bumps[0].newVersion).toBe("1.0.1-beta.0");
  });

  it("produces prerelease version for feat", () => {
    const bumps = calculateVersionBumps(
      [makePackage()],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
      { preid: "beta", lastStableVersions: new Map([["packages/core", "1.0.0"]]) },
    );
    expect(bumps[0].newVersion).toBe("1.1.0-beta.0");
  });

  it("increments existing prerelease", () => {
    const bumps = calculateVersionBumps(
      [makePackage({ version: "1.1.0-beta.2" })],
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
      { preid: "beta", lastStableVersions: new Map([["packages/core", "1.0.0"]]) },
    );
    expect(bumps[0].newVersion).toBe("1.1.0-beta.3");
  });

  it("propagated dep gets prerelease bump", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: true }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const bumps = calculateVersionBumps(
      packages,
      [{ packagePath: "packages/core", commit: makeCommit({ type: "feat" }) }],
      {
        preid: "beta",
        lastStableVersions: new Map([
          ["packages/core", "1.0.0"],
          ["packages/cli", "1.0.0"],
        ]),
      },
    );
    const cli = bumps.find((b) => b.packageName === "@myapp/cli")!;
    expect(cli.newVersion).toBe("1.0.1-beta.0");
    expect(cli.propagated).toBe(true);
  });
});

describe("applyVersionGroups", () => {
  describe("fixed groups", () => {
    it("aligns versions across fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
        { packagePath: "a/cli", commit: makeCommit({ type: "fix" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "fix" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/ui", commit: makeCommit({ type: "feat" }) },
        { packagePath: "a/theme", commit: makeCommit({ type: "fix" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/ui", commit: makeCommit({ type: "feat" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/ui", commit: makeCommit({ type: "fix" }) },
      ]);
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
      const bumps = calculateVersionBumps(
        packages,
        [
          { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
          { packagePath: "a/cli", commit: makeCommit({ type: "fix" }) },
        ],
        {
          preid: "beta",
          lastStableVersions: new Map([
            ["a/core", "1.0.0"],
            ["a/cli", "1.0.0"],
          ]),
        },
      );
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      // Both should have the same (highest) prerelease version
      expect(result[0].newVersion).toBe(result[1].newVersion);
      expect(result[0].newVersion).toBe("1.1.0-beta.0");
    });

    it("aligns prerelease versions in linked group", () => {
      const packages = [
        makePackage({ name: "@a/ui", path: "a/ui", version: "1.0.0" }),
        makePackage({ name: "@a/theme", path: "a/theme", version: "1.0.0" }),
      ];
      const bumps = calculateVersionBumps(
        packages,
        [
          { packagePath: "a/ui", commit: makeCommit({ type: "feat" }) },
          { packagePath: "a/theme", commit: makeCommit({ type: "fix" }) },
        ],
        {
          preid: "beta",
          lastStableVersions: new Map([
            ["a/ui", "1.0.0"],
            ["a/theme", "1.0.0"],
          ]),
        },
      );
      const result = applyVersionGroups(bumps, packages, {
        linked: [["@a/ui", "@a/theme"]],
      });
      expect(result[0].newVersion).toBe("1.1.0-beta.0");
      expect(result[1].newVersion).toBe("1.1.0-beta.0");
    });
  });

  describe("does not mutate input", () => {
    it("preserves original bumps", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/cli", path: "a/cli", version: "1.0.0" }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
        { packagePath: "a/cli", commit: makeCommit({ type: "fix" }) },
      ]);
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

  it("returns cycle when circular", () => {
    const cycle = detectCircularDeps([
      makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });
});
