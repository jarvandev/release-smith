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
});
