import { describe, expect, it } from "bun:test";
import { formatTagName, resolveTagFormat, resolveTagPrefix } from "../src/tag-format";

describe("resolveTagFormat", () => {
  it("defaults to v{version} for single package", () => {
    expect(resolveTagFormat(undefined, false)).toBe("v{version}");
  });

  it("defaults to {name}@{version} for monorepo", () => {
    expect(resolveTagFormat(undefined, true)).toBe("{name}@{version}");
  });

  it("uses custom format when provided", () => {
    expect(resolveTagFormat("release-{version}", false)).toBe("release-{version}");
  });

  it("throws when tagFormat is missing {version} placeholder", () => {
    expect(() => resolveTagFormat("release", false)).toThrow(
      'tagFormat must include "{version}" placeholder',
    );
  });

  it("throws for empty string tagFormat", () => {
    expect(() => resolveTagFormat("", false)).toThrow(
      'tagFormat must include "{version}" placeholder',
    );
  });

  it("accepts format with only {version}", () => {
    expect(resolveTagFormat("{version}", false)).toBe("{version}");
  });

  it("accepts format with {name} but no monorepo flag", () => {
    // This is allowed for single-package repos
    expect(resolveTagFormat("{name}-{version}", false)).toBe("{name}-{version}");
  });

  it("throws when monorepo custom format is missing {name}", () => {
    expect(() => resolveTagFormat("v{version}", true)).toThrow(
      'tagFormat must contain "{name}" placeholder for monorepo projects',
    );
  });

  it("accepts monorepo format with {name} and {version}", () => {
    expect(resolveTagFormat("{name}@{version}", true)).toBe("{name}@{version}");
  });

  it("throws when {version} is not at the end of the format", () => {
    expect(() => resolveTagFormat("v{version}-{name}", false)).toThrow(
      'tagFormat must end with "{version}" placeholder',
    );
  });

  it("throws when {version} is followed by literal characters", () => {
    expect(() => resolveTagFormat("{version}-suffix", false)).toThrow(
      'tagFormat must end with "{version}" placeholder',
    );
  });

  it("accepts format ending with {version}", () => {
    expect(resolveTagFormat("prefix-{version}", false)).toBe("prefix-{version}");
  });
});

describe("formatTagName", () => {
  it("formats single package tag", () => {
    expect(formatTagName("v{version}", "my-pkg", "1.0.0")).toBe("v1.0.0");
  });

  it("formats monorepo tag", () => {
    expect(formatTagName("{name}@{version}", "@myapp/core", "2.1.0")).toBe("@myapp/core@2.1.0");
  });

  it("formats custom template", () => {
    expect(formatTagName("{name}-v{version}", "@myapp/core", "1.0.0")).toBe("@myapp/core-v1.0.0");
  });

  it("formats prerelease version", () => {
    expect(formatTagName("v{version}", "pkg", "1.0.0-beta.0")).toBe("v1.0.0-beta.0");
  });

  it("handles format without {name} placeholder", () => {
    expect(formatTagName("v{version}", "@myapp/core", "1.0.0")).toBe("v1.0.0");
  });

  it("handles format with multiple {version} occurrences", () => {
    expect(formatTagName("{version}-{version}", "pkg", "1.0.0")).toBe("1.0.0-1.0.0");
  });

  it("handles scoped package name with special characters", () => {
    expect(formatTagName("{name}@{version}", "@scope/pkg-name", "1.0.0")).toBe(
      "@scope/pkg-name@1.0.0",
    );
  });
});

describe("resolveTagPrefix", () => {
  it("resolves v prefix for single package", () => {
    expect(resolveTagPrefix("v{version}", "my-pkg")).toBe("v");
  });

  it("resolves scoped package prefix for monorepo", () => {
    expect(resolveTagPrefix("{name}@{version}", "@myapp/core")).toBe("@myapp/core@");
  });

  it("resolves custom prefix", () => {
    expect(resolveTagPrefix("release-{version}", "my-pkg")).toBe("release-");
  });

  it("resolves prefix with name in custom format", () => {
    expect(resolveTagPrefix("{name}-v{version}", "@myapp/core")).toBe("@myapp/core-v");
  });

  it("resolves empty prefix when format starts with {version}", () => {
    expect(resolveTagPrefix("{version}", "my-pkg")).toBe("");
  });
});
