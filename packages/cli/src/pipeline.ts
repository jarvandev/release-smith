import { discoverPackages, loadConfig, type ResolvedPackage } from "@release-smith/config";
import {
  applyVersionGroups,
  assignCommitsToPackages,
  type ConventionalCommit,
  calculateVersionBumps,
  detectCircularDeps,
  type PrereleaseOptions,
  parseConventionalCommit,
  type RollupCutoffs,
  resolveTagFormat,
  resolveTagPrefix,
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

  // Collect per-package latest tags (only published packages have meaningful tags)
  const packageTags = new Map<string, string | null>();
  // For packages with no tag, a "from" commit can serve as the baseline
  const packageFromRefs = new Map<string, string>();
  let earliestRef: string | null = null;
  let hasPublishedPackageWithNoBaseline = false;

  for (const pkg of packages) {
    if (!pkg.publish) {
      packageTags.set(pkg.path, null);
      continue;
    }
    const prefix = resolveTagPrefix(tagFormat, pkg.name);
    const tag = await getLatestVersionTag(cwd, prefix);
    packageTags.set(pkg.path, tag);
    if (tag === null) {
      if (pkg.from) {
        // Use "from" commit as baseline for packages that have never been released
        packageFromRefs.set(pkg.path, pkg.from);
      } else {
        hasPublishedPackageWithNoBaseline = true;
      }
    }
    // Track the earliest ref (tag or from) for commit fetching
    const ref = tag ?? pkg.from ?? null;
    if (!ref) continue;
    if (!earliestRef) {
      earliestRef = ref;
    } else {
      const refDate = await execGit(["log", "-1", "--format=%ct", ref], cwd);
      const earliestDate = await execGit(["log", "-1", "--format=%ct", earliestRef], cwd);
      if (parseInt(refDate, 10) < parseInt(earliestDate, 10)) earliestRef = ref;
    }
  }

  const fromRef = hasPublishedPackageWithNoBaseline ? null : earliestRef;
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
  const ignoreFilesMap = new Map<string, string[]>();
  for (const pkg of packages) {
    if (pkg.ignoreFiles.length > 0) {
      ignoreFilesMap.set(pkg.path, pkg.ignoreFiles);
    }
  }
  const allPackageCommits = assignCommitsToPackages(
    allParsed,
    filesMap,
    packagePaths,
    ignoreFilesMap,
  );

  // Resolve per-package baseline timestamps (tag or "from" commit)
  const packageBaselineTs = new Map<string, number>();
  for (const pkg of packages) {
    const tag = packageTags.get(pkg.path);
    if (tag) {
      const ts = tagTimestamps.get(tag);
      if (ts !== undefined) packageBaselineTs.set(pkg.path, ts);
    } else {
      const fromRef = packageFromRefs.get(pkg.path);
      if (fromRef) {
        const ts = await execGit(["log", "-1", "--format=%ct", fromRef], cwd);
        packageBaselineTs.set(pkg.path, parseInt(ts, 10));
      }
    }
  }

  // Filter commits per-package: only include commits after each package's baseline.
  // Unpublished packages have no baseline and pass through all commits here;
  // their rollup filtering is handled inside calculateVersionBumps via rollupCutoffs.
  const filteredPackageCommits = allPackageCommits.filter((pc) => {
    const baselineTs = packageBaselineTs.get(pc.packagePath);
    if (baselineTs === undefined) return true;
    const commitTs = commitTimestamps.get(pc.commit.hash);
    if (commitTs === undefined) return true;
    return commitTs > baselineTs;
  });

  // Build per-published-package cutoff timestamps for rollup filtering.
  // Each published package uses its own baseline to filter rolled-up
  // commits from unpublished deps, so only new commits are included.
  const packageCutoffs = new Map<string, number>();
  for (const [path, ts] of packageBaselineTs) {
    const pkg = packages.find((p) => p.path === path);
    if (pkg?.publish) packageCutoffs.set(path, ts);
  }
  const rollupCutoffs: RollupCutoffs = { packageCutoffs, commitTimestamps };

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

  let bumps = calculateVersionBumps(
    packages,
    filteredPackageCommits,
    prereleaseOpts,
    rollupCutoffs,
  );

  if (config?.groups) {
    bumps = applyVersionGroups(bumps, packages, config.groups);
  }

  const prLabels = config?.prLabels ?? ["autorelease: pending"];

  return { packages, bumps, isMonorepo, tagFormat, prLabels };
}
