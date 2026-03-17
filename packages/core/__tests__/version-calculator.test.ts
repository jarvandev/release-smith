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
    ignoreFiles: [],
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

  it("rollupCutoffs filters old commits from unpublished deps", () => {
    const oldCommit = makeCommit({ hash: "old1", type: "feat", description: "old feature" });
    const newCommit = makeCommit({ hash: "new1", type: "fix", description: "new fix" });
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
      [
        { packagePath: "packages/core", commit: oldCommit },
        { packagePath: "packages/core", commit: newCommit },
      ],
      undefined,
      {
        packageCutoffs: new Map([["packages/cli", 100]]), // cli tag at ts=100
        commitTimestamps: new Map([
          ["old1", 50], // before cli tag
          ["new1", 200], // after cli tag
        ]),
      },
    );
    expect(bumps).toHaveLength(1);
    expect(bumps[0].commits).toHaveLength(1);
    expect(bumps[0].commits[0].hash).toBe("new1");
    // Only fix commit remains -> patch
    expect(bumps[0].level).toBe("patch");
  });

  it("rollupCutoffs includes all when no cutoff for package", () => {
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
      [
        { packagePath: "packages/core", commit: makeCommit({ hash: "c1", type: "feat" }) },
        { packagePath: "packages/core", commit: makeCommit({ hash: "c2", type: "fix" }) },
      ],
      undefined,
      {
        packageCutoffs: new Map(), // no cutoff for cli -> include all
        commitTimestamps: new Map([
          ["c1", 50],
          ["c2", 200],
        ]),
      },
    );
    expect(bumps).toHaveLength(1);
    expect(bumps[0].commits).toHaveLength(2);
  });

  it("rollupCutoffs per-consumer: different cutoffs for different consumers", () => {
    const packages = [
      makePackage({ name: "@myapp/utils", path: "packages/utils", publish: false }),
      makePackage({
        name: "@myapp/app-a",
        path: "packages/app-a",
        publish: true,
        workspaceDeps: ["@myapp/utils"],
      }),
      makePackage({
        name: "@myapp/app-b",
        path: "packages/app-b",
        publish: true,
        workspaceDeps: ["@myapp/utils"],
      }),
    ];
    const bumps = calculateVersionBumps(
      packages,
      [
        { packagePath: "packages/utils", commit: makeCommit({ hash: "u1", type: "feat" }) },
        { packagePath: "packages/utils", commit: makeCommit({ hash: "u2", type: "fix" }) },
      ],
      undefined,
      {
        packageCutoffs: new Map([
          ["packages/app-a", 30], // app-a tagged earlier -> sees both commits
          ["packages/app-b", 80], // app-b tagged later -> only sees u2
        ]),
        commitTimestamps: new Map([
          ["u1", 50],
          ["u2", 100],
        ]),
      },
    );
    const appA = bumps.find((b) => b.packageName === "@myapp/app-a")!;
    const appB = bumps.find((b) => b.packageName === "@myapp/app-b")!;
    expect(appA.commits).toHaveLength(2); // both u1 and u2
    expect(appA.level).toBe("minor"); // feat wins
    expect(appB.commits).toHaveLength(1); // only u2
    expect(appB.level).toBe("patch"); // only fix
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

describe("complex dependency graphs", () => {
  describe("deep chains (3+ levels)", () => {
    it("propagates patch through 3-level published chain", () => {
      // D(pub) -> C(pub) -> B(pub) -> A(pub)
      const packages = [
        makePackage({ name: "d", path: "d", publish: true }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["c"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ type: "feat" }) },
      ]);
      const d = bumps.find((b) => b.packageName === "d")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      const b = bumps.find((b) => b.packageName === "b")!;
      const a = bumps.find((b) => b.packageName === "a")!;
      expect(d.newVersion).toBe("1.1.0");
      expect(d.propagated).toBe(false);
      // All dependents get propagated patch
      expect(c.newVersion).toBe("1.0.1");
      expect(c.propagated).toBe(true);
      expect(b.newVersion).toBe("1.0.1");
      expect(b.propagated).toBe(true);
      expect(a.newVersion).toBe("1.0.1");
      expect(a.propagated).toBe(true);
    });

    it("rolls up through 4-level unpublished chain", () => {
      // utils(unpub) -> helpers(unpub) -> core(unpub) -> cli(pub)
      const packages = [
        makePackage({ name: "utils", path: "utils", publish: false }),
        makePackage({ name: "helpers", path: "helpers", publish: false, workspaceDeps: ["utils"] }),
        makePackage({ name: "core", path: "core", publish: false, workspaceDeps: ["helpers"] }),
        makePackage({ name: "cli", path: "cli", publish: true, workspaceDeps: ["core"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "utils", commit: makeCommit({ type: "feat", description: "deep util" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("cli");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat preserved through rollup
      expect(bumps[0].commits).toHaveLength(1);
      expect(bumps[0].commits[0].description).toBe("deep util");
    });

    it("rolls up commits from multiple levels of unpublished deps", () => {
      // utils(unpub) -> core(unpub) -> cli(pub)
      // both utils and core have commits
      const packages = [
        makePackage({ name: "utils", path: "utils", publish: false }),
        makePackage({ name: "core", path: "core", publish: false, workspaceDeps: ["utils"] }),
        makePackage({ name: "cli", path: "cli", publish: true, workspaceDeps: ["core"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "utils", commit: makeCommit({ hash: "u1", type: "fix" }) },
        { packagePath: "core", commit: makeCommit({ hash: "c1", type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("cli");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins
      expect(bumps[0].commits).toHaveLength(2);
    });

    it("published boundary stops rollup in mixed chain", () => {
      // D(unpub) -> C(pub) -> B(unpub) -> A(pub)
      // feat in D should roll up to C, NOT to A
      const packages = [
        makePackage({ name: "d", path: "d", publish: false }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "b", path: "b", publish: false, workspaceDeps: ["c"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ type: "feat", description: "deep change" }) },
      ]);
      const c = bumps.find((b) => b.packageName === "c")!;
      const a = bumps.find((b) => b.packageName === "a")!;
      // C gets D's commits via rollup -> minor
      expect(c.newVersion).toBe("1.1.0");
      expect(c.commits).toHaveLength(1);
      expect(c.commits[0].description).toBe("deep change");
      // A gets propagated patch (B is unpub with no commits, B's dep C is pub -> skip in rollup)
      expect(a.newVersion).toBe("1.0.1");
      expect(a.propagated).toBe(true);
      expect(a.commits).toHaveLength(0);
    });
  });

  describe("diamond dependencies", () => {
    it("propagates correctly in diamond (all published)", () => {
      //     D (feat)
      //    / \
      //   B   C
      //    \ /
      //     A
      const packages = [
        makePackage({ name: "d", path: "d", publish: true }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b", "c"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(4);
      const d = bumps.find((b) => b.packageName === "d")!;
      const b = bumps.find((b) => b.packageName === "b")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      const a = bumps.find((b) => b.packageName === "a")!;
      expect(d.newVersion).toBe("1.1.0");
      expect(b.propagated).toBe(true);
      expect(c.propagated).toBe(true);
      expect(a.propagated).toBe(true);
      // A only gets one patch, not double-propagated
      expect(a.newVersion).toBe("1.0.1");
    });

    it("rolls up through diamond (all unpublished)", () => {
      //     D (feat, unpub)
      //    / \
      //   B   C  (both unpub)
      //    \ /
      //     A  (pub)
      const packages = [
        makePackage({ name: "d", path: "d", publish: false }),
        makePackage({ name: "b", path: "b", publish: false, workspaceDeps: ["d"] }),
        makePackage({ name: "c", path: "c", publish: false, workspaceDeps: ["d"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b", "c"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ hash: "d1", type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("a");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat from D
      // D's commit collected via B path; C path skips D (already visited)
      // -> deduplicated to 1 commit
      expect(bumps[0].commits).toHaveLength(1);
    });

    it("rolls up through diamond with commits at multiple levels", () => {
      //     D (feat, unpub)
      //    / \
      //   B   C  (both unpub, B has fix)
      //    \ /
      //     A  (pub)
      const packages = [
        makePackage({ name: "d", path: "d", publish: false }),
        makePackage({ name: "b", path: "b", publish: false, workspaceDeps: ["d"] }),
        makePackage({ name: "c", path: "c", publish: false, workspaceDeps: ["d"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b", "c"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ hash: "d1", type: "feat" }) },
        { packagePath: "b", commit: makeCommit({ hash: "b1", type: "fix" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("a");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins
      expect(bumps[0].commits).toHaveLength(2); // D's feat + B's fix
    });

    it("handles diamond mixed pub/unpub", () => {
      //     D (feat, unpub)
      //    / \
      //   B   C  (both pub)
      //    \ /
      //     A  (pub)
      const packages = [
        makePackage({ name: "d", path: "d", publish: false }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["d"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b", "c"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "d", commit: makeCommit({ type: "feat" }) },
      ]);
      // D is unpub -> rolls up to B and C (both pub)
      const b = bumps.find((b) => b.packageName === "b")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      const a = bumps.find((b) => b.packageName === "a")!;
      expect(b.newVersion).toBe("1.1.0"); // feat from rollup
      expect(c.newVersion).toBe("1.1.0"); // feat from rollup
      // A is propagated from B and C (published deps bumped)
      expect(a.newVersion).toBe("1.0.1");
      expect(a.propagated).toBe(true);
    });

    it("multiple published consumers share unpublished diamond bottom", () => {
      //     shared (feat, unpub)
      //    / \
      //   X   Y  (both pub, independent)
      const packages = [
        makePackage({ name: "shared", path: "shared", publish: false }),
        makePackage({ name: "x", path: "x", publish: true, workspaceDeps: ["shared"] }),
        makePackage({ name: "y", path: "y", publish: true, workspaceDeps: ["shared"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "shared", commit: makeCommit({ hash: "s1", type: "feat" }) },
      ]);
      const x = bumps.find((b) => b.packageName === "x")!;
      const y = bumps.find((b) => b.packageName === "y")!;
      // Both get the same rollup
      expect(x.newVersion).toBe("1.1.0");
      expect(y.newVersion).toBe("1.1.0");
      expect(x.commits).toHaveLength(1);
      expect(y.commits).toHaveLength(1);
    });
  });

  describe("circular dependencies", () => {
    it("propagation handles 2-node cycle without infinite loop", () => {
      // A(pub) <-> B(pub), feat in A
      const packages = [
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["a"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a", commit: makeCommit({ type: "feat" }) },
      ]);
      const a = bumps.find((b) => b.packageName === "a")!;
      const b = bumps.find((b) => b.packageName === "b")!;
      expect(a.newVersion).toBe("1.1.0"); // direct feat
      expect(b.newVersion).toBe("1.0.1"); // propagated
      expect(b.propagated).toBe(true);
    });

    it("propagation handles 3-node cycle without infinite loop", () => {
      // A -> B -> C -> A, feat in A
      const packages = [
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["c"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["a"] }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a", commit: makeCommit({ type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(3);
      const a = bumps.find((b) => b.packageName === "a")!;
      const b = bumps.find((b) => b.packageName === "b")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      expect(a.newVersion).toBe("1.1.0"); // direct
      expect(b.propagated).toBe(true);
      expect(c.propagated).toBe(true);
    });

    it("rollup handles circular unpublished deps without infinite loop", () => {
      // app(pub) -> x(unpub) -> y(unpub) -> x (circular)
      const packages = [
        makePackage({ name: "x", path: "x", publish: false, workspaceDeps: ["y"] }),
        makePackage({ name: "y", path: "y", publish: false, workspaceDeps: ["x"] }),
        makePackage({ name: "app", path: "app", publish: true, workspaceDeps: ["x"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "x", commit: makeCommit({ hash: "x1", type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("app");
      expect(bumps[0].newVersion).toBe("1.1.0");
      // x's commit collected, y has no commit, circular ref doesn't cause infinite loop
      expect(bumps[0].commits).toHaveLength(1);
    });

    it("rollup handles circular unpublished deps with commits on both", () => {
      // app(pub) -> x(unpub) <-> y(unpub), both have commits
      const packages = [
        makePackage({ name: "x", path: "x", publish: false, workspaceDeps: ["y"] }),
        makePackage({ name: "y", path: "y", publish: false, workspaceDeps: ["x"] }),
        makePackage({ name: "app", path: "app", publish: true, workspaceDeps: ["x"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "x", commit: makeCommit({ hash: "x1", type: "feat" }) },
        { packagePath: "y", commit: makeCommit({ hash: "y1", type: "fix" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("app");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins
      // Both commits collected
      expect(bumps[0].commits).toHaveLength(2);
    });
  });

  describe("mixed scenarios", () => {
    it("direct bump wins over propagation in deep chain", () => {
      // A(pub) -> B(pub) -> C(pub), fix in A, feat in C
      const packages = [
        makePackage({ name: "c", path: "c", publish: true }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["c"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "c", commit: makeCommit({ type: "feat" }) },
        { packagePath: "a", commit: makeCommit({ type: "fix" }) },
      ]);
      const a = bumps.find((b) => b.packageName === "a")!;
      const b = bumps.find((b) => b.packageName === "b")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      expect(c.newVersion).toBe("1.1.0"); // direct feat
      expect(b.newVersion).toBe("1.0.1"); // propagated from C
      expect(b.propagated).toBe(true);
      // A has direct fix -> not propagated
      expect(a.newVersion).toBe("1.0.1"); // fix
      expect(a.propagated).toBe(false);
    });

    it("wide fan-out: all dependents get propagated", () => {
      const packages = [
        makePackage({ name: "hub", path: "hub", publish: true }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "c", path: "c", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "d", path: "d", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "e", path: "e", publish: true, workspaceDeps: ["hub"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "hub", commit: makeCommit({ type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(6);
      const hub = bumps.find((b) => b.packageName === "hub")!;
      expect(hub.newVersion).toBe("1.1.0");
      for (const name of ["a", "b", "c", "d", "e"]) {
        const dep = bumps.find((b) => b.packageName === name)!;
        expect(dep.newVersion).toBe("1.0.1");
        expect(dep.propagated).toBe(true);
      }
    });

    it("wide fan-in: multiple unpublished deps roll up to single published", () => {
      const packages = [
        makePackage({ name: "a", path: "a", publish: false }),
        makePackage({ name: "b", path: "b", publish: false }),
        makePackage({ name: "c", path: "c", publish: false }),
        makePackage({
          name: "app",
          path: "app",
          publish: true,
          workspaceDeps: ["a", "b", "c"],
        }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a", commit: makeCommit({ hash: "a1", type: "feat" }) },
        { packagePath: "b", commit: makeCommit({ hash: "b1", type: "fix" }) },
        { packagePath: "c", commit: makeCommit({ hash: "c1", type: "fix" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("app");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat wins
      expect(bumps[0].commits).toHaveLength(3);
    });

    it("deep diamond with mixed commits at every level", () => {
      //       E (fix, unpub)
      //      / \
      //     C   D (C: feat, D: no commit, both unpub)
      //      \ /
      //       B (fix, unpub)
      //       |
      //       A (pub)
      const packages = [
        makePackage({ name: "e", path: "e", publish: false }),
        makePackage({ name: "c", path: "c", publish: false, workspaceDeps: ["e"] }),
        makePackage({ name: "d", path: "d", publish: false, workspaceDeps: ["e"] }),
        makePackage({ name: "b", path: "b", publish: false, workspaceDeps: ["c", "d"] }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "e", commit: makeCommit({ hash: "e1", type: "fix" }) },
        { packagePath: "c", commit: makeCommit({ hash: "c1", type: "feat" }) },
        { packagePath: "b", commit: makeCommit({ hash: "b1", type: "fix" }) },
      ]);
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("a");
      expect(bumps[0].newVersion).toBe("1.1.0"); // feat from C wins
      // B's fix + C's feat + E's fix (collected via C; D path skips E as visited)
      expect(bumps[0].commits).toHaveLength(3);
    });

    it("two published packages at different depths of unpublished chain", () => {
      // utils(unpub) -> core(unpub) -> cli(pub) and web(pub)
      // cli depends on core, web depends on utils directly
      const packages = [
        makePackage({ name: "utils", path: "utils", publish: false }),
        makePackage({ name: "core", path: "core", publish: false, workspaceDeps: ["utils"] }),
        makePackage({ name: "cli", path: "cli", publish: true, workspaceDeps: ["core"] }),
        makePackage({ name: "web", path: "web", publish: true, workspaceDeps: ["utils"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "utils", commit: makeCommit({ hash: "u1", type: "feat" }) },
      ]);
      const cli = bumps.find((b) => b.packageName === "cli")!;
      const web = bumps.find((b) => b.packageName === "web")!;
      // Both get utils' commit via rollup
      expect(cli.newVersion).toBe("1.1.0");
      expect(cli.commits).toHaveLength(1);
      expect(web.newVersion).toBe("1.1.0");
      expect(web.commits).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("propagation + rollup combined on same package", () => {
      // A(pub) depends on B(unpub, has fix) and C(pub, has feat)
      // A should get B's fix via rollup, and be propagated from C
      // Rollup branch takes precedence when rolled-up commits exist
      const packages = [
        makePackage({ name: "b", path: "b", publish: false }),
        makePackage({ name: "c", path: "c", publish: true }),
        makePackage({
          name: "a",
          path: "a",
          publish: true,
          workspaceDeps: ["b", "c"],
        }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "b", commit: makeCommit({ hash: "b1", type: "fix" }) },
        { packagePath: "c", commit: makeCommit({ hash: "c1", type: "feat" }) },
      ]);
      const a = bumps.find((b) => b.packageName === "a")!;
      const c = bumps.find((b) => b.packageName === "c")!;
      expect(c.newVersion).toBe("1.1.0"); // direct feat
      // A gets B's fix via rollup; C is published so not rolled up
      expect(a.newVersion).toBe("1.0.1"); // only fix from rollup
      expect(a.propagated).toBe(false); // has rolled-up commits
      expect(a.commits).toHaveLength(1);
      expect(a.commits[0].hash).toBe("b1");
    });

    it("chore-only commits on published package that is also propagated", () => {
      // A(pub) depends on B(pub). B has feat.
      // A has chore commit (no bump). A should still be propagated from B.
      const packages = [
        makePackage({ name: "b", path: "b", publish: true }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "b", commit: makeCommit({ type: "feat" }) },
        { packagePath: "a", commit: makeCommit({ type: "chore" }) },
      ]);
      const a = bumps.find((b) => b.packageName === "a")!;
      // chore does not create a direct bump, but propagation still applies
      expect(a.newVersion).toBe("1.0.1");
      expect(a.propagated).toBe(true);
    });

    it("orphaned unpublished package (no published consumer)", () => {
      const packages = [
        makePackage({ name: "orphan", path: "orphan", publish: false }),
        makePackage({ name: "app", path: "app", publish: true }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "orphan", commit: makeCommit({ type: "feat" }) },
      ]);
      // No published package depends on orphan → 0 bumps
      expect(bumps).toHaveLength(0);
    });

    it("all packages unpublished", () => {
      const packages = [
        makePackage({ name: "a", path: "a", publish: false }),
        makePackage({ name: "b", path: "b", publish: false, workspaceDeps: ["a"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a", commit: makeCommit({ type: "feat" }) },
      ]);
      expect(bumps).toHaveLength(0);
    });

    it("empty packageCommits produces no bumps", () => {
      const packages = [makePackage()];
      const bumps = calculateVersionBumps(packages, []);
      expect(bumps).toHaveLength(0);
    });

    it("rollupCutoffs boundary: commit at exact cutoff timestamp is filtered", () => {
      const packages = [
        makePackage({ name: "dep", path: "dep", publish: false }),
        makePackage({
          name: "app",
          path: "app",
          publish: true,
          workspaceDeps: ["dep"],
        }),
      ];
      const bumps = calculateVersionBumps(
        packages,
        [{ packagePath: "dep", commit: makeCommit({ hash: "d1", type: "feat" }) }],
        undefined,
        {
          packageCutoffs: new Map([["app", 100]]),
          commitTimestamps: new Map([["d1", 100]]), // equal to cutoff
        },
      );
      // ts <= cutoff → filtered. No commits remain, no direct bump.
      // But dep has a direct bump which triggers propagation of app.
      // app is in propagatedPaths but has no rolled-up commits → propagated patch.
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("app");
      expect(bumps[0].propagated).toBe(true);
      expect(bumps[0].commits).toHaveLength(0);
      expect(bumps[0].newVersion).toBe("1.0.1");
    });

    it("rollup all filtered by cutoff but package still propagated", () => {
      // All unpublished dep commits are old (filtered), but the propagation
      // from the unpublished dep's directBump still marks this package.
      const packages = [
        makePackage({ name: "lib", path: "lib", publish: false }),
        makePackage({
          name: "app",
          path: "app",
          publish: true,
          workspaceDeps: ["lib"],
        }),
      ];
      const bumps = calculateVersionBumps(
        packages,
        [
          { packagePath: "lib", commit: makeCommit({ hash: "l1", type: "feat" }) },
          { packagePath: "lib", commit: makeCommit({ hash: "l2", type: "fix" }) },
        ],
        undefined,
        {
          packageCutoffs: new Map([["app", 200]]),
          commitTimestamps: new Map([
            ["l1", 50],
            ["l2", 100],
          ]),
        },
      );
      expect(bumps).toHaveLength(1);
      expect(bumps[0].packageName).toBe("app");
      // All rolled-up commits filtered → propagated patch
      expect(bumps[0].propagated).toBe(true);
      expect(bumps[0].commits).toHaveLength(0);
      expect(bumps[0].newVersion).toBe("1.0.1");
    });

    it("multiple disconnected subgraphs: only affected subgraph bumps", () => {
      // Subgraph 1: a(pub) -> b(pub)
      // Subgraph 2: x(pub) -> y(pub)
      // Only b has a commit.
      const packages = [
        makePackage({ name: "b", path: "b", publish: true }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["b"] }),
        makePackage({ name: "y", path: "y", publish: true }),
        makePackage({ name: "x", path: "x", publish: true, workspaceDeps: ["y"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "b", commit: makeCommit({ type: "fix" }) },
      ]);
      // Only b (direct) and a (propagated) should bump
      expect(bumps).toHaveLength(2);
      expect(bumps.find((b) => b.packageName === "b")).toBeDefined();
      expect(bumps.find((b) => b.packageName === "a")).toBeDefined();
      // x and y should not be bumped
      expect(bumps.find((b) => b.packageName === "x")).toBeUndefined();
      expect(bumps.find((b) => b.packageName === "y")).toBeUndefined();
    });

    it("breaking change from published dep propagates as patch (not major)", () => {
      const packages = [
        makePackage({ name: "lib", path: "lib", publish: true }),
        makePackage({ name: "app", path: "app", publish: true, workspaceDeps: ["lib"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "lib", commit: makeCommit({ type: "feat", breaking: true }) },
      ]);
      const lib = bumps.find((b) => b.packageName === "lib")!;
      const app = bumps.find((b) => b.packageName === "app")!;
      expect(lib.newVersion).toBe("2.0.0");
      expect(lib.level).toBe("major");
      // Published dep propagation is always patch, regardless of dep's bump level
      expect(app.newVersion).toBe("1.0.1");
      expect(app.level).toBe("patch");
      expect(app.propagated).toBe(true);
    });

    it("0.x version: major breaking goes to 1.0.0", () => {
      const packages = [makePackage({ version: "0.5.3" })];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "packages/core", commit: makeCommit({ type: "feat", breaking: true }) },
      ]);
      expect(bumps[0].newVersion).toBe("1.0.0");
    });
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
      const prereleaseOpts = {
        preid: "beta",
        lastStableVersions: new Map([
          ["a/core", "1.0.0"],
          ["a/cli", "1.0.0"],
        ]),
      };
      const bumps = calculateVersionBumps(
        packages,
        [
          { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
          { packagePath: "a/cli", commit: makeCommit({ type: "fix" }) },
        ],
        prereleaseOpts,
      );
      const result = applyVersionGroups(
        bumps,
        packages,
        {
          fixed: [["@a/core", "@a/cli"]],
        },
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
      const bumps = calculateVersionBumps(
        packages,
        [
          { packagePath: "a/ui", commit: makeCommit({ type: "feat" }) },
          { packagePath: "a/theme", commit: makeCommit({ type: "fix" }) },
        ],
        prereleaseOpts,
      );
      const result = applyVersionGroups(
        bumps,
        packages,
        {
          linked: [["@a/ui", "@a/theme"]],
        },
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
      const bumps = calculateVersionBumps(
        packages,
        [{ packagePath: "a/core", commit: makeCommit({ type: "feat" }) }],
        prereleaseOpts,
      );
      const result = applyVersionGroups(
        bumps,
        packages,
        {
          fixed: [["@a/core", "@a/cli"]],
        },
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
      const bumps = calculateVersionBumps(
        packages,
        [{ packagePath: "a/core", commit: makeCommit({ type: "fix" }) }],
        prereleaseOpts,
      );
      const result = applyVersionGroups(
        bumps,
        packages,
        {
          fixed: [["@a/core", "@a/cli"]],
        },
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
      const bumps = calculateVersionBumps(
        packages,
        [{ packagePath: "a/cli", commit: makeCommit({ type: "feat" }) }],
        prereleaseOpts,
      );
      const result = applyVersionGroups(
        bumps,
        packages,
        {
          fixed: [["@a/core", "@a/cli"]],
        },
        prereleaseOpts,
      );
      // core has no commits but higher base version (2.0.0)
      // wouldBe prerelease: bumpPrerelease("2.0.0", "2.0.0", "minor", "rc") = "2.1.0-rc.0"
      // cli: bumpPrerelease("1.0.0", "1.0.0", "minor", "rc") = "1.1.0-rc.0"
      // finalVersion = max(1.1.0-rc.0, 2.1.0-rc.0) = 2.1.0-rc.0
      for (const b of result) {
        expect(b.newVersion).toContain("-rc.");
      }
    });
  });

  describe("edge cases", () => {
    it("handles empty groups object", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core" })];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "fix" }) },
      ]);
      const result = applyVersionGroups(bumps, packages, {});
      expect(result).toHaveLength(1);
      expect(result[0].newVersion).toBe("1.0.1");
    });

    it("handles empty fixed and linked arrays", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core" })];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "fix" }) },
      ]);
      const result = applyVersionGroups(bumps, packages, { fixed: [], linked: [] });
      expect(result).toHaveLength(1);
      expect(result[0].newVersion).toBe("1.0.1");
    });

    it("skips non-publish packages when adding missing in fixed group", () => {
      const packages = [
        makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" }),
        makePackage({ name: "@a/internal", path: "a/internal", version: "1.0.0", publish: false }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
      ]);
      const result = applyVersionGroups(bumps, packages, {
        fixed: [["@a/core", "@a/cli"]],
      });
      // cli version bump from 1.1.0 + patch = 1.1.1 vs core bump 1.1.0
      // finalVersion = max(1.1.0, bumpVersion("1.1.0", "minor")) = max(1.1.0, 1.2.0) = 1.2.0
      // Actually: core is bumped to 1.1.0 (from feat).
      // cli is not bumped. Its "wouldBe" = bumpVersion("1.1.0", "minor") = 1.2.0.
      // finalVersion = max(1.1.0, 1.2.0) = 1.2.0.
      // cli gets added with 1.2.0.
      const core = result.find((b) => b.packageName === "@a/core")!;
      const cli = result.find((b) => b.packageName === "@a/cli")!;
      expect(core.newVersion).toBe(cli.newVersion);
    });

    it("fixed group with non-existent package name is ignored", () => {
      const packages = [makePackage({ name: "@a/core", path: "a/core", version: "1.0.0" })];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "fix" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/core", commit: makeCommit({ type: "feat" }) },
      ]);
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
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "a/lib", commit: makeCommit({ type: "feat" }) },
      ]);
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
      // hub(pub, feat) -> a(pub, propagated) and b(pub, propagated)
      // a and b in linked group. Both are propagated patch 1.0.1.
      // b also has a direct fix. So b = 1.0.1 (direct), a = 1.0.1 (propagated).
      // Linked should align them (already same in this case).
      const packages = [
        makePackage({ name: "hub", path: "hub", publish: true }),
        makePackage({ name: "a", path: "a", publish: true, workspaceDeps: ["hub"] }),
        makePackage({ name: "b", path: "b", publish: true, workspaceDeps: ["hub"] }),
      ];
      const bumps = calculateVersionBumps(packages, [
        { packagePath: "hub", commit: makeCommit({ type: "feat" }) },
        { packagePath: "b", commit: makeCommit({ hash: "b1", type: "feat" }) },
      ]);
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
