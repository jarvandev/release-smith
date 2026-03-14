import { discoverPackages, loadConfig, type ResolvedPackage } from "@release-smith/config";
import {
  assignCommitsToPackages,
  type ConventionalCommit,
  calculateVersionBumps,
  detectCircularDeps,
  type PrereleaseOptions,
  parseConventionalCommit,
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
}

function extractVersionFromTag(tag: string, packageName: string | null): string {
  if (packageName) {
    return tag.slice(packageName.length + 1);
  }
  return tag.slice(1);
}

export async function runPipeline(cwd: string, options?: PipelineOptions): Promise<PipelineResult> {
  const config = await loadConfig(cwd);
  const packages = await discoverPackages(cwd, config);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

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

  // Collect per-package latest tags
  const packageTags = new Map<string, string | null>();
  let earliestTag: string | null = null;
  let hasPackageWithNoTag = false;

  for (const pkg of packages) {
    const pkgName = isMonorepo ? pkg.name : null;
    const tag = await getLatestVersionTag(cwd, pkgName);
    packageTags.set(pkg.path, tag);
    if (tag === null) {
      hasPackageWithNoTag = true;
    } else if (!earliestTag) {
      earliestTag = tag;
    } else {
      const tagDate = await execGit(["log", "-1", "--format=%ct", tag], cwd);
      const earliestDate = await execGit(["log", "-1", "--format=%ct", earliestTag], cwd);
      if (parseInt(tagDate, 10) < parseInt(earliestDate, 10)) earliestTag = tag;
    }
  }

  const fromRef = hasPackageWithNoTag ? null : earliestTag;
  const rawCommits = await getCommits(cwd, fromRef, "HEAD");
  const allParsed: ConventionalCommit[] = [];
  const filesMap = new Map<string, string[]>();

  for (const rawCommit of rawCommits) {
    const parsed = parseConventionalCommit(rawCommit.hash, rawCommit.message, rawCommit.body);
    if (parsed) allParsed.push(parsed);
    const files = await getChangedFiles(cwd, rawCommit.hash);
    filesMap.set(rawCommit.hash, files);
  }

  // Get tag timestamps for per-package filtering
  const tagTimestamps = new Map<string, number>();
  for (const [, tag] of packageTags) {
    if (tag && !tagTimestamps.has(tag)) {
      const ts = await execGit(["log", "-1", "--format=%ct", tag], cwd);
      tagTimestamps.set(tag, parseInt(ts, 10));
    }
  }

  // Get commit timestamps
  const commitTimestamps = new Map<string, number>();
  for (const commit of allParsed) {
    if (!commitTimestamps.has(commit.hash)) {
      const ts = await execGit(["log", "-1", "--format=%ct", commit.hash], cwd);
      commitTimestamps.set(commit.hash, parseInt(ts, 10));
    }
  }

  const packagePaths = packages.map((p) => p.path);
  const allPackageCommits = assignCommitsToPackages(allParsed, filesMap, packagePaths);

  // Filter commits per-package: only include commits after each package's own tag
  const filteredPackageCommits = allPackageCommits.filter((pc) => {
    const tag = packageTags.get(pc.packagePath);
    if (!tag) return true;
    const tagTs = tagTimestamps.get(tag);
    if (tagTs === undefined) return true;
    const commitTs = commitTimestamps.get(pc.commit.hash);
    if (commitTs === undefined) return true;
    return commitTs > tagTs;
  });

  let prereleaseOpts: PrereleaseOptions | undefined;
  if (preid) {
    const lastStableVersions = new Map<string, string>();
    for (const pkg of packages) {
      const tag = packageTags.get(pkg.path);
      if (tag) {
        const pkgName = isMonorepo ? pkg.name : null;
        lastStableVersions.set(pkg.path, extractVersionFromTag(tag, pkgName));
      } else {
        // No stable tag: strip prerelease suffix from package.json version
        lastStableVersions.set(pkg.path, pkg.version.replace(/-.*$/, ""));
      }
    }
    prereleaseOpts = { preid, lastStableVersions };
  }

  const bumps = calculateVersionBumps(packages, filteredPackageCommits, prereleaseOpts);
  return { packages, bumps, isMonorepo };
}
