import type { ResolvedPackage } from "@release-smith/config";
import {
  applyReleaseChanges,
  buildCommitMessage,
  type ReleaseResult,
  type VersionBump,
} from "@release-smith/core";
import { execGit } from "@release-smith/git";
import {
  addLabelsToPullRequest,
  createPullRequest,
  findOpenPullRequest,
  parseGitHubUrl,
  updatePullRequest,
} from "@release-smith/github";

interface ReleasePROptions {
  cwd: string;
  bumps: VersionBump[];
  packages: ResolvedPackage[];
  isMonorepo: boolean;
  branch: string;
  dryRun: boolean;
  tagFormat?: string;
  prLabels?: string[];
}

export async function runReleasePR(options: ReleasePROptions): Promise<void> {
  const { cwd, bumps, packages, isMonorepo, branch, dryRun } = options;

  if (bumps.length === 0) {
    console.log("No packages to release.");
    return;
  }

  const token = process.env.GITHUB_TOKEN ?? null;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for --pr mode.");
  }

  const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
  const ghInfo = parseGitHubUrl(remoteUrl);
  if (!ghInfo) {
    throw new Error("Could not parse GitHub remote URL. --pr mode requires a GitHub remote.");
  }

  const baseBranch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();

  for (const bump of bumps) {
    const suffix = bump.propagated ? " (dependency update)" : "";
    console.log(`${bump.packageName}: ${bump.currentVersion} -> ${bump.newVersion}${suffix}`);
  }

  if (dryRun) {
    console.log("\nDry run - would create/update PR on branch:", branch);
    return;
  }

  // Create or reset release branch from current base
  await execGit(["checkout", "-B", branch, `origin/${baseBranch}`], cwd);

  try {
    // Apply file changes (version bumps, changelogs, workspace deps)
    const results = await applyReleaseChanges({
      cwd,
      bumps,
      packages,
      isMonorepo,
      tagFormat: options.tagFormat,
    });
    const commitMsg = buildCommitMessage(results);

    await execGit(["add", "-A"], cwd);
    await execGit(["commit", "-m", commitMsg], cwd);
    await execGit(["push", "-u", "origin", branch, "--force-with-lease"], cwd);

    // Build PR content
    const title = commitMsg;
    const body = buildPRBody(results);

    // Create or update PR
    const existing = await findOpenPullRequest(
      ghInfo.owner,
      ghInfo.repo,
      branch,
      baseBranch,
      token,
    );

    let prNumber: number;
    if (existing) {
      const updated = await updatePullRequest(
        ghInfo.owner,
        ghInfo.repo,
        existing.number,
        title,
        body,
        token,
      );
      prNumber = updated.number;
      console.log(`\nRelease PR updated: ${updated.html_url}`);
    } else {
      const created = await createPullRequest(
        ghInfo.owner,
        ghInfo.repo,
        branch,
        baseBranch,
        title,
        body,
        token,
      );
      prNumber = created.number;
      console.log(`\nRelease PR created: ${created.html_url}`);
    }

    const labels = options.prLabels ?? [];
    if (labels.length > 0) {
      await addLabelsToPullRequest(ghInfo.owner, ghInfo.repo, prNumber, labels, token);
    }
  } finally {
    // Always switch back to the original branch
    await execGit(["checkout", baseBranch], cwd);
  }
}

export function buildPRBody(results: ReleaseResult[]): string {
  const lines: string[] = [];

  lines.push("## Release Summary\n");
  lines.push("| Package | Version | Tag |");
  lines.push("|---------|---------|-----|");
  for (const r of results) {
    lines.push(`| ${r.packageName} | ${r.version} | \`${r.tagName}\` |`);
  }

  lines.push("");
  for (const r of results) {
    lines.push(`### ${r.packageName}\n`);
    lines.push(r.changelog);
    lines.push("");
  }

  // Machine-readable metadata for release-tags command
  const metadata = results.map((r) => ({
    packageName: r.packageName,
    packagePath: r.packagePath,
    version: r.version,
    tagName: r.tagName,
    changelog: r.changelog,
  }));
  lines.push(`<!-- release-smith:metadata\n${JSON.stringify(metadata)}\n-->`);

  return lines.join("\n");
}

export function parseReleaseMetadata(
  body: string,
):
  | Pick<ReleaseResult, "packageName" | "packagePath" | "version" | "tagName" | "changelog">[]
  | null {
  const match = body.match(/<!-- release-smith:metadata\n([\s\S]*?)\n-->/);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item: Record<string, unknown>) =>
          typeof item.packageName !== "string" ||
          typeof item.packagePath !== "string" ||
          typeof item.version !== "string" ||
          typeof item.tagName !== "string" ||
          typeof item.changelog !== "string",
      )
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
