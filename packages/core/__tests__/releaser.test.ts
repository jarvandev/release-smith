import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommitMessage, updatePackageVersion, updateWorkspaceDeps } from "../src/releaser";

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

  it("updates workspace dependency versions", async () => {
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
          dependencies: { "@myapp/core": "workspace:*", lodash: "^4.17.0" },
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
