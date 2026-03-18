import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { discoverPackages } from "@release-smith/config";
import { execGit } from "@release-smith/git";
import { defineCommand } from "citty";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Create or update release-smith.json configuration",
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
    const exists = await fileExists(configPath);

    if (exists) {
      await updateConfig(args.cwd, configPath);
    } else {
      await createConfig(args.cwd, configPath);
    }
  },
});

export async function createConfig(cwd: string, configPath: string) {
  const packages = await discoverPackages(cwd, null);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";
  const headCommit = (await execGit(["rev-parse", "HEAD"], cwd)).trim();

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
}

export async function updateConfig(cwd: string, configPath: string) {
  const raw = JSON.parse(await readFile(configPath, "utf-8"));
  const existingPackages: Record<string, unknown> = raw.packages ?? {};

  const packages = await discoverPackages(cwd, null);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

  if (!isMonorepo) {
    console.log("Single-package project, nothing to update.");
    return;
  }

  const newPackages = packages.filter((pkg) => !(pkg.path in existingPackages));

  if (newPackages.length === 0) {
    console.log("No new packages found. Config is up to date.");
    return;
  }

  const headCommit = (await execGit(["rev-parse", "HEAD"], cwd)).trim();

  for (const pkg of newPackages) {
    existingPackages[pkg.path] = { publish: !pkg.isPrivate, from: headCommit };
  }

  raw.packages = existingPackages;
  await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`Updated ${configPath}`);

  console.log("\nNew packages added:");
  for (const pkg of newPackages) {
    const publishStr = pkg.isPrivate ? "publish: false" : "publish: true";
    console.log(`  ${pkg.path} (${publishStr})`);
  }
  console.log(`\nNew packages initialized with from: ${headCommit.slice(0, 7)}`);
}
