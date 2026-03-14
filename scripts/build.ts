import { $ } from "bun";

const targets = ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-x64"];

await $`bun build packages/cli/src/index.ts --outdir dist --target bun`;

for (const target of targets) {
  const suffix = target.replace("bun-", "");
  console.log(`Building release-smith-${suffix}...`);
  await $`bun build packages/cli/src/index.ts --compile --target=${target} --outfile dist/release-smith-${suffix}`;
}

console.log("Build complete.");
