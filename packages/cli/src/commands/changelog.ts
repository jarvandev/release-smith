import { generateChangelog } from "@release-smith/core";
import { runPipeline } from "../pipeline";

export async function runChangelog(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const { bumps, isMonorepo } = await runPipeline(cwd);
  const date = new Date().toISOString().slice(0, 10);

  if (bumps.length === 0) {
    console.log("No changes to generate changelog for.");
    return;
  }

  for (const bump of bumps) {
    if (isMonorepo) console.log(`\n--- ${bump.packageName} ---\n`);
    console.log(generateChangelog(bump, date, null));
  }
}
