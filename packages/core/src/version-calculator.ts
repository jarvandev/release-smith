import type { ResolvedPackage, VersionGroups } from "@release-smith/config";
import semver from "semver";
import type { BumpLevel, ConventionalCommit, VersionBump } from "./types";

const BUMP_ORDER: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };
const TYPE_TO_BUMP: Record<string, BumpLevel> = { fix: "patch", feat: "minor" };

export interface PrereleaseOptions {
  /** Pre-release identifier, e.g., "beta", "alpha", "rc". */
  preid: string;
  /** Map of packagePath -> last stable version (from the latest stable tag). */
  lastStableVersions: Map<string, string>;
}

/**
 * Continue a `<base>-<preid>.<n>` sequence by incrementing the trailing
 * number. String prefix matching handles preids that semver parses into
 * multiple or numeric identifiers (e.g. "beta.x", "1"), which
 * `semver.inc(..., "prerelease", preid)` cannot round-trip.
 */
function continuePrereleaseSequence(current: string, base: string, preid: string): string | null {
  const prefix = `${base}-${preid}.`;
  if (!current.startsWith(prefix)) return null;
  const sequence = current.slice(prefix.length);
  if (!/^\d+$/.test(sequence)) return null;
  return `${prefix}${Number(sequence) + 1}`;
}

export function bumpVersion(current: string, level: BumpLevel): string {
  const result = semver.inc(current, level);
  if (!result) {
    throw new Error(`Failed to bump version "${current}" by "${level}"`);
  }
  return result;
}

/**
 * Calculate the next pre-release version.
 *
 * Uses ALL commits since the last STABLE tag to determine the target
 * stable version, then either increments the pre-release number (if
 * already heading towards that target) or starts a new pre-release
 * sequence.
 */
export function bumpPrerelease(
  current: string,
  lastStableVersion: string | null,
  level: BumpLevel,
  preid: string,
): string {
  const parsed = semver.parse(current);
  const currentBase = parsed ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : current;

  // No stable tag exists: the true last stable version is unknown, so an
  // in-progress prerelease keeps its base instead of re-deriving a target
  // (which would inflate the version on every run).
  if (lastStableVersion === null) {
    if (parsed && parsed.prerelease.length > 0) {
      const continued = continuePrereleaseSequence(current, currentBase, preid);
      return continued ?? `${currentBase}-${preid}.0`;
    }
    const target = semver.inc(current, level);
    if (!target) {
      throw new Error(`Failed to bump version "${current}" by "${level}"`);
    }
    return `${target}-${preid}.0`;
  }

  const targetStable = semver.inc(lastStableVersion, level);
  if (!targetStable) {
    throw new Error(`Failed to bump version "${lastStableVersion}" by "${level}"`);
  }

  if (parsed && parsed.prerelease.length > 0 && currentBase === targetStable) {
    const continued = continuePrereleaseSequence(current, currentBase, preid);
    if (continued) return continued;
  }

  return `${targetStable}-${preid}.0`;
}

export function getHighestBump(commits: ConventionalCommit[]): BumpLevel | null {
  let highest: BumpLevel | null = null;
  for (const commit of commits) {
    if (commit.breaking) return "major";
    const level = TYPE_TO_BUMP[commit.type];
    if (!level) continue;
    if (!highest || BUMP_ORDER[level] > BUMP_ORDER[highest]) highest = level;
  }
  return highest;
}

/**
 * Post-process version bumps to enforce fixed/linked group constraints.
 *
 * - Fixed: all packages in a group get the same (highest) version.
 *   Packages with no changes are added to the results.
 * - Linked: bumped packages in a group share the highest new version.
 *   Packages with no changes are NOT added.
 */
export function applyVersionGroups(
  bumps: VersionBump[],
  packages: ResolvedPackage[],
  groups: VersionGroups,
  prerelease?: PrereleaseOptions,
): VersionBump[] {
  const result = bumps.map((b) => ({ ...b }));
  const bumpByName = new Map(result.map((b) => [b.packageName, b]));

  for (const group of groups.fixed ?? []) {
    const groupSet = new Set(group);
    const groupBumps = result.filter((b) => groupSet.has(b.packageName));
    if (groupBumps.length === 0) continue;

    // Find highest bump level
    let highestLevel: BumpLevel = "patch";
    for (const b of groupBumps) {
      if (BUMP_ORDER[b.level] > BUMP_ORDER[highestLevel]) {
        highestLevel = b.level;
      }
    }

    const groupPackages = packages.filter((p) => groupSet.has(p.name));

    // Start from the highest version among the already-calculated bumps
    let finalVersion = "0.0.0";
    for (const b of groupBumps) {
      if (semver.gt(b.newVersion, finalVersion)) {
        finalVersion = b.newVersion;
      }
    }

    // Check non-bumped packages: if any has a higher base version,
    // bump from that version to ensure consistency
    for (const pkg of groupPackages) {
      if (bumpByName.has(pkg.name)) continue;
      // Bump from the actual version: semver.inc graduates prerelease
      // versions to their base (1.1.0-beta.1 + minor -> 1.1.0) instead of
      // inflating past it.
      const wouldBe = prerelease
        ? bumpPrerelease(
            pkg.version,
            prerelease.lastStableVersions.get(pkg.path) ?? null,
            highestLevel,
            prerelease.preid,
          )
        : bumpVersion(pkg.version, highestLevel);
      if (semver.gt(wouldBe, finalVersion)) {
        finalVersion = wouldBe;
      }
    }

    // Apply to all group bumps
    for (const b of groupBumps) {
      b.newVersion = finalVersion;
    }

    // Add missing packages
    for (const pkg of groupPackages) {
      if (bumpByName.has(pkg.name)) continue;
      if (!pkg.publish) continue;
      if (pkg.version === finalVersion) continue;
      const newBump: VersionBump = {
        packagePath: pkg.path,
        packageName: pkg.name,
        currentVersion: pkg.version,
        newVersion: finalVersion,
        level: highestLevel,
        commits: [],
        propagated: false,
      };
      result.push(newBump);
      bumpByName.set(pkg.name, newBump);
    }
  }

  for (const group of groups.linked ?? []) {
    const groupSet = new Set(group);
    const groupBumps = result.filter((b) => groupSet.has(b.packageName));
    if (groupBumps.length <= 1) continue;

    let highestVersion = "0.0.0";
    for (const b of groupBumps) {
      if (semver.gt(b.newVersion, highestVersion)) {
        highestVersion = b.newVersion;
      }
    }

    for (const b of groupBumps) {
      b.newVersion = highestVersion;
    }
  }

  return result;
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
