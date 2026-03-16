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
