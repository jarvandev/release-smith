import { describe, expect, it } from "bun:test";
import type { ResolvedPackage } from "@release-smith/config";
import type { ConventionalCommit } from "../src/types";
import {
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

  it("propagates through deps", () => {
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
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/cli");
    expect(bumps[0].newVersion).toBe("1.0.1");
    expect(bumps[0].propagated).toBe(true);
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
