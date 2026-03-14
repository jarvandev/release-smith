import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedPackage } from "@release-smith/config";
import { execGit } from "@release-smith/git";
import { createGitHubRelease, parseGitHubUrl } from "@release-smith/github";
import { generateChangelog, insertChangelog } from "./changelog-generator";
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
  for (const field of ["dependencies", "peerDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, version] of versionMap) {
      if (!(name in deps)) continue;
      const currentValue = deps[name] as string;
      if (currentValue.startsWith("workspace:")) {
        deps[name] = `workspace:^${version}`;
      } else {
        deps[name] = `^${version}`;
      }
      changed = true;
    }
  }
  if (changed) {
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

export async function executeRelease(options: {
  cwd: string;
  bumps: VersionBump[];
  packages: ResolvedPackage[];
  dryRun: boolean;
  isMonorepo: boolean;
}): Promise<ReleaseResult[]> {
  const { cwd, bumps, packages, dryRun, isMonorepo } = options;
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
    const tagName = isMonorepo ? `${bump.packageName}@${bump.newVersion}` : `v${bump.newVersion}`;

    if (!dryRun) {
      const pkgDir = join(cwd, bump.packagePath);
      await updatePackageVersion(pkgDir, bump.newVersion);

      const pkg = packages.find((p) => p.path === bump.packagePath)!;
      const existingChangelog = await readFileSafe(pkg.changelogPath);
      const newChangelog = insertChangelog(existingChangelog, changelog);
      await writeFile(pkg.changelogPath, newChangelog);
    }

    results.push({
      packageName: bump.packageName,
      packagePath: bump.packagePath,
      version: bump.newVersion,
      changelog,
      tagName,
    });
  }

  if (!dryRun) {
    for (const pkg of packages) {
      await updateWorkspaceDeps(join(cwd, pkg.path), versionMap);
    }
  }

  if (!dryRun) {
    await execGit(["add", "-A"], cwd);
    const first = results[0];
    const commitMsg =
      first && results.length === 1
        ? `chore(release): ${first.packageName}@${first.version}`
        : `chore(release): ${results.map((r) => `${r.packageName}@${r.version}`).join(", ")}`;
    await execGit(["commit", "-m", commitMsg], cwd);
    for (const result of results) await execGit(["tag", result.tagName], cwd);

    const token = process.env.GITHUB_TOKEN ?? null;
    let ghInfo: { owner: string; repo: string } | null = null;
    try {
      const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
      ghInfo = parseGitHubUrl(remoteUrl);
    } catch {
      /* no remote */
    }

    if (ghInfo) {
      for (const result of results) {
        const ghResult = await createGitHubRelease({
          owner: ghInfo.owner,
          repo: ghInfo.repo,
          tag: result.tagName,
          name: result.tagName,
          body: result.changelog,
          token,
        });
        if (ghResult.skipped) console.warn(`Warning: ${ghResult.reason}`);
      }
    }
  }

  return results;
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
