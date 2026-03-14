import { join } from "path";
import { discoverPackages } from "@release-smith/config";

export async function runInit(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const configPath = join(cwd, "release-smith.json");

  const file = Bun.file(configPath);
  if (await file.exists()) { console.error("release-smith.json already exists."); process.exit(1); }

  const packages = await discoverPackages(cwd, null);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

  let config: object;
  if (isMonorepo) {
    const pkgEntries: Record<string, { publish: boolean }> = {};
    for (const pkg of packages) pkgEntries[pkg.path] = { publish: !pkg.isPrivate };
    config = { packages: pkgEntries };
  } else {
    config = {};
  }

  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Created ${configPath}`);

  if (isMonorepo) {
    console.log("\nDetected packages:");
    for (const pkg of packages) {
      const publishStr = pkg.isPrivate ? "publish: false" : "publish: true";
      console.log(`  ${pkg.path} (${publishStr})`);
    }
    console.log("\nEdit release-smith.json to customize which packages to publish.");
  }
}
