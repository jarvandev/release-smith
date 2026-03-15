import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RawConfig } from "../src/types";
import { discoverPackages } from "../src/workspace";

async function createPackage(dir: string, pkg: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
}

describe("discoverPackages", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-smith-workspace-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("discovers packages from workspaces field", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/alpha"), {
      name: "@scope/alpha",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/beta"), {
      name: "@scope/beta",
      version: "2.0.0",
    });

    const result = await discoverPackages(tempDir, null);
    expect(result).toHaveLength(2);

    const names = result.map((p) => p.name).sort();
    expect(names).toEqual(["@scope/alpha", "@scope/beta"]);
  });

  it("treats private packages as publish: false by default", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/public-pkg"), {
      name: "@scope/public-pkg",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/private-pkg"), {
      name: "@scope/private-pkg",
      version: "1.0.0",
      private: true,
    });

    const result = await discoverPackages(tempDir, null);
    const publicPkg = result.find((p) => p.name === "@scope/public-pkg");
    const privatePkg = result.find((p) => p.name === "@scope/private-pkg");

    expect(publicPkg?.publish).toBe(true);
    expect(privatePkg?.publish).toBe(false);
  });

  it("applies config overrides (undeclared packages default to false)", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/alpha"), {
      name: "@scope/alpha",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/beta"), {
      name: "@scope/beta",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/gamma"), {
      name: "@scope/gamma",
      version: "1.0.0",
    });

    const config: RawConfig = {
      packages: {
        "packages/alpha": { publish: true },
        "packages/beta": { publish: false },
        // gamma is not declared -> defaults to false when config exists
      },
    };

    const result = await discoverPackages(tempDir, config);
    const alpha = result.find((p) => p.name === "@scope/alpha");
    const beta = result.find((p) => p.name === "@scope/beta");
    const gamma = result.find((p) => p.name === "@scope/gamma");

    expect(alpha?.publish).toBe(true);
    expect(beta?.publish).toBe(false);
    expect(gamma?.publish).toBe(false);
  });

  it("handles single-package project (no workspaces)", async () => {
    await createPackage(tempDir, {
      name: "my-app",
      version: "3.0.0",
    });

    const result = await discoverPackages(tempDir, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-app");
    expect(result[0].version).toBe("3.0.0");
    expect(result[0].path).toBe(".");
    expect(result[0].publish).toBe(true);
  });

  it("overrides package name from config", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/cli"), {
      name: "@scope/cli",
      version: "1.0.0",
    });

    const config: RawConfig = {
      packages: {
        "packages/cli": { publish: true, name: "cli-node" },
      },
    };

    const result = await discoverPackages(tempDir, config);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("cli-node");
  });

  it("uses package.json name when config name is not set", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });

    const config: RawConfig = {
      packages: {
        "packages/core": { publish: true },
      },
    };

    const result = await discoverPackages(tempDir, config);
    expect(result[0].name).toBe("@scope/core");
  });

  it("includes peerDependencies in workspaceDeps", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/core"), {
      name: "@scope/core",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/plugin"), {
      name: "@scope/plugin",
      version: "1.0.0",
      peerDependencies: {
        "@scope/core": "workspace:*",
        "some-external-lib": "^1.0.0",
      },
    });

    const result = await discoverPackages(tempDir, null);
    const plugin = result.find((p) => p.name === "@scope/plugin");

    expect(plugin?.workspaceDeps).toContain("@scope/core");
    expect(plugin?.workspaceDeps).not.toContain("some-external-lib");
  });

  it("excludes devDependencies from workspaceDeps", async () => {
    await createPackage(tempDir, {
      name: "my-monorepo",
      private: true,
      workspaces: ["packages/*"],
    });
    await createPackage(join(tempDir, "packages/utils"), {
      name: "@scope/utils",
      version: "1.0.0",
    });
    await createPackage(join(tempDir, "packages/app"), {
      name: "@scope/app",
      version: "1.0.0",
      dependencies: {
        "@scope/utils": "workspace:*",
      },
      devDependencies: {
        "@scope/utils": "workspace:*",
      },
    });

    const result = await discoverPackages(tempDir, null);
    const app = result.find((p) => p.name === "@scope/app");

    // Should appear exactly once (not duplicated from devDeps)
    expect(app?.workspaceDeps).toContain("@scope/utils");
    expect(app?.workspaceDeps.filter((d) => d === "@scope/utils")).toHaveLength(1);
  });
});
