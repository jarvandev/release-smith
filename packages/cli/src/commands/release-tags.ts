import { appendFile } from "node:fs/promises";
import { createReleaseTags, publishGitHubReleases } from "@release-smith/core";
import { execGit } from "@release-smith/git";
import { getPullRequest, parseGitHubUrl } from "@release-smith/github";
import { defineCommand } from "citty";
import { parseReleaseMetadata } from "./release-pr";

export default defineCommand({
  meta: {
    name: "release-tags",
    description: "Create tags and GitHub Releases from a merged Release PR",
  },
  args: {
    "pr-number": {
      type: "string",
      description: "The merged Release PR number",
      required: true,
    },
    "github-release": {
      type: "boolean",
      description: "Create GitHub Releases after tagging",
      default: true,
    },
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const prNumberStr = args["pr-number"];
    if (!/^\d+$/.test(prNumberStr)) {
      throw new Error(`Invalid PR number: "${prNumberStr}". Must be a positive integer.`);
    }
    const prNumber = parseInt(prNumberStr, 10);

    const cwd = args.cwd;
    const token = process.env.GITHUB_TOKEN ?? null;
    if (!token) {
      throw new Error("GITHUB_TOKEN is required for release-tags.");
    }

    const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
    const ghInfo = parseGitHubUrl(remoteUrl);
    if (!ghInfo) {
      throw new Error("Could not parse GitHub remote URL.");
    }

    console.log(`Fetching PR #${prNumber}...`);
    const pr = await getPullRequest(ghInfo.owner, ghInfo.repo, prNumber, token);

    if (!pr.merged) {
      throw new Error(`PR #${prNumber} has not been merged yet.`);
    }

    if (!pr.body) {
      throw new Error(`PR #${prNumber} has no body. Cannot extract release metadata.`);
    }

    const metadata = parseReleaseMetadata(pr.body);
    if (!metadata || metadata.length === 0) {
      throw new Error(
        `PR #${prNumber} does not contain release-smith metadata. Is this a Release PR?`,
      );
    }

    console.log("Found release metadata:");
    for (const m of metadata) {
      console.log(`  ${m.packageName}@${m.version} -> ${m.tagName}`);
    }

    const results = metadata.map((m) => ({
      packageName: m.packageName,
      packagePath: m.packagePath,
      version: m.version,
      changelog: m.changelog,
      tagName: m.tagName,
    }));

    console.log("\nCreating tags...");
    await createReleaseTags(cwd, results, true);
    console.log("Tags pushed.");

    if (args["github-release"]) {
      console.log("\nCreating GitHub Releases...");
      await publishGitHubReleases(cwd, results);
    }

    // Write GitHub Actions outputs when running in CI
    await writeGitHubOutputs(results);
  },
});

/**
 * Write release outputs to $GITHUB_OUTPUT when running in GitHub Actions.
 *
 * Outputs (compatible with release-please style):
 *   releases_created       = "true"
 *   <name>--release_created = "true"
 *   <name>--tag_name        = "pkg@1.0.0"
 *   <name>--version         = "1.0.0"
 *   all                     = JSON array of all releases
 *
 * Package names are sanitized: `@scope/pkg` -> `scope-pkg` (slashes/@ removed)
 */
async function writeGitHubOutputs(
  results: Array<{ packageName: string; version: string; tagName: string }>,
): Promise<void> {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;

  const lines: string[] = [];
  lines.push("releases_created=true");

  for (const r of results) {
    const key = sanitizeOutputKey(r.packageName);
    lines.push(`${key}--release_created=true`);
    lines.push(`${key}--tag_name=${r.tagName}`);
    lines.push(`${key}--version=${r.version}`);
  }

  const allJson = JSON.stringify(
    results.map((r) => ({
      packageName: r.packageName,
      version: r.version,
      tagName: r.tagName,
    })),
  );
  lines.push(`all=${allJson}`);

  await appendFile(outputFile, `${lines.join("\n")}\n`);
}

function sanitizeOutputKey(name: string): string {
  return name.replace(/@/g, "").replace(/\//g, "-");
}
