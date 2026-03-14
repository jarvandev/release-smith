import type { ResolvedPackage } from "@release-smith/config";
import type { BumpLevel, ConventionalCommit, PackageCommit, VersionBump } from "./types";

const BUMP_ORDER: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };
const TYPE_TO_BUMP: Record<string, BumpLevel> = { fix: "patch", feat: "minor" };

export function bumpVersion(current: string, level: BumpLevel): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function calculateVersionBumps(
  packages: ResolvedPackage[],
  packageCommits: PackageCommit[],
): VersionBump[] {
  const packageByPath = new Map(packages.map((p) => [p.path, p]));
  const packageByName = new Map(packages.map((p) => [p.name, p]));

  const commitsByPath = new Map<string, ConventionalCommit[]>();
  for (const pc of packageCommits) {
    const existing = commitsByPath.get(pc.packagePath) ?? [];
    existing.push(pc.commit);
    commitsByPath.set(pc.packagePath, existing);
  }

  const directBumps = new Map<string, { level: BumpLevel; commits: ConventionalCommit[] }>();
  for (const [path, commits] of commitsByPath) {
    const level = getHighestBump(commits);
    if (level) directBumps.set(path, { level, commits });
  }

  const reverseDeps = new Map<string, string[]>();
  for (const pkg of packages) {
    for (const dep of pkg.workspaceDeps) {
      const existing = reverseDeps.get(dep) ?? [];
      existing.push(pkg.name);
      reverseDeps.set(dep, existing);
    }
  }

  const propagatedPaths = new Set<string>();
  const visited = new Set<string>();
  function propagate(pkgName: string) {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);
    for (const depName of reverseDeps.get(pkgName) ?? []) {
      const depPkg = packageByName.get(depName);
      if (!depPkg) continue;
      propagatedPaths.add(depPkg.path);
      propagate(depName);
    }
  }
  for (const [path] of directBumps) {
    const pkg = packageByPath.get(path);
    if (pkg) propagate(pkg.name);
  }

  const results: VersionBump[] = [];
  for (const pkg of packages) {
    if (!pkg.publish) continue;
    const direct = directBumps.get(pkg.path);
    const isPropagated = propagatedPaths.has(pkg.path);
    if (!direct && !isPropagated) continue;

    let level: BumpLevel;
    let isResultPropagated: boolean;
    let commits: ConventionalCommit[];
    if (direct) {
      level = direct.level;
      isResultPropagated = false;
      commits = direct.commits;
    } else {
      level = "patch";
      isResultPropagated = true;
      commits = [];
    }

    results.push({
      packagePath: pkg.path,
      packageName: pkg.name,
      currentVersion: pkg.version,
      newVersion: bumpVersion(pkg.version, level),
      level,
      commits,
      propagated: isResultPropagated,
    });
  }
  return results;
}

function getHighestBump(commits: ConventionalCommit[]): BumpLevel | null {
  let highest: BumpLevel | null = null;
  for (const commit of commits) {
    if (commit.breaking) return "major";
    const level = TYPE_TO_BUMP[commit.type];
    if (!level) continue;
    if (!highest || BUMP_ORDER[level] > BUMP_ORDER[highest]) highest = level;
  }
  return highest;
}

export function detectCircularDeps(packages: ResolvedPackage[]): string[] | null {
  const packageByName = new Map(packages.map((p) => [p.name, p]));
  enum State {
    Unvisited,
    Visiting,
    Visited,
  }
  const state = new Map<string, State>();
  const parent = new Map<string, string>();
  for (const pkg of packages) state.set(pkg.name, State.Unvisited);

  function dfs(name: string): string[] | null {
    state.set(name, State.Visiting);
    const pkg = packageByName.get(name);
    if (!pkg) return null;
    for (const dep of pkg.workspaceDeps) {
      const depState = state.get(dep);
      if (depState === State.Visiting) {
        const cycle = [dep, name];
        let current = name;
        while (parent.has(current) && parent.get(current) !== dep) {
          current = parent.get(current)!;
          cycle.push(current);
        }
        return cycle.reverse();
      }
      if (depState === State.Unvisited) {
        parent.set(dep, name);
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
    }
    state.set(name, State.Visited);
    return null;
  }

  for (const pkg of packages) {
    if (state.get(pkg.name) === State.Unvisited) {
      const cycle = dfs(pkg.name);
      if (cycle) return cycle;
    }
  }
  return null;
}
