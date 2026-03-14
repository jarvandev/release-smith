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
    expect(stdout).toContain("1.0.1");
  });
});
