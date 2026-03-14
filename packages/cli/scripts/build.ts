import { join } from "node:path";
import { $ } from "bun";

const cliDir = join(import.meta.dir, "..");
const entry = join(cliDir, "src/index.ts");
const outDir = join(cliDir, "dist");

const allTargets = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64"];

// --target flag: comma-separated list of targets, or "all" for cross-compile
// Default: compile for current platform only
const targetArg = process.argv[2];
const targets = targetArg === "all" ? allTargets : targetArg ? targetArg.split(",") : [];

console.log("Bundling...");
await $`bun build ${entry} --outdir ${outDir} --target bun`;

if (targets.length === 0) {
  // Compile for current platform
  const outFile = join(outDir, "release-smith");
  console.log("Compiling release-smith (current platform)...");
  await $`bun build ${entry} --compile --outfile ${outFile}`;
} else {
  for (const target of targets) {
    const suffix = target.replace("bun-", "");
    const outFile = join(outDir, `release-smith-${suffix}`);
    console.log(`Compiling release-smith-${suffix}...`);
    await $`bun build ${entry} --compile --target=${target} --outfile ${outFile}`;
  }
}

console.log("Build complete.");
