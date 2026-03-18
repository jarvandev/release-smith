import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@release-smith/git";
import { createConfig, updateConfig } from "../src/commands/init";

async function createPackage(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

async function initGitRepo(dir: string): Promise<string> {
  await execGit(["init"], dir);
  await execGit(["config", "user.email", "test@test.com"], dir);
  await execGit(["config", "user.name", "Test"], dir);
  await execGit(["add", "."], dir);
  await execGit(["commit", "-m", "init"], dir);
  return (await execGit(["rev-parse", "HEAD"], dir)).trim();
}

async function readConfig(dir: string): Promise<Record<string, any>> {
  const text = await readFile(join(dir, "release-smith.json"), "utf-8");
  return JSON.parse(text);
}

describe("init: createConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-smith-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates config for monorepo with publish based on private field", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/app"), {
      name: "@scope/app",
      version: "1.0.0",
      private: true,
    });
    const headCommit = await initGitRepo(tempDir);

    await createConfig(tempDir, join(tempDir, "release-smith.json"));

    const config = await readConfig(tempDir);
    expect(config.packages["packages/core"]).toEqual({
      publish: true,
      from: headCommit,
    });
    expect(config.packages["packages/app"]).toEqual({
      publish: false,
      from: headCommit,
    });
  });

  it("creates empty config for single-package project", async () => {
    await createPackage(tempDir, { name: "my-app", version: "1.0.0" });
    await initGitRepo(tempDir);

    await createConfig(tempDir, join(tempDir, "release-smith.json"));

    const config = await readConfig(tempDir);
    expect(config).toEqual({});
  });

  it("writes file with trailing newline", async () => {
    await createPackage(tempDir, { name: "my-app", version: "1.0.0" });
    await initGitRepo(tempDir);

    await createConfig(tempDir, join(tempDir, "release-smith.json"));

    const text = await readFile(join(tempDir, "release-smith.json"), "utf-8");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("init: updateConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-smith-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("adds new packages to existing config", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    const commit1 = await initGitRepo(tempDir);

    // Write initial config with only core
    const configPath = join(tempDir, "release-smith.json");
    await writeFile(
      configPath,
      JSON.stringify({
        packages: {
          "packages/core": { publish: true, from: commit1 },
        },
      }),
    );

    // Add a new package and commit
    await createPackage(join(tempDir, "packages/cli"), {
      name: "@scope/cli",
      version: "1.0.0",
    });
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "add cli"], tempDir);
    const commit2 = (await execGit(["rev-parse", "HEAD"], tempDir)).trim();

    await updateConfig(tempDir, configPath);

    const config = await readConfig(tempDir);
    // Existing entry preserved
    expect(config.packages["packages/core"]).toEqual({
      publish: true,
      from: commit1,
    });
    // New entry added with current HEAD
    expect(config.packages["packages/cli"]).toEqual({
      publish: true,
      from: commit2,
    });
  });

  it("preserves other config fields", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    await initGitRepo(tempDir);

    const configPath = join(tempDir, "release-smith.json");
    await writeFile(
      configPath,
      JSON.stringify({
        tagFormat: "{name}@{version}",
        branches: { next: { prerelease: "beta" } },
        prLabels: ["release"],
        packages: {},
      }),
    );

    // Add core as a "new" package (not in packages config)
    await updateConfig(tempDir, configPath);

    const config = await readConfig(tempDir);
    expect(config.tagFormat).toBe("{name}@{version}");
    expect(config.branches).toEqual({ next: { prerelease: "beta" } });
    expect(config.prLabels).toEqual(["release"]);
    expect(config.packages["packages/core"]).toBeDefined();
  });

  it("does nothing when all packages are already configured", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    const headCommit = await initGitRepo(tempDir);

    const configPath = join(tempDir, "release-smith.json");
    const originalConfig = {
      packages: {
        "packages/core": { publish: true, from: headCommit },
      },
    };
    await writeFile(configPath, JSON.stringify(originalConfig));

    await updateConfig(tempDir, configPath);

    const config = await readConfig(tempDir);
    expect(config).toEqual(originalConfig);
  });

  it("sets publish: false for private new packages", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    await initGitRepo(tempDir);

    const configPath = join(tempDir, "release-smith.json");
    await writeFile(configPath, JSON.stringify({ packages: {} }));

    // Add a private package
    await createPackage(join(tempDir, "packages/internal"), {
      name: "@scope/internal",
      version: "0.0.0",
      private: true,
    });
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "add internal"], tempDir);

    await updateConfig(tempDir, configPath);

    const config = await readConfig(tempDir);
    expect(config.packages["packages/internal"].publish).toBe(false);
  });

  it("does nothing for single-package project", async () => {
    await createPackage(tempDir, { name: "my-app", version: "1.0.0" });
    await initGitRepo(tempDir);

    const configPath = join(tempDir, "release-smith.json");
    const originalConfig = { tagFormat: "v{version}" };
    await writeFile(configPath, JSON.stringify(originalConfig));

    await updateConfig(tempDir, configPath);

    // Config unchanged
    const config = await readConfig(tempDir);
    expect(config).toEqual(originalConfig);
  });

  it("initializes packages field when config has none", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    await initGitRepo(tempDir);

    const configPath = join(tempDir, "release-smith.json");
    await writeFile(configPath, JSON.stringify({ tagFormat: "{name}@{version}" }));

    await updateConfig(tempDir, configPath);

    const config = await readConfig(tempDir);
    expect(config.packages["packages/core"]).toBeDefined();
    expect(config.packages["packages/core"].publish).toBe(true);
  });
});
