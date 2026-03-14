import { generateChangelog } from "@release-smith/core";
import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";

export default defineCommand({
  meta: {
    name: "changelog",
    description: "Generate changelog only (no release)",
  },
  args: {
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const { bumps, isMonorepo } = await runPipeline(args.cwd);
    const date = new Date().toISOString().slice(0, 10);

    if (bumps.length === 0) {
      console.log("No changes to generate changelog for.");
      return;
    }

    for (const bump of bumps) {
      if (isMonorepo) console.log(`\n--- ${bump.packageName} ---\n`);
      console.log(generateChangelog(bump, date, null));
    }
  },
});
