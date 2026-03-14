import { executeRelease } from "@release-smith/core";
import { runPipeline } from "../pipeline";

export async function runRelease(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const dryRun = flags["dry-run"] === true;
  const targetPkgs = Array.isArray(flags.target) ? flags.target : [];

  const { packages, bumps: allBumps, isMonorepo } = await runPipeline(cwd);

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

  const results = await executeRelease({ cwd, bumps, packages, dryRun, isMonorepo });

  if (!dryRun) {
    console.log("\nRelease complete!");
    for (const result of results) console.log(`  ${result.tagName}`);
  }
}
