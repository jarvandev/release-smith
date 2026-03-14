import { executeRelease, publishGitHubReleases } from "@release-smith/core";
import { execGit } from "@release-smith/git";
import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";
import { runReleasePR } from "./release-pr";

export default defineCommand({
  meta: {
    name: "release",
    description: "Execute the full release pipeline",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Analyze and output results only, no write operations",
      default: false,
    },
    target: {
      type: "string",
      description: "Release only specified packages (comma-separated)",
    },
    push: {
      type: "boolean",
      description: "Push commits and tags to remote after release",
      default: false,
    },
    "github-release": {
      type: "boolean",
      description: "Create GitHub Releases after push (implies --push)",
      default: false,
    },
    prerelease: {
      type: "string",
      description: "Pre-release identifier (e.g., beta, alpha, rc). Overrides branch config.",
    },
    pr: {
      type: "boolean",
      description: "Create a Release PR instead of committing directly",
      default: false,
    },
    branch: {
      type: "string",
      description: "Release branch name for --pr mode",
      default: "release/next",
    },
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"];
    const prMode = args.pr;
    const shouldPush = args.push || args["github-release"];
    const shouldGitHubRelease = args["github-release"];

    if (prMode && (shouldPush || shouldGitHubRelease)) {
      throw new Error("--pr is mutually exclusive with --push and --github-release.");
    }

    const {
      packages,
      bumps: allBumps,
      isMonorepo,
    } = await runPipeline(args.cwd, { prerelease: args.prerelease });

    let bumps = allBumps;
    const targetPkgs = args.target ? args.target.split(",").map((s) => s.trim()) : [];
    if (targetPkgs.length > 0) {
      const targeted = new Set(targetPkgs);
      const filtered = bumps.filter((b) => targeted.has(b.packageName));
      const skipped = bumps.filter((b) => !targeted.has(b.packageName));
      if (skipped.length > 0) {
        console.warn(
          `Warning: Skipping untargeted packages with pending changes: ${skipped.map((b) => b.packageName).join(", ")}`,
        );
      }
      bumps = filtered;
    }

    if (prMode) {
      await runReleasePR({
        cwd: args.cwd,
        bumps,
        packages,
        isMonorepo,
        branch: args.branch,
        dryRun,
      });
      return;
    }

    if (bumps.length === 0) {
      console.log("No packages to release.");
      return;
    }
    if (dryRun) console.log("Dry run - no changes will be made.\n");

    for (const bump of bumps) {
      const suffix = bump.propagated ? " (dependency update)" : "";
      console.log(`${bump.packageName}: ${bump.currentVersion} -> ${bump.newVersion}${suffix}`);
    }

    const results = await executeRelease({ cwd: args.cwd, bumps, packages, dryRun, isMonorepo });

    if (!dryRun) {
      console.log("\nRelease complete!");
      for (const result of results) console.log(`  ${result.tagName}`);

      if (shouldPush) {
        console.log("\nPushing to remote...");
        await execGit(["push"], args.cwd);
        await execGit(["push", "--tags"], args.cwd);
        console.log("Pushed.");
      }

      if (shouldGitHubRelease) {
        console.log("\nCreating GitHub Releases...");
        await publishGitHubReleases(args.cwd, results);
      }
    }
  },
});
