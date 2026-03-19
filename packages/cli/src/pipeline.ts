import { discoverPackages, loadConfig, type ResolvedPackage } from "@release-smith/config";
import {
  allFilesIgnored,
  applyVersionGroups,
  type BumpLevel,
  bumpPrerelease,
  bumpVersion,
  type ConventionalCommit,
  createIgnoreMatcher,
  detectCircularDeps,
  getHighestBump,
  type PrereleaseOptions,
  parseConventionalCommit,
  resolveTagFormat,
  resolveTagPrefix,
  topologicalSort,
  type VersionBump,
} from "@release-smith/core";
import { execGit, getChangedFiles, getCommits, getLatestVersionTag } from "@release-smith/git";

export interface PipelineOptions {
  /** Explicit pre-release identifier (overrides branch config). */
  prerelease?: string;
}

export interface PipelineResult {
  packages: ResolvedPackage[];
  bumps: VersionBump[];
  isMonorepo: boolean;
  tagFormat: string;
  prLabels: string[];
}

export async function runPipeline(cwd: string, options?: PipelineOptions): Promise<PipelineResult> {
  const config = await loadConfig(cwd);
  const packages = await discoverPackages(cwd, config);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";
  const tagFormat = resolveTagFormat(config?.tagFormat, isMonorepo);

  // Resolve pre-release: CLI flag takes precedence, then branch config
  let preid = options?.prerelease;
  if (!preid && config?.branches) {
    const branch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
    const branchConfig = config.branches[branch];
    if (branchConfig?.prerelease) {
      preid = branchConfig.prerelease;
    }
  }

  const cycle = detectCircularDeps(packages);
  if (cycle) throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);

  // Build lookup maps
  const packageByName = new Map(packages.map((p) => [p.name, p]));
  const sorted = topologicalSort(packages);

  // Collect per-package latest tags and baselines
  const packageTags = new Map<string, string | null>();
  for (const pkg of sorted) {
    if (!pkg.publish) {
      packageTags.set(pkg.path, null);
      continue;
    }
    const prefix = resolveTagPrefix(tagFormat, pkg.name);
    const tag = await getLatestVersionTag(cwd, prefix);
    packageTags.set(pkg.path, tag);
  }

  // Resolve prerelease options
  let prereleaseOpts: PrereleaseOptions | undefined;
  if (preid) {
    const lastStableVersions = new Map<string, string>();
    for (const pkg of packages) {
      const tag = packageTags.get(pkg.path);
      if (tag) {
        const prefix = resolveTagPrefix(tagFormat, pkg.name);
        lastStableVersions.set(pkg.path, tag.slice(prefix.length));
      } else {
        // No stable tag: strip prerelease suffix from package.json version
        lastStableVersions.set(pkg.path, pkg.version.replace(/-.*$/, ""));
      }
    }
    prereleaseOpts = { preid, lastStableVersions };
  }

  // Per-package traversal in topological order
  const bumpedPackages = new Set<string>();
  const results: VersionBump[] = [];

  for (const pkg of sorted) {
    if (!pkg.publish) continue;

    const baseline = packageTags.get(pkg.path) ?? pkg.from ?? null;

    // Get direct commits for this package
    const directCommits = await getPackageCommits(cwd, baseline, pkg.path, pkg.ignoreFiles);

    // Collect rollup commits from unpublished deps
    const unpubDeps = collectUnpublishedDeps(pkg.name, packageByName);
    const rollupHashes = new Set<string>();
    const rollupCommits: ConventionalCommit[] = [];
    for (const dep of unpubDeps) {
      const depCommits = await getPackageCommits(cwd, baseline, dep.path, dep.ignoreFiles);
      for (const c of depCommits) {
        if (!rollupHashes.has(c.hash)) {
          rollupHashes.add(c.hash);
          rollupCommits.push(c);
        }
      }
    }

    // Merge direct + rollup (deduplicate)
    const seenHashes = new Set(directCommits.map((c) => c.hash));
    const allCommits = [...directCommits];
    for (const c of rollupCommits) {
      if (!seenHashes.has(c.hash)) {
        seenHashes.add(c.hash);
        allCommits.push(c);
      }
    }

    const level = getHighestBump(allCommits);
    const propagated = shouldPropagate(pkg, packageByName, bumpedPackages);

    if (level) {
      results.push(makeBump(pkg, level, allCommits, false, prereleaseOpts));
      bumpedPackages.add(pkg.name);
    } else if (propagated) {
      results.push(makeBump(pkg, "patch", [], true, prereleaseOpts));
      bumpedPackages.add(pkg.name);
    }
  }

  let bumps = results;
  if (config?.groups) {
    bumps = applyVersionGroups(bumps, packages, config.groups, prereleaseOpts);
  }

  const prLabels = config?.prLabels ?? ["autorelease: pending"];

  return { packages, bumps, isMonorepo, tagFormat, prLabels };
}

function makeBump(
  pkg: ResolvedPackage,
  level: BumpLevel,
  commits: ConventionalCommit[],
  propagated: boolean,
  prerelease?: PrereleaseOptions,
): VersionBump {
  const newVersion = prerelease
    ? bumpPrerelease(
        pkg.version,
        prerelease.lastStableVersions.get(pkg.path) ?? pkg.version,
        level,
        prerelease.preid,
      )
    : bumpVersion(pkg.version, level);
  return {
    packagePath: pkg.path,
    packageName: pkg.name,
    currentVersion: pkg.version,
    newVersion,
    level,
    commits,
    propagated,
  };
}

/**
 * Fetch commits for a specific package path, parse as conventional commits,
 * and optionally filter by ignoreFiles patterns.
 */
async function getPackageCommits(
  cwd: string,
  baseline: string | null,
  pkgPath: string,
  ignoreFiles: string[],
): Promise<ConventionalCommit[]> {
  const rawCommits = await getCommits(cwd, baseline, "HEAD", [pkgPath]);
  const parsed: ConventionalCommit[] = [];

  for (const raw of rawCommits) {
    const commit = parseConventionalCommit(raw.hash, raw.message, raw.body);
    if (commit) parsed.push(commit);
  }

  const matcher = createIgnoreMatcher(ignoreFiles);
  if (!matcher) return parsed;

  // Filter: only include commits that touch at least one non-ignored file
  const filtered: ConventionalCommit[] = [];
  for (const commit of parsed) {
    const files = await getChangedFiles(cwd, commit.hash);
    const pkgFiles = files
      .filter((f) => pkgPath === "." || f.startsWith(`${pkgPath}/`))
      .map((f) => (pkgPath === "." ? f : f.slice(pkgPath.length + 1)));
    if (!allFilesIgnored(pkgFiles, matcher)) {
      filtered.push(commit);
    }
  }
  return filtered;
}

/**
 * Recursively collect all unpublished deps (transitive).
 * Stops at published package boundaries.
 */
function collectUnpublishedDeps(
  pkgName: string,
  packageByName: Map<string, ResolvedPackage>,
): ResolvedPackage[] {
  const result: ResolvedPackage[] = [];
  const visited = new Set<string>();

  function walk(name: string) {
    const pkg = packageByName.get(name);
    if (!pkg) return;

    for (const depName of pkg.workspaceDeps) {
      if (visited.has(depName)) continue;
      visited.add(depName);

      const dep = packageByName.get(depName);
      if (!dep || dep.publish) continue;

      result.push(dep);
      walk(depName);
    }
  }

  walk(pkgName);
  return result;
}

/**
 * Check whether a package should be propagated (patch bump) due to
 * a published dependency being bumped. Also checks transitively through
 * unpublished deps to find published deps that were bumped.
 */
function shouldPropagate(
  pkg: ResolvedPackage,
  packageByName: Map<string, ResolvedPackage>,
  bumpedPackages: Set<string>,
): boolean {
  const visited = new Set<string>();

  function check(p: ResolvedPackage): boolean {
    for (const depName of p.workspaceDeps) {
      if (visited.has(depName)) continue;
      visited.add(depName);

      const dep = packageByName.get(depName);
      if (!dep) continue;

      if (dep.publish) {
        if (bumpedPackages.has(depName)) return true;
      } else {
        if (check(dep)) return true;
      }
    }
    return false;
  }

  return check(pkg);
}
