import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/loader";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "release-smith-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when no config file exists", async () => {
    const result = await loadConfig(tempDir);
    expect(result).toBeNull();
  });

  it("loads and parses release-smith.json", async () => {
    const config = {
      packages: {
        "packages/core": { publish: true },
        "packages/cli": { publish: false, changelog: "CHANGELOG.md" },
      },
    };
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify(config));

    const result = await loadConfig(tempDir);
    expect(result).not.toBeNull();
    expect(result?.packages?.["packages/core"]).toEqual({ publish: true });
    expect(result?.packages?.["packages/cli"]).toEqual({
      publish: false,
      changelog: "CHANGELOG.md",
    });
  });

  it("returns empty packages when packages field is missing", async () => {
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify({}));

    const result = await loadConfig(tempDir);
    expect(result).not.toBeNull();
    expect(result?.packages).toEqual({});
  });

  it("throws on invalid JSON", async () => {
    await writeFile(join(tempDir, "release-smith.json"), "{ invalid json }");

    await expect(loadConfig(tempDir)).rejects.toThrow();
  });

  it("loads branches config", async () => {
    const config = {
      branches: {
        next: { prerelease: "beta" },
        alpha: { prerelease: "alpha" },
      },
    };
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify(config));
    const result = await loadConfig(tempDir);
    expect(result?.branches?.next).toEqual({ prerelease: "beta" });
    expect(result?.branches?.alpha).toEqual({ prerelease: "alpha" });
  });

  it("loads tagFormat config", async () => {
    const config = { tagFormat: "release-{version}" };
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify(config));
    const result = await loadConfig(tempDir);
    expect(result?.tagFormat).toBe("release-{version}");
  });

  it("loads groups config", async () => {
    const config = {
      groups: {
        fixed: [["@myapp/core", "@myapp/cli"]],
        linked: [["@myapp/ui", "@myapp/theme"]],
      },
    };
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify(config));
    const result = await loadConfig(tempDir);
    expect(result?.groups?.fixed).toEqual([["@myapp/core", "@myapp/cli"]]);
    expect(result?.groups?.linked).toEqual([["@myapp/ui", "@myapp/theme"]]);
  });

  it("loads prLabels config", async () => {
    const config = { prLabels: ["release", "autorelease: pending"] };
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify(config));
    const result = await loadConfig(tempDir);
    expect(result?.prLabels).toEqual(["release", "autorelease: pending"]);
  });

  it("returns undefined for optional fields when not present", async () => {
    await writeFile(join(tempDir, "release-smith.json"), JSON.stringify({}));
    const result = await loadConfig(tempDir);
    expect(result?.branches).toBeUndefined();
    expect(result?.tagFormat).toBeUndefined();
    expect(result?.groups).toBeUndefined();
    expect(result?.prLabels).toBeUndefined();
  });
});
