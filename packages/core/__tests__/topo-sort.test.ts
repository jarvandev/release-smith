import { describe, expect, it } from "bun:test";
import type { ResolvedPackage } from "@release-smith/config";
import { topologicalSort } from "../src/topo-sort";

function makePackage(overrides: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return {
    name: "@myapp/core",
    path: "packages/core",
    publish: true,
    changelogPath: "/tmp/CHANGELOG.md",
    version: "1.0.0",
    isPrivate: false,
    workspaceDeps: [],
    ignoreFiles: [],
    ...overrides,
  };
}

describe("topologicalSort", () => {
  it("returns single package unchanged", () => {
    const packages = [makePackage({ name: "a", path: "a" })];
    const sorted = topologicalSort(packages);
    expect(sorted.map((p) => p.name)).toEqual(["a"]);
  });

  it("sorts linear chain so deps come first", () => {
    const packages = [
      makePackage({ name: "c", path: "c", workspaceDeps: ["b"] }),
      makePackage({ name: "a", path: "a" }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ];
    const sorted = topologicalSort(packages);
    const names = sorted.map((p) => p.name);
    expect(names.indexOf("a")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("c"));
  });

  it("sorts diamond dependencies correctly", () => {
    //   d
    //  / \
    // b   c
    //  \ /
    //   a
    const packages = [
      makePackage({ name: "a", path: "a", workspaceDeps: ["b", "c"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["d"] }),
      makePackage({ name: "c", path: "c", workspaceDeps: ["d"] }),
      makePackage({ name: "d", path: "d" }),
    ];
    const sorted = topologicalSort(packages);
    const names = sorted.map((p) => p.name);
    // d must come before b and c
    expect(names.indexOf("d")).toBeLessThan(names.indexOf("b"));
    expect(names.indexOf("d")).toBeLessThan(names.indexOf("c"));
    // b and c must come before a
    expect(names.indexOf("b")).toBeLessThan(names.indexOf("a"));
    expect(names.indexOf("c")).toBeLessThan(names.indexOf("a"));
  });

  it("handles independent packages", () => {
    const packages = [
      makePackage({ name: "x", path: "x" }),
      makePackage({ name: "y", path: "y" }),
      makePackage({ name: "z", path: "z" }),
    ];
    const sorted = topologicalSort(packages);
    expect(sorted).toHaveLength(3);
    // All packages should be present
    expect(sorted.map((p) => p.name).sort()).toEqual(["x", "y", "z"]);
  });

  it("handles mixed connected and disconnected packages", () => {
    const packages = [
      makePackage({ name: "standalone", path: "standalone" }),
      makePackage({ name: "child", path: "child", workspaceDeps: ["parent"] }),
      makePackage({ name: "parent", path: "parent" }),
    ];
    const sorted = topologicalSort(packages);
    const names = sorted.map((p) => p.name);
    expect(names.indexOf("parent")).toBeLessThan(names.indexOf("child"));
    expect(sorted).toHaveLength(3);
  });

  it("handles empty input", () => {
    expect(topologicalSort([])).toEqual([]);
  });

  it("handles circular deps without infinite loop", () => {
    const packages = [
      makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ];
    // Should not throw or loop forever
    const sorted = topologicalSort(packages);
    expect(sorted).toHaveLength(2);
  });
});
