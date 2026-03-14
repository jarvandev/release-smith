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
    const prNumber = parseInt(args["pr-number"], 10);
    if (Number.isNaN(prNumber)) {
      throw new Error(`Invalid PR number: ${args["pr-number"]}`);
    }

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
  },
});
