import { formatTagName } from "@release-smith/core";
import { defineCommand } from "citty";
import { runPipeline } from "../pipeline";

export default defineCommand({
  meta: {
    name: "status",
    description: "View current version status and pending changes per package",
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
    const { bumps, tagFormat } = await runPipeline(args.cwd);

    if (args.json) {
      const packages = bumps.map((bump) => ({
        name: bump.packageName,
        displayName: bump.displayName,
        path: bump.packagePath,
        currentVersion: bump.currentVersion,
        nextVersion: bump.newVersion,
        bumpLevel: bump.level,
        tagName: formatTagName(tagFormat, bump.displayName, bump.newVersion),
        propagated: bump.propagated,
        commits: bump.commits.map((c) => ({
          hash: c.hash,
          type: c.type,
          scope: c.scope,
          description: c.description,
          breaking: c.breaking,
        })),
      }));
      console.log(JSON.stringify({ packages }));
      return;
    }

    if (bumps.length === 0) {
      console.log("All packages are up to date. No pending releases.");
      return;
    }

    console.log("Pending releases:\n");
    for (const bump of bumps) {
      const suffix = bump.propagated ? " (dependency update)" : "";
      console.log(`  ${bump.displayName}`);
      console.log(`    ${bump.currentVersion} -> ${bump.newVersion} (${bump.level})${suffix}`);
      if (bump.commits.length > 0) {
        for (const c of bump.commits) console.log(`    - ${c.rawMessage}`);
      }
      console.log();
    }
  },
});
