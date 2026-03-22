import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResolvedPackage } from "@release-smith/config";
import { execGit } from "@release-smith/git";
import {
  applyReleaseChanges,
  buildCommitMessage,
  createReleaseTags,
  detectPackageManager,
  updateLockFile,
  updatePackageVersion,
  updateVersionRange,
  updateWorkspaceDeps,
} from "../src/releaser";
import type { VersionBump } from "../src/types";

describe("updatePackageVersion", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("updates version in package.json", async () => {
    const pkgDir = join(tempDir, "packages/core");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await updatePackageVersion(pkgDir, "1.1.0");
    const content = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8"));
    expect(content.version).toBe("1.1.0");
  });

  it("preserves other fields", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "@myapp/core", version: "1.0.0", description: "Core lib" }, null, 2) +
        "\n",
    );
    await updatePackageVersion(tempDir, "2.0.0");
    const content = JSON.parse(await readFile(join(tempDir, "package.json"), "utf-8"));
    expect(content.description).toBe("Core lib");
    expect(content.version).toBe("2.0.0");
  });
});

describe("updateWorkspaceDeps", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("preserves workspace:* (auto-resolving range)", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:*");
  });

  it("updates workspace:^x.y.z preserving caret", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        {
          name: "@myapp/cli",
          version: "1.0.0",
          dependencies: { "@myapp/core": "workspace:^1.0.0" },
        },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:^1.1.0");
  });

  it("updates peerDependencies too", async () => {
    await mkdir(join(tempDir, "packages/plugin"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/plugin/package.json"),
      `${JSON.stringify(
        { name: "@myapp/plugin", version: "1.0.0", peerDependencies: { "@myapp/core": "^1.0.0" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/plugin"), versionMap);
    const content = JSON.parse(
      await readFile(join(tempDir, "packages/plugin/package.json"), "utf-8"),
    );
    expect(content.peerDependencies["@myapp/core"]).toBe("^2.0.0");
  });

  it("does not modify deps not in versionMap", async () => {
    await mkdir(join(tempDir, "packages/app"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/app/package.json"),
      `${JSON.stringify(
        {
          name: "@myapp/app",
          version: "1.0.0",
          dependencies: { "@myapp/core": "workspace:^1.0.0", lodash: "^4.17.0" },
        },
        null,
        2,
      )}\n`,
    );
    // Only update @myapp/core, lodash should remain unchanged
    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/app"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/app/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:^2.0.0");
    expect(content.dependencies.lodash).toBe("^4.17.0");
  });

  it("preserves tilde range", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "~1.0.0" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("~1.1.0");
  });

  it("preserves exact version (no range prefix)", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "1.0.0" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("2.0.0");
  });

  it("preserves workspace:~ (auto-resolving shorthand)", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:~" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:~");
  });

  it("preserves workspace:^ (auto-resolving shorthand)", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:^" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:^");
  });

  it("updates workspace:~x.y.z preserving tilde", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        {
          name: "@myapp/cli",
          version: "1.0.0",
          dependencies: { "@myapp/core": "workspace:~1.0.0" },
        },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe("workspace:~1.1.0");
  });

  it("preserves >= range prefix", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": ">=1.0.0" } },
        null,
        2,
      )}\n`,
    );
    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"));
    expect(content.dependencies["@myapp/core"]).toBe(">=2.0.0");
  });

  it("handles package.json with no dependencies", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      `${JSON.stringify({ name: "my-pkg", version: "1.0.0" }, null, 2)}\n`,
    );
    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    // Should not throw
    await updateWorkspaceDeps(tempDir, versionMap);
    const content = JSON.parse(await readFile(join(tempDir, "package.json"), "utf-8"));
    expect(content.dependencies).toBeUndefined();
  });
});

describe("updateVersionRange", () => {
  it("returns null for workspace:* (auto-resolving)", () => {
    expect(updateVersionRange("workspace:*", "2.0.0")).toBeNull();
  });

  it("returns null for workspace:^ (auto-resolving shorthand)", () => {
    expect(updateVersionRange("workspace:^", "2.0.0")).toBeNull();
  });

  it("returns null for workspace:~ (auto-resolving shorthand)", () => {
    expect(updateVersionRange("workspace:~", "2.0.0")).toBeNull();
  });

  it("preserves workspace:^ with explicit version", () => {
    expect(updateVersionRange("workspace:^1.0.0", "2.0.0")).toBe("workspace:^2.0.0");
  });

  it("preserves workspace:~ with explicit version", () => {
    expect(updateVersionRange("workspace:~1.0.0", "2.0.0")).toBe("workspace:~2.0.0");
  });

  it("preserves caret range", () => {
    expect(updateVersionRange("^1.0.0", "2.0.0")).toBe("^2.0.0");
  });

  it("preserves tilde range", () => {
    expect(updateVersionRange("~1.0.0", "2.0.0")).toBe("~2.0.0");
  });

  it("preserves exact version (no prefix)", () => {
    expect(updateVersionRange("1.0.0", "2.0.0")).toBe("2.0.0");
  });

  it("preserves >= range", () => {
    expect(updateVersionRange(">=1.0.0", "2.0.0")).toBe(">=2.0.0");
  });

  it("preserves > range", () => {
    expect(updateVersionRange(">1.0.0", "2.0.0")).toBe(">2.0.0");
  });

  it("preserves workspace: with exact version (no range prefix)", () => {
    expect(updateVersionRange("workspace:1.0.0", "2.0.0")).toBe("workspace:2.0.0");
  });

  it("handles prerelease version as new version", () => {
    expect(updateVersionRange("^1.0.0", "2.0.0-beta.0")).toBe("^2.0.0-beta.0");
  });

  it("handles workspace: with prerelease version", () => {
    expect(updateVersionRange("workspace:^1.0.0", "2.0.0-beta.0")).toBe("workspace:^2.0.0-beta.0");
  });

  it("throws on complex range with space (>=1.0.0 <2.0.0)", () => {
    expect(() => updateVersionRange(">=1.0.0 <2.0.0", "2.0.0")).toThrow(
      /Complex version range.*not supported/,
    );
  });

  it("throws on OR range (1.x || 2.x)", () => {
    expect(() => updateVersionRange("1.x || 2.x", "3.0.0")).toThrow(
      /Complex version range.*not supported/,
    );
  });

  it("throws on workspace: with complex range", () => {
    expect(() => updateVersionRange("workspace:>=1.0.0 <2.0.0", "2.0.0")).toThrow(
      /Complex version range.*not supported/,
    );
  });
});

describe("buildCommitMessage", () => {
  it("builds message for single package", () => {
    const msg = buildCommitMessage([
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.1.0",
        changelog: "",
        tagName: "v1.1.0",
      },
    ]);
    expect(msg).toBe("chore(release): @myapp/core@1.1.0");
  });

  it("builds message for multiple packages", () => {
    const msg = buildCommitMessage([
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.1.0",
        changelog: "",
        tagName: "",
      },
      {
        packageName: "@myapp/cli",
        packagePath: "packages/cli",
        version: "2.0.0",
        changelog: "",
        tagName: "",
      },
    ]);
    expect(msg).toBe("chore(release): @myapp/core@1.1.0, @myapp/cli@2.0.0");
  });

  it("throws on empty results", () => {
    expect(() => buildCommitMessage([])).toThrow("Cannot build commit message from empty");
  });

  it("builds message with prerelease version", () => {
    const msg = buildCommitMessage([
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.1.0-beta.0",
        changelog: "",
        tagName: "v1.1.0-beta.0",
      },
    ]);
    expect(msg).toBe("chore(release): @myapp/core@1.1.0-beta.0");
  });
});

async function initGitRepo(dir: string) {
  await execGit(["init"], dir);
  await execGit(["config", "user.email", "test@test.com"], dir);
  await execGit(["config", "user.name", "Test"], dir);
}

async function gitCommit(dir: string, message: string) {
  await execGit(["add", "-A"], dir);
  await execGit(["commit", "-m", message, "--allow-empty"], dir);
}

function makeBump(overrides: Partial<VersionBump> = {}): VersionBump {
  return {
    packagePath: "packages/core",
    packageName: "@myapp/core",
    currentVersion: "1.0.0",
    newVersion: "1.1.0",
    level: "minor",
    commits: [
      {
        hash: "abc123",
        type: "feat",
        scope: null,
        description: "add feature",
        body: "",
        breaking: false,
        rawMessage: "feat: add feature",
      },
    ],
    propagated: false,
    ...overrides,
  };
}

function makePackage(overrides: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return {
    name: "@myapp/core",
    path: "packages/core",
    publish: true,
    changelogPath: "",
    version: "1.0.0",
    isPrivate: false,
    workspaceDeps: [],
    ignoreFiles: [],
    ...overrides,
  };
}

describe("applyReleaseChanges", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-apply-"));
    await initGitRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("updates package.json version", async () => {
    const pkgDir = join(tempDir, "packages/core");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await gitCommit(tempDir, "chore: init");

    const pkg = makePackage({ changelogPath: join(pkgDir, "CHANGELOG.md") });
    const bump = makeBump();
    const results = await applyReleaseChanges({
      cwd: tempDir,
      bumps: [bump],
      packages: [pkg],
      isMonorepo: true,
    });

    const content = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8"));
    expect(content.version).toBe("1.1.0");
    expect(results).toHaveLength(1);
    expect(results[0].version).toBe("1.1.0");
  });

  it("writes CHANGELOG.md", async () => {
    const pkgDir = join(tempDir, "packages/core");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await gitCommit(tempDir, "chore: init");

    const changelogPath = join(pkgDir, "CHANGELOG.md");
    const pkg = makePackage({ changelogPath });
    const bump = makeBump();
    await applyReleaseChanges({
      cwd: tempDir,
      bumps: [bump],
      packages: [pkg],
      isMonorepo: true,
    });

    const changelog = await readFile(changelogPath, "utf-8");
    expect(changelog).toContain("## [1.1.0]");
    expect(changelog).toContain("add feature");
  });

  it("updates workspace dependency versions", async () => {
    const coreDir = join(tempDir, "packages/core");
    const cliDir = join(tempDir, "packages/cli");
    await mkdir(coreDir, { recursive: true });
    await mkdir(cliDir, { recursive: true });
    await writeFile(
      join(coreDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(cliDir, "package.json"),
      `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
    );
    await gitCommit(tempDir, "chore: init");

    const corePkg = makePackage({ changelogPath: join(coreDir, "CHANGELOG.md") });
    const cliPkg = makePackage({
      name: "@myapp/cli",
      path: "packages/cli",
      changelogPath: join(cliDir, "CHANGELOG.md"),
      workspaceDeps: ["@myapp/core"],
    });
    const bump = makeBump();
    await applyReleaseChanges({
      cwd: tempDir,
      bumps: [bump],
      packages: [corePkg, cliPkg],
      isMonorepo: true,
    });

    const cliContent = JSON.parse(await readFile(join(cliDir, "package.json"), "utf-8"));
    // workspace:* is auto-resolving and should not be changed
    expect(cliContent.dependencies["@myapp/core"]).toBe("workspace:*");
  });

  it("handles multiple bumps", async () => {
    const coreDir = join(tempDir, "packages/core");
    const cliDir = join(tempDir, "packages/cli");
    await mkdir(coreDir, { recursive: true });
    await mkdir(cliDir, { recursive: true });
    await writeFile(
      join(coreDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await writeFile(
      join(cliDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/cli", version: "2.0.0" }, null, 2)}\n`,
    );
    await gitCommit(tempDir, "chore: init");

    const corePkg = makePackage({ changelogPath: join(coreDir, "CHANGELOG.md") });
    const cliPkg = makePackage({
      name: "@myapp/cli",
      path: "packages/cli",
      version: "2.0.0",
      changelogPath: join(cliDir, "CHANGELOG.md"),
    });
    const bumps = [
      makeBump(),
      makeBump({
        packagePath: "packages/cli",
        packageName: "@myapp/cli",
        currentVersion: "2.0.0",
        newVersion: "2.1.0",
      }),
    ];
    const results = await applyReleaseChanges({
      cwd: tempDir,
      bumps,
      packages: [corePkg, cliPkg],
      isMonorepo: true,
    });

    expect(results).toHaveLength(2);
    const coreContent = JSON.parse(await readFile(join(coreDir, "package.json"), "utf-8"));
    const cliContent = JSON.parse(await readFile(join(cliDir, "package.json"), "utf-8"));
    expect(coreContent.version).toBe("1.1.0");
    expect(cliContent.version).toBe("2.1.0");
  });

  it("returns empty array for empty bumps", async () => {
    const results = await applyReleaseChanges({
      cwd: tempDir,
      bumps: [],
      packages: [],
      isMonorepo: false,
    });
    expect(results).toEqual([]);
  });

  it("returns correct tag names", async () => {
    const pkgDir = join(tempDir, "packages/core");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
    );
    await gitCommit(tempDir, "chore: init");

    const pkg = makePackage({ changelogPath: join(pkgDir, "CHANGELOG.md") });
    const bump = makeBump();
    const results = await applyReleaseChanges({
      cwd: tempDir,
      bumps: [bump],
      packages: [pkg],
      isMonorepo: true,
    });

    expect(results[0].tagName).toBe("@myapp/core@1.1.0");
  });
});

describe("createReleaseTags", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-tags-"));
    await initGitRepo(tempDir);
    await writeFile(join(tempDir, "dummy.txt"), "init");
    await gitCommit(tempDir, "chore: init");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates git tags for each release result", async () => {
    const results = [
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.1.0",
        changelog: "",
        tagName: "@myapp/core@1.1.0",
      },
    ];
    await createReleaseTags(tempDir, results, false);

    const tags = (await execGit(["tag", "-l"], tempDir)).split("\n").filter(Boolean);
    expect(tags).toContain("@myapp/core@1.1.0");
  });

  it("creates multiple tags", async () => {
    const results = [
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.1.0",
        changelog: "",
        tagName: "@myapp/core@1.1.0",
      },
      {
        packageName: "@myapp/cli",
        packagePath: "packages/cli",
        version: "2.0.0",
        changelog: "",
        tagName: "@myapp/cli@2.0.0",
      },
    ];
    await createReleaseTags(tempDir, results, false);

    const tags = (await execGit(["tag", "-l"], tempDir)).split("\n").filter(Boolean);
    expect(tags).toContain("@myapp/core@1.1.0");
    expect(tags).toContain("@myapp/cli@2.0.0");
  });

  it("works with custom tag format", async () => {
    const results = [
      {
        packageName: "my-tool",
        packagePath: ".",
        version: "3.0.0",
        changelog: "",
        tagName: "v3.0.0",
      },
    ];
    await createReleaseTags(tempDir, results, false);

    const tags = (await execGit(["tag", "-l"], tempDir)).split("\n").filter(Boolean);
    expect(tags).toContain("v3.0.0");
  });
});

describe("detectPackageManager", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-detect-pm-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("detects bun from bun.lock", async () => {
    await writeFile(join(tempDir, "bun.lock"), "");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });

  it("detects bun from bun.lockb", async () => {
    await writeFile(join(tempDir, "bun.lockb"), "");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });

  it("detects pnpm from pnpm-lock.yaml", async () => {
    await writeFile(join(tempDir, "pnpm-lock.yaml"), "");
    expect(await detectPackageManager(tempDir)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    await writeFile(join(tempDir, "yarn.lock"), "");
    expect(await detectPackageManager(tempDir)).toBe("yarn");
  });

  it("detects npm from package-lock.json", async () => {
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(tempDir)).toBe("npm");
  });

  it("returns null when no lock file exists", async () => {
    expect(await detectPackageManager(tempDir)).toBeNull();
  });

  it("prioritizes bun.lockb over other lock files", async () => {
    await writeFile(join(tempDir, "bun.lockb"), "");
    await writeFile(join(tempDir, "package-lock.json"), "{}");
    expect(await detectPackageManager(tempDir)).toBe("bun");
  });
});

describe("updateLockFile", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-lockfile-"));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("skips when no lock file exists", async () => {
    // Should not throw
    await updateLockFile(tempDir);
  });

  it("runs bun install when bun.lock exists", async () => {
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }, null, 2),
    );
    await writeFile(join(tempDir, "bun.lock"), "");
    // bun install should succeed without throwing
    await updateLockFile(tempDir);
  });
});
