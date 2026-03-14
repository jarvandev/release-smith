import { join } from "node:path";
import { discoverPackages } from "@release-smith/config";
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

    const file = Bun.file(configPath);
    if (await file.exists()) {
      console.error("release-smith.json already exists.");
      process.exit(1);
    }

    const packages = await discoverPackages(args.cwd, null);
    const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

    let config: object;
    if (isMonorepo) {
      const pkgEntries: Record<string, { publish: boolean }> = {};
      for (const pkg of packages) pkgEntries[pkg.path] = { publish: !pkg.isPrivate };
      config = { packages: pkgEntries };
    } else {
      config = {};
    }

    await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Created ${configPath}`);

    if (isMonorepo) {
      console.log("\nDetected packages:");
      for (const pkg of packages) {
        const publishStr = pkg.isPrivate ? "publish: false" : "publish: true";
        console.log(`  ${pkg.path} (${publishStr})`);
      }
      console.log("\nEdit release-smith.json to customize which packages to publish.");
    }
  },
});
