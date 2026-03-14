import { describe, expect, it } from "bun:test";
import { buildPRBody, parseReleaseMetadata } from "../src/commands/release-pr";

describe("parseReleaseMetadata", () => {
  it("extracts metadata from PR body", () => {
    const metadata = [
      {
        packageName: "release-smith",
        packagePath: "packages/cli",
        version: "0.3.0",
        tagName: "v0.3.0",
        changelog: "## 0.3.0\n- feat: new",
      },
    ];
    const body = `## Release Summary\nsome text\n<!-- release-smith:metadata\n${JSON.stringify(metadata)}\n-->`;
    const result = parseReleaseMetadata(body);
    expect(result).toEqual(metadata);
  });

  it("returns null when no metadata found", () => {
    expect(parseReleaseMetadata("just a normal PR body")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const body = "<!-- release-smith:metadata\n{invalid json}\n-->";
    expect(parseReleaseMetadata(body)).toBeNull();
  });

  it("returns null for invalid structure (missing required fields)", () => {
    const body = `<!-- release-smith:metadata\n${JSON.stringify([{ foo: "bar" }])}\n-->`;
    expect(parseReleaseMetadata(body)).toBeNull();
  });

  it("returns null for non-array JSON", () => {
    const body = `<!-- release-smith:metadata\n${JSON.stringify({ packageName: "x" })}\n-->`;
    expect(parseReleaseMetadata(body)).toBeNull();
  });

  it("handles multiple packages", () => {
    const metadata = [
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.0.0",
        tagName: "@myapp/core@1.0.0",
        changelog: "log1",
      },
      {
        packageName: "@myapp/cli",
        packagePath: "packages/cli",
        version: "2.0.0",
        tagName: "@myapp/cli@2.0.0",
        changelog: "log2",
      },
    ];
    const body = `text\n<!-- release-smith:metadata\n${JSON.stringify(metadata)}\n-->`;
    const result = parseReleaseMetadata(body);
    expect(result).toHaveLength(2);
    expect(result?.[0].packageName).toBe("@myapp/core");
    expect(result?.[1].packageName).toBe("@myapp/cli");
  });
});

describe("buildPRBody + parseReleaseMetadata roundtrip", () => {
  it("metadata survives build -> parse roundtrip", () => {
    const results = [
      {
        packageName: "@myapp/core",
        packagePath: "packages/core",
        version: "1.2.0",
        changelog: "## 1.2.0\n\n### Features\n\n- add new API",
        tagName: "@myapp/core@1.2.0",
      },
      {
        packageName: "@myapp/cli",
        packagePath: "packages/cli",
        version: "2.0.0",
        changelog: "## 2.0.0\n\n### Breaking Changes\n\n- rename command",
        tagName: "@myapp/cli@2.0.0",
      },
    ];

    const body = buildPRBody(results);
    const parsed = parseReleaseMetadata(body);

    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(2);
    for (let i = 0; i < results.length; i++) {
      expect(parsed![i].packageName).toBe(results[i].packageName);
      expect(parsed![i].packagePath).toBe(results[i].packagePath);
      expect(parsed![i].version).toBe(results[i].version);
      expect(parsed![i].tagName).toBe(results[i].tagName);
      expect(parsed![i].changelog).toBe(results[i].changelog);
    }
  });

  it("body contains summary table", () => {
    const results = [
      {
        packageName: "my-pkg",
        packagePath: ".",
        version: "1.0.0",
        changelog: "changes",
        tagName: "v1.0.0",
      },
    ];
    const body = buildPRBody(results);
    expect(body).toContain("## Release Summary");
    expect(body).toContain("| my-pkg | 1.0.0 | `v1.0.0` |");
  });
});
