import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@release-smith/git";

const CLI_ENTRY = join(import.meta.dir, "../src/index.ts");

async function runCli(args: string[], cwd: string) {
  const proc = Bun.spawn([process.execPath, CLI_ENTRY, ...args, `--cwd=${cwd}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

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
  packages: Array<{ name: string; path: string; deps?: Record<string, string> }>,
) {
  await createPackage(dir, {
    name: "test-monorepo",
    private: true,
    workspaces: ["packages/*"],
  });
  for (const pkg of packages) {
    await createPackage(join(dir, pkg.path), {
      name: pkg.name,
      version: "1.0.0",
      ...(pkg.deps ? { dependencies: pkg.deps } : {}),
    });
  }
  await initRepo(dir);
}

describe("json output", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-json-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("status --json", () => {
    it("emits a single JSON document with pending bumps", async () => {
      await setupMonorepo(tempDir, [
        { name: "@test/core", path: "packages/core" },
        { name: "@test/cli", path: "packages/cli", deps: { "@test/core": "workspace:*" } },
      ]);
      await tag(tempDir, "@test/core@1.0.0");
      await tag(tempDir, "@test/cli@1.0.0");
      await commit(tempDir, "feat(api): new feature", "packages/core/src/index.ts");

      const { stdout, exitCode } = await runCli(["status", "--json"], tempDir);
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.packages).toHaveLength(2);

      const core = result.packages.find((p: { name: string }) => p.name === "@test/core");
      expect(core).toEqual({
        name: "@test/core",
        path: "packages/core",
        currentVersion: "1.0.0",
        nextVersion: "1.1.0",
        bumpLevel: "minor",
        tagName: "@test/core@1.1.0",
        propagated: false,
        commits: [
          {
            hash: expect.stringMatching(/^[0-9a-f]{40}$/),
            type: "feat",
            scope: "api",
            description: "new feature",
            breaking: false,
          },
        ],
      });

      const cli = result.packages.find((p: { name: string }) => p.name === "@test/cli");
      expect(cli).toEqual({
        name: "@test/cli",
        path: "packages/cli",
        currentVersion: "1.0.0",
        nextVersion: "1.0.1",
        bumpLevel: "patch",
        tagName: "@test/cli@1.0.1",
        propagated: true,
        commits: [],
      });
    });

    it("emits empty packages array when nothing to release", async () => {
      await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
      await tag(tempDir, "@test/core@1.0.0");

      const { stdout, exitCode } = await runCli(["status", "--json"], tempDir);
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ packages: [] });
    });
  });

  describe("changelog --json", () => {
    it("emits a single JSON document with generated changelogs", async () => {
      await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
      await tag(tempDir, "@test/core@1.0.0");
      await commit(tempDir, "feat: new feature", "packages/core/src/index.ts");
      await commit(tempDir, "fix: a bug fix", "packages/core/src/index.ts");

      const { stdout, exitCode } = await runCli(["changelog", "--json"], tempDir);
      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.packages).toHaveLength(1);

      const pkg = result.packages[0];
      expect(pkg.name).toBe("@test/core");
      expect(pkg.version).toBe("1.1.0");
      expect(pkg.tagName).toBe("@test/core@1.1.0");
      expect(pkg.changelog).toContain("## [1.1.0]");
      expect(pkg.changelog).toContain("### Features");
      expect(pkg.changelog).toContain("new feature");
      expect(pkg.changelog).toContain("### Bug Fixes");
      expect(pkg.changelog).toContain("a bug fix");
    });

    it("emits empty packages array when nothing to release", async () => {
      await setupMonorepo(tempDir, [{ name: "@test/core", path: "packages/core" }]);
      await tag(tempDir, "@test/core@1.0.0");

      const { stdout, exitCode } = await runCli(["changelog", "--json"], tempDir);
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ packages: [] });
    });
  });
});
