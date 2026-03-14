import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";

export default defineCommand({
  meta: {
    name: "status",
    description: "View current version status and pending changes per package",
  },
  args: {
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const { bumps } = await runPipeline(args.cwd);

    if (bumps.length === 0) {
      console.log("All packages are up to date. No pending releases.");
      return;
    }

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
  },
});
