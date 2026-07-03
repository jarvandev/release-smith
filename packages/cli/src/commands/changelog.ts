import { formatTagName, generateChangelog } from "@release-smith/core";
import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";

export default defineCommand({
  meta: {
    name: "changelog",
    description: "Generate changelog only (no release)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output machine-readable JSON",
      default: false,
    },
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const { bumps, isMonorepo, tagFormat, changelogConfig } = await runPipeline(args.cwd);
    const date = new Date().toISOString().slice(0, 10);

    if (args.json) {
      const packages = bumps.map((bump) => ({
        name: bump.packageName,
        displayName: bump.displayName,
        version: bump.newVersion,
        tagName: formatTagName(tagFormat, bump.displayName, bump.newVersion),
        changelog: generateChangelog(bump, date, null, { config: changelogConfig }),
      }));
      console.log(JSON.stringify({ packages }));
      return;
    }

    if (bumps.length === 0) {
      console.log("No changes to generate changelog for.");
      return;
    }

    for (const bump of bumps) {
      if (isMonorepo) console.log(`\n--- ${bump.displayName} ---\n`);
      console.log(generateChangelog(bump, date, null, { config: changelogConfig }));
    }
  },
});
