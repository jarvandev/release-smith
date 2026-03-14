import { describe, expect, it } from "bun:test";
import type { ResolvedPackage } from "@release-smith/config";
import type { ConventionalCommit } from "../src/types";
import { bumpVersion, calculateVersionBumps, detectCircularDeps } from "../src/version-calculator";

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
