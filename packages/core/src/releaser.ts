import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedPackage } from "@release-smith/config";
import { createTag, execGit } from "@release-smith/git";
import { createGitHubRelease, parseGitHubUrl } from "@release-smith/github";
import { generateChangelog, insertChangelog } from "./changelog-generator";
import { formatTagName, resolveTagFormat } from "./tag-format";
import type { ReleaseResult, VersionBump } from "./types";

export async function updatePackageVersion(packageDir: string, newVersion: string): Promise<void> {
  const pkgPath = join(packageDir, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw);
  pkg.version = newVersion;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

export async function updateWorkspaceDeps(
  packageDir: string,
  versionMap: Map<string, string>,
): Promise<void> {
  const pkgPath = join(packageDir, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw);
  let changed = false;
  for (const field of ["dependencies", "peerDependencies", "devDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, version] of versionMap) {
      if (!(name in deps)) continue;
      const updated = updateVersionRange(deps[name] as string, version);
      if (updated === null || updated === deps[name]) continue;
      deps[name] = updated;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

/**
 * Update a version range string with a new version while preserving
 * the original range format (^, ~, >=, exact, workspace: protocol, etc.).
 *
 * Only handles simple ranges (^x.y.z, ~x.y.z, >=x.y.z, x.y.z).
 * Complex ranges like ">=1.0.0 <2.0.0" or "1.x || 2.x" are not supported.
 *
 * Returns null if no update is needed (e.g., workspace:* auto-resolves).
 */
export function updateVersionRange(current: string, newVersion: string): string | null {
  if (current.startsWith("workspace:")) {
    const range = current.slice("workspace:".length);
    // Auto-resolving workspace ranges: *, ^, ~ (no version number)
    // These are resolved by the package manager at publish time
    if (range === "*" || range === "^" || range === "~") return null;
    return `workspace:${replaceVersion(range, newVersion)}`;
  }
  return replaceVersion(current, newVersion);
}

function replaceVersion(range: string, newVersion: string): string {
  // Extract everything before the first digit as the range prefix
  const prefix = range.match(/^[^\d]*/)?.[0] ?? "";
  return `${prefix}${newVersion}`;
}

/**
 * Apply release file changes (version bumps, changelogs, workspace deps)
 * without any git operations. Returns ReleaseResult[] describing what changed.
 */
export async function applyReleaseChanges(options: {
  cwd: string;
  bumps: VersionBump[];
  packages: ResolvedPackage[];
  isMonorepo: boolean;
  tagFormat?: string;
}): Promise<ReleaseResult[]> {
  const { cwd, bumps, packages, isMonorepo } = options;
  const format = resolveTagFormat(options.tagFormat, isMonorepo);
  if (bumps.length === 0) return [];

  const date = new Date().toISOString().slice(0, 10);

  let repoUrl: string | null = null;
  try {
    const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
    const parsed = parseGitHubUrl(remoteUrl);
    if (parsed) repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
  } catch {
    /* no remote */
  }

  const results: ReleaseResult[] = [];
  const versionMap = new Map(bumps.map((b) => [b.packageName, b.newVersion]));

  for (const bump of bumps) {
    const changelog = generateChangelog(bump, date, repoUrl);
    const tagName = formatTagName(format, bump.packageName, bump.newVersion);

    const pkgDir = join(cwd, bump.packagePath);
    await updatePackageVersion(pkgDir, bump.newVersion);

    const pkg = packages.find((p) => p.path === bump.packagePath)!;
    const existingChangelog = await readFileSafe(pkg.changelogPath);
    const newChangelog = insertChangelog(existingChangelog, changelog);
    await writeFile(pkg.changelogPath, newChangelog);

    results.push({
      packageName: bump.packageName,
      packagePath: bump.packagePath,
      version: bump.newVersion,
      changelog,
      tagName,
    });
  }

  for (const pkg of packages) {
    await updateWorkspaceDeps(join(cwd, pkg.path), versionMap);
  }

  return results;
}

/**
 * Build commit message from release results.
 * Requires at least one result.
 */
export function buildCommitMessage(results: ReleaseResult[]): string {
  if (results.length === 0) {
    throw new Error("Cannot build commit message from empty release results.");
  }
  const first = results[0];
  if (results.length === 1 && first) {
    return `chore(release): ${first.packageName}@${first.version}`;
  }
  return `chore(release): ${results.map((r) => `${r.packageName}@${r.version}`).join(", ")}`;
}

/**
 * Create git tags for the given release results on the current HEAD.
 * Optionally push tags to remote.
 */
export async function createReleaseTags(
  cwd: string,
  results: ReleaseResult[],
  push: boolean,
): Promise<void> {
  for (const result of results) {
    await createTag(cwd, result.tagName);
  }
  if (push) {
    await execGit(["push", "--tags"], cwd);
  }
}

/**
 * Execute release: bump versions, write changelogs, commit, tag.
 * Does NOT create GitHub Releases (use publishGitHubReleases after pushing).
 */
export async function executeRelease(options: {
  cwd: string;
  bumps: VersionBump[];
  packages: ResolvedPackage[];
  dryRun: boolean;
  isMonorepo: boolean;
  tagFormat?: string;
}): Promise<ReleaseResult[]> {
  const { cwd, bumps, packages, dryRun, isMonorepo } = options;
  const format = resolveTagFormat(options.tagFormat, isMonorepo);
  if (bumps.length === 0) return [];

  if (dryRun) {
    const date = new Date().toISOString().slice(0, 10);
    let repoUrl: string | null = null;
    try {
      const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
      const parsed = parseGitHubUrl(remoteUrl);
      if (parsed) repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    } catch {
      /* no remote */
    }
    return bumps.map((bump) => ({
      packageName: bump.packageName,
      packagePath: bump.packagePath,
      version: bump.newVersion,
      changelog: generateChangelog(bump, date, repoUrl),
      tagName: formatTagName(format, bump.packageName, bump.newVersion),
    }));
  }

  const results = await applyReleaseChanges({
    cwd,
    bumps,
    packages,
    isMonorepo,
    tagFormat: options.tagFormat,
  });

  await execGit(["add", "-A"], cwd);
  await execGit(["commit", "-m", buildCommitMessage(results)], cwd);
  await createReleaseTags(cwd, results, false);

  return results;
}

/**
 * Create GitHub Releases for the given release results.
 * Call this AFTER pushing commits and tags to remote.
 */
export async function publishGitHubReleases(cwd: string, results: ReleaseResult[]): Promise<void> {
  const token = process.env.GITHUB_TOKEN ?? null;

  let ghInfo: { owner: string; repo: string } | null = null;
  try {
    const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
    ghInfo = parseGitHubUrl(remoteUrl);
  } catch {
    /* no remote */
  }

  if (!ghInfo) {
    console.warn("Warning: No GitHub remote found. Skipping GitHub Release creation.");
    return;
  }

  for (const result of results) {
    const ghResult = await createGitHubRelease({
      owner: ghInfo.owner,
      repo: ghInfo.repo,
      tag: result.tagName,
      name: result.tagName,
      body: result.changelog,
      token,
    });
    if (ghResult.skipped) {
      console.warn(`Warning: ${ghResult.reason}`);
    } else {
      console.log(`GitHub Release created: ${ghResult.url}`);
    }
  }
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
