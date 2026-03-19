import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@release-smith/git";
import { runPipeline } from "../src/pipeline";

async function initRepo(dir: string) {
  await execGit(["init"], dir);
  await execGit(["config", "user.email", "test@test.com"], dir);
  await execGit(["config", "user.name", "Test"], dir);
  await execGit(["add", "."], dir);
  await execGit(["commit", "-m", "init"], dir);
}

async function createPackage(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

async function commit(dir: string, message: string, file: string) {
  await mkdir(join(dir, ...file.split("/").slice(0, -1)), { recursive: true });
  await writeFile(join(dir, file), `${Date.now()}-${Math.random()}`);
  await execGit(["add", "."], dir);
  await execGit(["commit", "-m", message], dir);
}

async function tag(dir: string, tagName: string) {
  await execGit(["tag", tagName], dir);
}

async function setupMonorepo(
  dir: string,
  packages: Array<{
    name: string;
    path: string;
    private?: boolean;
    version?: string;
    deps?: Record<string, string>;
    peerDeps?: Record<string, string>;
  }>,
) {
  await createPackage(dir, {
    name: "test-monorepo",
    private: true,
    workspaces: ["packages/*"],
  });
  for (const pkg of packages) {
    await createPackage(join(dir, pkg.path), {
      name: pkg.name,
      version: pkg.version ?? "1.0.0",
      ...(pkg.private ? { private: true } : {}),
      ...(pkg.deps ? { dependencies: pkg.deps } : {}),
      ...(pkg.peerDeps ? { peerDependencies: pkg.peerDeps } : {}),
    });
  }
  await initRepo(dir);
}

describe("pipeline integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-pipeline-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("patch bump for fix commit", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await tag(tempDir, "@test/core@1.0.0");
    await commit(tempDir, "fix: a bug fix", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].newVersion).toBe("1.0.1");
    expect(result.bumps[0].level).toBe("patch");
  });

  it("minor bump for feat commit", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await tag(tempDir, "@test/core@1.0.0");
    await commit(tempDir, "feat: new feature", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].newVersion).toBe("1.1.0");
    expect(result.bumps[0].level).toBe("minor");
  });

  it("rollup from unpublished dep", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/utils", path: "packages/utils", private: true },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/utils": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: new util", "packages/utils/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/cli");
    expect(result.bumps[0].newVersion).toBe("1.1.0");
    expect(result.bumps[0].propagated).toBe(false);
    expect(result.bumps[0].commits).toHaveLength(1);
  });

  it("rollup cutoff: old commits in unpub dep excluded by tag baseline", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/lib", path: "packages/lib", private: true },
      {
        name: "@test/app",
        path: "packages/app",
        deps: { "@test/lib": "workspace:*" },
      },
    ]);
    // Old commit in lib before app's tag
    await commit(tempDir, "feat: old feature", "packages/lib/src/old.ts");
    await tag(tempDir, "@test/app@1.0.0");
    // No new commits after the tag

    const result = await runPipeline(tempDir);
    // The old commit is before app's baseline tag -> should be excluded
    expect(result.bumps).toHaveLength(0);
  });

  it("propagation from published dep", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: core change", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(2);
    const core = result.bumps.find((b) => b.packageName === "@test/core")!;
    const cli = result.bumps.find((b) => b.packageName === "@test/cli")!;
    expect(core.newVersion).toBe("1.1.0");
    expect(core.propagated).toBe(false);
    expect(cli.newVersion).toBe("1.0.1");
    expect(cli.propagated).toBe(true);
    expect(cli.commits).toHaveLength(0);
  });

  it("propagation through unpublished dep", async () => {
    // @test/app -> @test/bridge(unpub) -> @test/core(pub)
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      {
        name: "@test/bridge",
        path: "packages/bridge",
        private: true,
        deps: { "@test/core": "workspace:*" },
      },
      {
        name: "@test/app",
        path: "packages/app",
        deps: { "@test/bridge": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/app@1.0.0");
    await commit(tempDir, "feat: core feat", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    const core = result.bumps.find((b) => b.packageName === "@test/core")!;
    const app = result.bumps.find((b) => b.packageName === "@test/app")!;
    expect(core.newVersion).toBe("1.1.0");
    // app propagated through unpub bridge from pub core
    expect(app.newVersion).toBe("1.0.1");
    expect(app.propagated).toBe(true);
  });

  it("diamond unpublished deps: commits deduplicated", async () => {
    //   shared(unpub)
    //    / \
    //   a   b  (both unpub)
    //    \ /
    //    app (pub)
    await setupMonorepo(tempDir, [
      { name: "@test/shared", path: "packages/shared", private: true },
      {
        name: "@test/a",
        path: "packages/a",
        private: true,
        deps: { "@test/shared": "workspace:*" },
      },
      {
        name: "@test/b",
        path: "packages/b",
        private: true,
        deps: { "@test/shared": "workspace:*" },
      },
      {
        name: "@test/app",
        path: "packages/app",
        deps: { "@test/a": "workspace:*", "@test/b": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/app@1.0.0");
    await commit(tempDir, "feat: shared change", "packages/shared/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/app");
    expect(result.bumps[0].newVersion).toBe("1.1.0");
    // The commit should appear only once despite two paths through the diamond
    expect(result.bumps[0].commits).toHaveLength(1);
  });

  it("ignoreFiles: commits touching only ignored files excluded", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    // Write config to ignore test files
    await writeFile(
      join(tempDir, "release-smith.json"),
      JSON.stringify({
        packages: {
          "packages/core": {
            ignoreFiles: ["**/*.test.ts"],
          },
        },
      }),
    );
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "chore: add config"], tempDir);
    await tag(tempDir, "@test/core@1.0.0");
    await commit(tempDir, "test: add tests", "packages/core/src/index.test.ts");

    const result = await runPipeline(tempDir);
    // Only test file was changed, should be ignored
    expect(result.bumps).toHaveLength(0);
  });

  it("no tag + from config: uses from as baseline", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    // Create some initial commits
    await commit(tempDir, "feat: old feature", "packages/core/src/old.ts");
    const fromHash = (await execGit(["rev-parse", "HEAD"], tempDir)).trim();
    await commit(tempDir, "feat: new feature", "packages/core/src/new.ts");

    // Write config with from pointing to the old commit
    await writeFile(
      join(tempDir, "release-smith.json"),
      JSON.stringify({
        packages: {
          "packages/core": {
            from: fromHash,
          },
        },
      }),
    );
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "chore: add config"], tempDir);

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    // Should only see commits after from, not the old one
    expect(result.bumps[0].commits.length).toBeGreaterThanOrEqual(1);
  });

  it("version groups: fixed group aligns versions", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      { name: "@test/cli", path: "packages/cli" },
    ]);
    await writeFile(
      join(tempDir, "release-smith.json"),
      JSON.stringify({
        groups: {
          fixed: [["@test/core", "@test/cli"]],
        },
      }),
    );
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "chore: add config"], tempDir);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: core feature", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps.length).toBeGreaterThanOrEqual(2);
    const core = result.bumps.find((b) => b.packageName === "@test/core")!;
    const cli = result.bumps.find((b) => b.packageName === "@test/cli")!;
    // Fixed group: both should get the same version
    expect(core.newVersion).toBe(cli.newVersion);
  });

  it("no commits after tag: no bumps", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await tag(tempDir, "@test/core@1.0.0");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(0);
  });

  it("chore commit: no bump", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await tag(tempDir, "@test/core@1.0.0");
    await commit(tempDir, "chore: update deps", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(0);
  });

  it("breaking change: major bump", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await tag(tempDir, "@test/core@1.0.0");
    await commit(tempDir, "feat!: breaking change", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].newVersion).toBe("2.0.0");
    expect(result.bumps[0].level).toBe("major");
  });

  it("commits to unrelated package do not affect other packages", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      { name: "@test/cli", path: "packages/cli" },
    ]);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: cli feature", "packages/cli/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/cli");
  });

  it("direct bump takes precedence over propagation", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: core change", "packages/core/src/index.ts");
    await commit(tempDir, "feat: cli change", "packages/cli/src/index.ts");

    const result = await runPipeline(tempDir);
    const cli = result.bumps.find((b) => b.packageName === "@test/cli")!;
    expect(cli.newVersion).toBe("1.1.0");
    expect(cli.propagated).toBe(false);
  });

  it("transitive rollup through multiple unpublished levels", async () => {
    // utils(unpub) -> core(unpub) -> cli(pub)
    await setupMonorepo(tempDir, [
      { name: "@test/utils", path: "packages/utils", private: true },
      {
        name: "@test/core",
        path: "packages/core",
        private: true,
        deps: { "@test/utils": "workspace:*" },
      },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: deep util change", "packages/utils/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/cli");
    expect(result.bumps[0].newVersion).toBe("1.1.0");
    expect(result.bumps[0].commits).toHaveLength(1);
  });

  it("published boundary stops rollup in mixed chain", async () => {
    // D(unpub) -> C(pub) -> B(unpub) -> A(pub)
    // feat in D should roll up to C, but A should get propagation (not D's commits)
    await setupMonorepo(tempDir, [
      { name: "@test/d", path: "packages/d", private: true },
      {
        name: "@test/c",
        path: "packages/c",
        deps: { "@test/d": "workspace:*" },
      },
      {
        name: "@test/b",
        path: "packages/b",
        private: true,
        deps: { "@test/c": "workspace:*" },
      },
      {
        name: "@test/a",
        path: "packages/a",
        deps: { "@test/b": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/c@1.0.0");
    await tag(tempDir, "@test/a@1.0.0");
    await commit(tempDir, "feat: deep change", "packages/d/src/index.ts");

    const result = await runPipeline(tempDir);
    const c = result.bumps.find((b) => b.packageName === "@test/c")!;
    const a = result.bumps.find((b) => b.packageName === "@test/a")!;
    // C gets D's commits via rollup -> minor
    expect(c.newVersion).toBe("1.1.0");
    expect(c.commits).toHaveLength(1);
    // A gets propagated patch (B is unpub, B's dep C is pub and bumped -> propagation)
    expect(a.newVersion).toBe("1.0.1");
    expect(a.propagated).toBe(true);
    expect(a.commits).toHaveLength(0);
  });

  it("rollup + propagation combined: rollup takes precedence", async () => {
    // A(pub) depends on B(unpub, has fix) and C(pub, has feat)
    await setupMonorepo(tempDir, [
      { name: "@test/b", path: "packages/b", private: true },
      { name: "@test/c", path: "packages/c" },
      {
        name: "@test/a",
        path: "packages/a",
        deps: { "@test/b": "workspace:*", "@test/c": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/c@1.0.0");
    await tag(tempDir, "@test/a@1.0.0");
    await commit(tempDir, "fix: b fix", "packages/b/src/index.ts");
    await commit(tempDir, "feat: c feat", "packages/c/src/index.ts");

    const result = await runPipeline(tempDir);
    const a = result.bumps.find((b) => b.packageName === "@test/a")!;
    const c = result.bumps.find((b) => b.packageName === "@test/c")!;
    expect(c.newVersion).toBe("1.1.0");
    // A has rolled-up commits from B -> not propagated, has commits
    expect(a.propagated).toBe(false);
    expect(a.commits).toHaveLength(1);
    expect(a.level).toBe("patch"); // only fix from B
  });

  it("breaking change from published dep propagates as patch", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/lib", path: "packages/lib" },
      {
        name: "@test/app",
        path: "packages/app",
        deps: { "@test/lib": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/lib@1.0.0");
    await tag(tempDir, "@test/app@1.0.0");
    await commit(tempDir, "feat!: breaking API change", "packages/lib/src/index.ts");

    const result = await runPipeline(tempDir);
    const lib = result.bumps.find((b) => b.packageName === "@test/lib")!;
    const app = result.bumps.find((b) => b.packageName === "@test/app")!;
    expect(lib.newVersion).toBe("2.0.0");
    expect(lib.level).toBe("major");
    // Propagation is always patch, regardless of dep's bump level
    expect(app.newVersion).toBe("1.0.1");
    expect(app.level).toBe("patch");
    expect(app.propagated).toBe(true);
  });

  it("rollup breaking change from unpublished dep produces major", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core", private: true },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat!: breaking internal change", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/cli");
    expect(result.bumps[0].newVersion).toBe("2.0.0");
    expect(result.bumps[0].level).toBe("major");
  });

  it("direct + rollup commits merge and deduplicate", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core", private: true },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: core feature", "packages/core/src/index.ts");
    await commit(tempDir, "fix: cli fix", "packages/cli/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].packageName).toBe("@test/cli");
    // feat from core wins over fix from cli
    expect(result.bumps[0].newVersion).toBe("1.1.0");
    expect(result.bumps[0].level).toBe("minor");
    expect(result.bumps[0].commits).toHaveLength(2);
  });

  it("first release: no tag, no from, uses all commits", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await commit(tempDir, "feat: first feature", "packages/core/src/a.ts");
    await commit(tempDir, "fix: a fix", "packages/core/src/b.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].newVersion).toBe("1.1.0"); // feat wins
    // Should include all conventional commits
    expect(result.bumps[0].commits.length).toBeGreaterThanOrEqual(2);
  });

  it("unpub dep with chore-only commits: no rollup, no bump", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core", private: true },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "chore: update deps", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(0);
  });

  it("multiple disconnected subgraphs: only affected subgraph bumps", async () => {
    // Subgraph 1: a -> b
    // Subgraph 2: x -> y (independent)
    await setupMonorepo(tempDir, [
      { name: "@test/b", path: "packages/b" },
      {
        name: "@test/a",
        path: "packages/a",
        deps: { "@test/b": "workspace:*" },
      },
      { name: "@test/y", path: "packages/y" },
      {
        name: "@test/x",
        path: "packages/x",
        deps: { "@test/y": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/b@1.0.0");
    await tag(tempDir, "@test/a@1.0.0");
    await tag(tempDir, "@test/y@1.0.0");
    await tag(tempDir, "@test/x@1.0.0");
    await commit(tempDir, "fix: b fix", "packages/b/src/index.ts");

    const result = await runPipeline(tempDir);
    // Only b (direct) and a (propagated) should bump
    const names = result.bumps.map((b) => b.packageName);
    expect(names).toContain("@test/b");
    expect(names).toContain("@test/a");
    expect(names).not.toContain("@test/x");
    expect(names).not.toContain("@test/y");
  });

  it("prerelease mode produces prerelease versions", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/core", path: "packages/core" },
      {
        name: "@test/cli",
        path: "packages/cli",
        deps: { "@test/core": "workspace:*" },
      },
    ]);
    await tag(tempDir, "@test/core@1.0.0");
    await tag(tempDir, "@test/cli@1.0.0");
    await commit(tempDir, "feat: core change", "packages/core/src/index.ts");

    const result = await runPipeline(tempDir, { prerelease: "beta" });
    const core = result.bumps.find((b) => b.packageName === "@test/core")!;
    const cli = result.bumps.find((b) => b.packageName === "@test/cli")!;
    expect(core.newVersion).toBe("1.1.0-beta.0");
    expect(cli.newVersion).toBe("1.0.1-beta.0");
    expect(cli.propagated).toBe(true);
  });

  it("wide fan-out: all dependents get propagated patch", async () => {
    await setupMonorepo(tempDir, [
      { name: "@test/hub", path: "packages/hub" },
      { name: "@test/a", path: "packages/a", deps: { "@test/hub": "workspace:*" } },
      { name: "@test/b", path: "packages/b", deps: { "@test/hub": "workspace:*" } },
      { name: "@test/c", path: "packages/c", deps: { "@test/hub": "workspace:*" } },
    ]);
    await tag(tempDir, "@test/hub@1.0.0");
    await tag(tempDir, "@test/a@1.0.0");
    await tag(tempDir, "@test/b@1.0.0");
    await tag(tempDir, "@test/c@1.0.0");
    await commit(tempDir, "feat: hub change", "packages/hub/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(4);
    const hub = result.bumps.find((b) => b.packageName === "@test/hub")!;
    expect(hub.newVersion).toBe("1.1.0");
    for (const name of ["@test/a", "@test/b", "@test/c"]) {
      const dep = result.bumps.find((b) => b.packageName === name)!;
      expect(dep.newVersion).toBe("1.0.1");
      expect(dep.propagated).toBe(true);
    }
  });

  it("propagation through deep published chain", async () => {
    // D(pub) -> C(pub) -> B(pub) -> A(pub), feat in D
    await setupMonorepo(tempDir, [
      { name: "@test/d", path: "packages/d" },
      { name: "@test/c", path: "packages/c", deps: { "@test/d": "workspace:*" } },
      { name: "@test/b", path: "packages/b", deps: { "@test/c": "workspace:*" } },
      { name: "@test/a", path: "packages/a", deps: { "@test/b": "workspace:*" } },
    ]);
    await tag(tempDir, "@test/d@1.0.0");
    await tag(tempDir, "@test/c@1.0.0");
    await tag(tempDir, "@test/b@1.0.0");
    await tag(tempDir, "@test/a@1.0.0");
    await commit(tempDir, "feat: d change", "packages/d/src/index.ts");

    const result = await runPipeline(tempDir);
    expect(result.bumps).toHaveLength(4);
    const d = result.bumps.find((b) => b.packageName === "@test/d")!;
    expect(d.newVersion).toBe("1.1.0");
    expect(d.propagated).toBe(false);
    for (const name of ["@test/c", "@test/b", "@test/a"]) {
      const dep = result.bumps.find((b) => b.packageName === name)!;
      expect(dep.newVersion).toBe("1.0.1");
      expect(dep.propagated).toBe(true);
    }
  });

  it("ignoreFiles: commit touching both ignored and non-ignored files is included", async () => {
    await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
    await writeFile(
      join(tempDir, "release-smith.json"),
      JSON.stringify({
        packages: {
          "packages/core": {
            ignoreFiles: ["**/*.test.ts"],
          },
        },
      }),
    );
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "chore: add config"], tempDir);
    await tag(tempDir, "@test/core@1.0.0");
    // Single commit touches BOTH a test file and a source file
    await mkdir(join(tempDir, "packages/core/src"), { recursive: true });
    await writeFile(join(tempDir, "packages/core/src/index.ts"), "export default 1;");
    await writeFile(join(tempDir, "packages/core/src/index.test.ts"), "test()");
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "feat: add feature with test"], tempDir);

    const result = await runPipeline(tempDir);
    // Commit touches a non-ignored file -> should be included
    expect(result.bumps).toHaveLength(1);
    expect(result.bumps[0].newVersion).toBe("1.1.0");
  });
});
