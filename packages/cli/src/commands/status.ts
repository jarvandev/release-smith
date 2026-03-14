import { runPipeline } from "../pipeline";

export async function runStatus(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const { bumps } = await runPipeline(cwd);

  if (bumps.length === 0) { console.log("All packages are up to date. No pending releases."); return; }

  console.log("Pending releases:\n");
  for (const bump of bumps) {
    const suffix = bump.propagated ? " (dependency update)" : "";
    console.log(`  ${bump.packageName}`);
    console.log(`    ${bump.currentVersion} -> ${bump.newVersion} (${bump.level})${suffix}`);
    if (bump.commits.length > 0) {
      for (const c of bump.commits) console.log(`    - ${c.rawMessage}`);
    }
    console.log();
  }
}
