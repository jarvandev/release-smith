import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverPackages } from "@release-smith/config";
import { execGit } from "@release-smith/git";
import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "init",
    description: "Create release-smith.json configuration",
  },
  args: {
    cwd: {
      type: "string",
      description: "Specify working directory",
      default: process.cwd(),
    },
  },
  async run({ args }) {
    const configPath = join(args.cwd, "release-smith.json");

    try {
      await access(configPath);
      console.error("release-smith.json already exists.");
      process.exit(1);
    } catch {
      // File doesn't exist, proceed
    }

    const packages = await discoverPackages(args.cwd, null);
    const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

    // Get current HEAD commit as the starting point for all packages
    const headCommit = (await execGit(["rev-parse", "HEAD"], args.cwd)).trim();

    let config: object;
    if (isMonorepo) {
      const pkgEntries: Record<string, { publish: boolean; from: string }> = {};
      for (const pkg of packages) {
        pkgEntries[pkg.path] = { publish: !pkg.isPrivate, from: headCommit };
      }
      config = { packages: pkgEntries };
    } else {
      config = {};
    }

    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Created ${configPath}`);

    if (isMonorepo) {
      console.log("\nDetected packages:");
      for (const pkg of packages) {
        const publishStr = pkg.isPrivate ? "publish: false" : "publish: true";
        console.log(`  ${pkg.path} (${publishStr})`);
      }
      console.log(`\nAll packages initialized with from: ${headCommit.slice(0, 7)}`);
      console.log("Edit release-smith.json to customize which packages to publish.");
    }
  },
});
