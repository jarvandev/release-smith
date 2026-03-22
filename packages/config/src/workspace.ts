import { access, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import fg from "fast-glob";
import type { RawConfig, ResolvedPackage } from "./types";

export async function discoverPackages(
  cwd: string,
  config: RawConfig | null,
): Promise<ResolvedPackage[]> {
  const rootPkg = await readPackageJson(cwd);

  const globalIgnoreFiles = config?.ignoreFiles ?? [];

  // Single-package project
  if (!rootPkg.workspaces) {
    const pkgIgnoreFiles = config?.packages?.["."]?.ignoreFiles ?? [];
    const dirName = cwd.split("/").pop() || "unknown";
    return [
      {
        name: rootPkg.name ?? dirName,
        path: ".",
        publish: true,
        changelogPath: join(cwd, "CHANGELOG.md"),
        version: rootPkg.version ?? "0.0.0",
        isPrivate: rootPkg.private === true,
        workspaceDeps: [],
        ignoreFiles: [...globalIgnoreFiles, ...pkgIgnoreFiles],
      },
    ];
  }

  // Monorepo: resolve workspace globs
  const patterns: string[] = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : (rootPkg.workspaces.packages ?? []);

  const packageDirs = await resolveWorkspaceGlobs(cwd, patterns);
  const hasExplicitConfig = config?.packages && Object.keys(config.packages).length > 0;

  // First pass: read all package.json files and collect names
  const pkgDataList: Array<{
    dir: string;
    relPath: string;
    pkg: Record<string, any>;
  }> = [];
  for (const dir of packageDirs) {
    const relPath = relative(cwd, dir);
    const pkg = await readPackageJson(dir);
    pkgDataList.push({ dir, relPath, pkg });
  }

  const allWorkspaceNames = new Set(pkgDataList.map((p) => p.pkg.name).filter(Boolean));

  // Second pass: resolve each package
  const resolved: ResolvedPackage[] = [];
  const packageByName = new Map<string, string>();
  for (const { dir, relPath, pkg } of pkgDataList) {
    const configEntry = config?.packages?.[relPath];
    const isPrivate = pkg.private === true;

    let publish: boolean;
    if (configEntry?.publish !== undefined) {
      publish = configEntry.publish;
    } else if (hasExplicitConfig) {
      // Listed in config without explicit publish → true; unlisted → false
      publish = configEntry !== undefined;
    } else {
      publish = !isPrivate;
    }

    const changelogPath = configEntry?.changelog
      ? join(cwd, configEntry.changelog)
      : join(dir, "CHANGELOG.md");

    const autoDetected = collectWorkspaceDeps(pkg, allWorkspaceNames);
    const extra = configEntry?.extraDeps ?? [];
    const workspaceDeps = [...new Set([...autoDetected, ...extra])];

    const dirName = relPath.split("/").pop() || relPath;
    const name = configEntry?.name ?? pkg.name ?? dirName;
    if (!pkg.name && !configEntry?.name) {
      console.warn(
        `Warning: Package at "${relPath}" has no name in package.json, using directory name "${dirName}" as fallback.`,
      );
    }

    if (packageByName.has(name)) {
      throw new Error(
        `Duplicate package name "${name}" found in "${packageByName.get(name)}" and "${relPath}". ` +
          "Add a unique name in package.json or use the config name override.",
      );
    }
    packageByName.set(name, relPath);

    const pkgIgnoreFiles = configEntry?.ignoreFiles ?? [];
    resolved.push({
      name,
      path: relPath,
      publish,
      changelogPath,
      version: pkg.version ?? "0.0.0",
      isPrivate,
      workspaceDeps,
      from: configEntry?.from,
      ignoreFiles: [...globalIgnoreFiles, ...pkgIgnoreFiles],
    });
  }

  return resolved;
}

function collectWorkspaceDeps(pkg: Record<string, any>, workspaceNames: Set<string>): string[] {
  const deps = new Set<string>();
  for (const source of [pkg.dependencies, pkg.peerDependencies]) {
    if (!source) continue;
    for (const name of Object.keys(source)) {
      if (workspaceNames.has(name)) deps.add(name);
    }
  }
  return [...deps];
}

async function resolveWorkspaceGlobs(cwd: string, patterns: string[]): Promise<string[]> {
  const globs = patterns.map((p) => `${p}/package.json`);
  const matches = await fg(globs, { cwd, onlyFiles: true, absolute: true });
  return matches.map((m) => join(m, "..")).sort();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(dir: string): Promise<Record<string, any>> {
  const pkgPath = join(dir, "package.json");
  if (!(await fileExists(pkgPath))) {
    throw new Error(`No package.json found in ${dir}`);
  }
  const text = await readFile(pkgPath, "utf-8");
  return JSON.parse(text);
}
