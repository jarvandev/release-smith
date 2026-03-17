import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

async function initRepo(dir: string) {
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@test.com");
  await git(dir, "config", "user.name", "Test");
}

async function commit(dir: string, message: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", message);
}

// IMPORTANT: Use import.meta.dir instead of __dirname for Bun
const CLI_PATH = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("Single-package release flow", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("performs a complete release cycle", async () => {
    await commit(tempDir, "chore: init", {
      "package.json": `${JSON.stringify({ name: "my-tool", version: "1.0.0" }, null, 2)}\n`,
      "src/index.ts": "export const version = '1.0.0';",
    });
    await commit(tempDir, "feat: add new feature", {
      "src/feature.ts": "export function newFeature() { return true; }",
    });
    await commit(tempDir, "fix: handle edge case", {
      "src/index.ts": "export const version = '1.0.0';\nexport function main() {}",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "release", "--dry-run", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-tool");
    expect(stdout).toContain("1.0.0");
    expect(stdout).toContain("1.1.0");
  });
});

describe("ignoreFiles filtering", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-ignore-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("filters commits that only touch ignored files", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/lib/package.json": `${JSON.stringify({ name: "@myapp/lib", version: "1.0.0" }, null, 2)}\n`,
      "packages/lib/src/index.ts": "export const v = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          ignoreFiles: ["**/__tests__/**", "**/*.md"],
          packages: { "packages/lib": {} },
        },
        null,
        2,
      )}\n`,
    });

    // This commit touches src + tests -> should trigger bump (src not ignored)
    await commit(tempDir, "feat: add feature with tests", {
      "packages/lib/src/feature.ts": "export function feature() {}",
      "packages/lib/__tests__/feature.test.ts": "test('feature', () => {});",
    });

    // This commit touches only tests -> should be filtered
    await commit(tempDir, "feat: add more tests", {
      "packages/lib/__tests__/util.test.ts": "test('util', () => {});",
    });

    // This commit touches only docs -> should be filtered
    await commit(tempDir, "feat: update docs", {
      "packages/lib/README.md": "# Lib",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/lib");
    // Only the first feat commit should count -> minor bump
    expect(stdout).toContain("1.1.0");
    // The test-only and doc-only feat commits should be filtered
    expect(stdout).not.toContain("add more tests");
    expect(stdout).not.toContain("update docs");
  });
});

describe("Rollup with ignoreFiles", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-rollup-ignore-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("filters ignored commits from unpublished deps during rollup", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/core/package.json": `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
      "packages/core/src/index.ts": "export const v = 1;",
      "packages/cli/package.json": `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/cli/src/index.ts": "import '@myapp/core';",
      "release-smith.json": `${JSON.stringify(
        {
          ignoreFiles: ["**/__tests__/**"],
          packages: {
            "packages/core": { publish: false },
            "packages/cli": { publish: true },
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat commit in core's src -> should roll up to cli
    await commit(tempDir, "feat: add core utility", {
      "packages/core/src/util.ts": "export function util() { return 42; }",
    });

    // fix commit in core's tests only -> should be filtered by ignoreFiles
    await commit(tempDir, "fix: correct test assertion", {
      "packages/core/__tests__/util.test.ts": "test('util', () => { expect(42).toBe(42); });",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/cli");
    // The feat from core rolls up -> minor bump
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("add core utility");
    // The fix touching only tests should be filtered
    expect(stdout).not.toContain("correct test assertion");
  });
});

describe("Prerelease multi-package", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-prerelease-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("calculates prerelease versions with dependency propagation", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/core/package.json": `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
      "packages/core/src/index.ts": "export const v = 1;",
      "packages/cli/package.json": `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/cli/src/index.ts": "import '@myapp/core';",
      "packages/ui/package.json": `${JSON.stringify({ name: "@myapp/ui", version: "1.0.0" }, null, 2)}\n`,
      "packages/ui/src/index.ts": "export const ui = true;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/core": {},
            "packages/cli": {},
            "packages/ui": {},
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat in core
    await commit(tempDir, "feat: new core API", {
      "packages/core/src/api.ts": "export function api() {}",
    });

    // fix in ui (unrelated)
    await commit(tempDir, "fix: ui alignment", {
      "packages/ui/src/index.ts": "export const ui = true; // fixed",
    });

    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "release", "--dry-run", "--prerelease", "beta", "--cwd", tempDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    // core: feat -> 1.1.0-beta.0
    expect(stdout).toContain("@myapp/core");
    expect(stdout).toContain("1.1.0-beta.0");
    // cli: propagated from core -> 1.0.1-beta.0
    expect(stdout).toContain("@myapp/cli");
    expect(stdout).toContain("beta");
    // ui: fix -> 1.0.1-beta.0
    expect(stdout).toContain("@myapp/ui");
    expect(stdout).toContain("1.0.1-beta.0");
  });
});

describe("Monorepo release flow", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-mono-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("releases monorepo with dependency propagation", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/core/package.json": `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
      "packages/core/src/index.ts": "export const version = '1.0.0';",
      "packages/cli/package.json": `${JSON.stringify(
        { name: "@myapp/cli", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/cli/src/index.ts": "import { version } from '@myapp/core';",
      "release-smith.json": `${JSON.stringify(
        { packages: { "packages/core": { publish: false }, "packages/cli": { publish: true } } },
        null,
        2,
      )}\n`,
    });

    await commit(tempDir, "feat: add core utility", {
      "packages/core/src/util.ts": "export function util() { return 42; }",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/cli");
    expect(stdout).toContain("1.0.0");
    // feat from unpublished core is rolled up into cli -> minor bump
    expect(stdout).toContain("1.1.0");
  });
});

describe("Deep dependency chain (3+ levels)", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-deep-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("rolls up through 3-level unpublished chain to published consumer", async () => {
    // utils(unpub) -> core(unpub) -> lib(unpub) -> app(pub)
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/utils/package.json": `${JSON.stringify({ name: "@myapp/utils", version: "1.0.0" }, null, 2)}\n`,
      "packages/utils/src/index.ts": "export const u = 1;",
      "packages/core/package.json": `${JSON.stringify(
        { name: "@myapp/core", version: "1.0.0", dependencies: { "@myapp/utils": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/core/src/index.ts": "export const c = 1;",
      "packages/lib/package.json": `${JSON.stringify(
        { name: "@myapp/lib", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/lib/src/index.ts": "export const l = 1;",
      "packages/app/package.json": `${JSON.stringify(
        { name: "@myapp/app", version: "1.0.0", dependencies: { "@myapp/lib": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/app/src/index.ts": "export const a = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/utils": { publish: false },
            "packages/core": { publish: false },
            "packages/lib": { publish: false },
            "packages/app": { publish: true },
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat at the deepest level
    await commit(tempDir, "feat: add deep utility", {
      "packages/utils/src/helper.ts": "export function helper() { return 42; }",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/app");
    // feat from utils rolls up through core -> lib -> app
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("add deep utility");
  });

  it("propagates through 3-level published chain", async () => {
    // lib(pub) -> core(pub) -> app(pub)
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/lib/package.json": `${JSON.stringify({ name: "@myapp/lib", version: "1.0.0" }, null, 2)}\n`,
      "packages/lib/src/index.ts": "export const l = 1;",
      "packages/core/package.json": `${JSON.stringify(
        { name: "@myapp/core", version: "1.0.0", dependencies: { "@myapp/lib": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/core/src/index.ts": "export const c = 1;",
      "packages/app/package.json": `${JSON.stringify(
        { name: "@myapp/app", version: "1.0.0", dependencies: { "@myapp/core": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/app/src/index.ts": "export const a = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/lib": {},
            "packages/core": {},
            "packages/app": {},
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat at the bottom
    await commit(tempDir, "feat: lib feature", {
      "packages/lib/src/feature.ts": "export function feature() {}",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    // lib gets minor, core and app get propagated patch
    expect(stdout).toContain("@myapp/lib");
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("@myapp/core");
    expect(stdout).toContain("@myapp/app");
    expect(stdout).toContain("1.0.1");
  });
});

describe("Diamond dependency", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-diamond-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("handles diamond with unpublished deps rolling up to single consumer", async () => {
    //     shared (unpub)
    //      / \
    //   api  web  (both unpub)
    //      \ /
    //      app (pub)
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/shared/package.json": `${JSON.stringify({ name: "@myapp/shared", version: "1.0.0" }, null, 2)}\n`,
      "packages/shared/src/index.ts": "export const s = 1;",
      "packages/api/package.json": `${JSON.stringify(
        { name: "@myapp/api", version: "1.0.0", dependencies: { "@myapp/shared": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/api/src/index.ts": "export const api = 1;",
      "packages/web/package.json": `${JSON.stringify(
        { name: "@myapp/web", version: "1.0.0", dependencies: { "@myapp/shared": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/web/src/index.ts": "export const web = 1;",
      "packages/app/package.json": `${JSON.stringify(
        {
          name: "@myapp/app",
          version: "1.0.0",
          dependencies: { "@myapp/api": "workspace:*", "@myapp/web": "workspace:*" },
        },
        null,
        2,
      )}\n`,
      "packages/app/src/index.ts": "export const app = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/shared": { publish: false },
            "packages/api": { publish: false },
            "packages/web": { publish: false },
            "packages/app": { publish: true },
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat at the top of the diamond
    await commit(tempDir, "feat: shared utility", {
      "packages/shared/src/util.ts": "export function sharedUtil() {}",
    });

    // fix in one branch
    await commit(tempDir, "fix: api fix", {
      "packages/api/src/index.ts": "export const api = 2;",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/app");
    // feat from shared + fix from api roll up to app -> minor (feat wins)
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("shared utility");
    expect(stdout).toContain("api fix");
  });

  it("handles diamond with mixed published/unpublished deps", async () => {
    //     shared (unpub, feat)
    //      / \
    //   api  web  (both pub)
    //      \ /
    //      app (pub)
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/shared/package.json": `${JSON.stringify({ name: "@myapp/shared", version: "1.0.0" }, null, 2)}\n`,
      "packages/shared/src/index.ts": "export const s = 1;",
      "packages/api/package.json": `${JSON.stringify(
        { name: "@myapp/api", version: "1.0.0", dependencies: { "@myapp/shared": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/api/src/index.ts": "export const api = 1;",
      "packages/web/package.json": `${JSON.stringify(
        { name: "@myapp/web", version: "1.0.0", dependencies: { "@myapp/shared": "workspace:*" } },
        null,
        2,
      )}\n`,
      "packages/web/src/index.ts": "export const web = 1;",
      "packages/app/package.json": `${JSON.stringify(
        {
          name: "@myapp/app",
          version: "1.0.0",
          dependencies: { "@myapp/api": "workspace:*", "@myapp/web": "workspace:*" },
        },
        null,
        2,
      )}\n`,
      "packages/app/src/index.ts": "export const app = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/shared": { publish: false },
            "packages/api": {},
            "packages/web": {},
            "packages/app": {},
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat at shared (unpub)
    await commit(tempDir, "feat: shared feature", {
      "packages/shared/src/util.ts": "export function sharedUtil() {}",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    // shared's feat rolls up to api and web (both pub) -> minor
    expect(stdout).toContain("@myapp/api");
    expect(stdout).toContain("@myapp/web");
    expect(stdout).toContain("1.1.0");
    // app is propagated from api and web -> patch
    expect(stdout).toContain("@myapp/app");
    expect(stdout).toContain("1.0.1");
  });
});

describe("Second release cycle (incremental)", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-incremental-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("bumps from tagged version after first release", async () => {
    // First release cycle
    await commit(tempDir, "chore: init", {
      "package.json": `${JSON.stringify({ name: "my-tool", version: "1.0.0" }, null, 2)}\n`,
      "src/index.ts": "export const v = 1;",
    });
    await commit(tempDir, "feat: first feature", {
      "src/feature.ts": "export function f1() {}",
    });

    // Simulate first release: bump version and tag
    await commit(tempDir, "chore(release): my-tool@1.1.0", {
      "package.json": `${JSON.stringify({ name: "my-tool", version: "1.1.0" }, null, 2)}\n`,
    });
    await git(tempDir, "tag", "v1.1.0");

    // Ensure the next commit has a later timestamp (epoch seconds)
    await Bun.sleep(1100);

    // Second release cycle: new commits after the tag
    await commit(tempDir, "fix: second fix", {
      "src/index.ts": "export const v = 2;",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-tool");
    // Should bump from 1.1.0 (tagged) to 1.1.1 (patch for fix)
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("1.1.1");
    // First feature should NOT appear (it's before the tag)
    expect(stdout).not.toContain("first feature");
    expect(stdout).toContain("second fix");
  });
});

describe("Breaking change E2E", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-breaking-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("produces major bump for breaking change via !", async () => {
    await commit(tempDir, "chore: init", {
      "package.json": `${JSON.stringify({ name: "my-lib", version: "1.2.3" }, null, 2)}\n`,
      "src/index.ts": "export const api = 1;",
    });
    await commit(tempDir, "feat!: remove old API", {
      "src/index.ts": "export const api = 2;",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-lib");
    expect(stdout).toContain("2.0.0");
  });

  it("detects BREAKING CHANGE in commit body", async () => {
    await commit(tempDir, "chore: init", {
      "package.json": `${JSON.stringify({ name: "my-lib", version: "1.0.0" }, null, 2)}\n`,
      "src/index.ts": "export const v = 1;",
    });

    // Commit with BREAKING CHANGE footer
    const fullPath = join(tempDir, "src/index.ts");
    await writeFile(fullPath, "export const v = 2;");
    await git(tempDir, "add", "-A");
    await git(tempDir, "commit", "-m", "feat: new API\n\nBREAKING CHANGE: old API removed");

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("2.0.0");
  });
});

describe("No bumps scenario", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-nobump-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("produces no bumps for chore-only commits", async () => {
    await commit(tempDir, "chore: init", {
      "package.json": `${JSON.stringify({ name: "my-tool", version: "1.0.0" }, null, 2)}\n`,
      "src/index.ts": "export const v = 1;",
    });
    await commit(tempDir, "chore: update deps", {
      "src/deps.ts": "// updated",
    });
    await commit(tempDir, "test: add tests", {
      "src/test.ts": "// tests",
    });
    await commit(tempDir, "docs: update readme", {
      "README.md": "# Docs",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "release", "--dry-run", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    // Should succeed but indicate no releases needed
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No packages to release");
  });
});

describe("extraDeps propagation", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-extradeps-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("propagates through extraDeps when no package.json dependency exists", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      // core has NO dependency on shared in package.json
      "packages/shared/package.json": `${JSON.stringify({ name: "@myapp/shared", version: "1.0.0" }, null, 2)}\n`,
      "packages/shared/src/index.ts": "export const s = 1;",
      "packages/core/package.json": `${JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2)}\n`,
      "packages/core/src/index.ts": "export const c = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/shared": { publish: false },
            "packages/core": {
              publish: true,
              extraDeps: ["@myapp/shared"],
            },
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat in shared -> should roll up to core via extraDeps
    await commit(tempDir, "feat: shared utility", {
      "packages/shared/src/util.ts": "export function util() {}",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/core");
    expect(stdout).toContain("1.1.0"); // feat from shared rolls up
    expect(stdout).toContain("shared utility");
  });
});

describe("Version groups (fixed) integration", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-groups-"));
    await initRepo(tempDir);
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("aligns fixed group packages to the same version", async () => {
    await commit(tempDir, "chore: init monorepo", {
      "package.json": `${JSON.stringify(
        { name: "my-monorepo", private: true, workspaces: ["packages/*"] },
        null,
        2,
      )}\n`,
      "packages/ui/package.json": `${JSON.stringify({ name: "@myapp/ui", version: "1.0.0" }, null, 2)}\n`,
      "packages/ui/src/index.ts": "export const ui = 1;",
      "packages/theme/package.json": `${JSON.stringify({ name: "@myapp/theme", version: "1.0.0" }, null, 2)}\n`,
      "packages/theme/src/index.ts": "export const theme = 1;",
      "release-smith.json": `${JSON.stringify(
        {
          packages: {
            "packages/ui": {},
            "packages/theme": {},
          },
          groups: {
            fixed: [["@myapp/ui", "@myapp/theme"]],
          },
        },
        null,
        2,
      )}\n`,
    });

    // feat only in ui
    await commit(tempDir, "feat: new ui component", {
      "packages/ui/src/button.ts": "export function Button() {}",
    });

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "status", "--cwd", tempDir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    // Both should be bumped to the same version
    expect(stdout).toContain("@myapp/ui");
    expect(stdout).toContain("@myapp/theme");
    // Both at 1.1.0 (ui's minor bump aligns theme)
    expect(stdout).toContain("1.1.0");
  });
});
