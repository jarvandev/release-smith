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
});
