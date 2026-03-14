import { executeRelease } from "@release-smith/core";
import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";

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
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"];
    const targetPkgs = args.target ? args.target.split(",").map((s) => s.trim()) : [];

    const { packages, bumps: allBumps, isMonorepo } = await runPipeline(args.cwd);

    let bumps = allBumps;
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
    }
  },
});
