import { join, relative } from "node:path";
import { Glob } from "bun";
import type { RawConfig, ResolvedPackage } from "./types";

export async function discoverPackages(
  cwd: string,
  config: RawConfig | null,
): Promise<ResolvedPackage[]> {
  const rootPkg = await readPackageJson(cwd);

  // Single-package project
  if (!rootPkg.workspaces) {
    return [
      {
        name: rootPkg.name ?? "unknown",
        path: ".",
        publish: true,
        changelogPath: join(cwd, "CHANGELOG.md"),
        version: rootPkg.version ?? "0.0.0",
        isPrivate: rootPkg.private === true,
        workspaceDeps: [],
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
  for (const { dir, relPath, pkg } of pkgDataList) {
    const configEntry = config?.packages?.[relPath];
    const isPrivate = pkg.private === true;

    let publish: boolean;
    if (configEntry?.publish !== undefined) {
      publish = configEntry.publish;
    } else if (hasExplicitConfig) {
      publish = false;
    } else {
      publish = !isPrivate;
    }

    const changelogPath = configEntry?.changelog
      ? join(cwd, configEntry.changelog)
      : join(dir, "CHANGELOG.md");

    const workspaceDeps = collectWorkspaceDeps(pkg, allWorkspaceNames);

    resolved.push({
      name: pkg.name ?? "unknown",
      path: relPath,
      publish,
      changelogPath,
      version: pkg.version ?? "0.0.0",
      isPrivate,
      workspaceDeps,
    });
  }

  return resolved;
}

function collectWorkspaceDeps(pkg: Record<string, any>, workspaceNames: Set<string>): string[] {
  const deps: string[] = [];
  const sources = [pkg.dependencies, pkg.peerDependencies];
  for (const source of sources) {
    if (!source) continue;
    for (const name of Object.keys(source)) {
      if (workspaceNames.has(name)) {
        deps.push(name);
      }
    }
  }
  return [...new Set(deps)];
}

async function resolveWorkspaceGlobs(cwd: string, patterns: string[]): Promise<string[]> {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const match of glob.scan({ cwd, onlyFiles: false })) {
      const fullPath = join(cwd, match);
      const pkgJsonPath = join(fullPath, "package.json");
      if (await Bun.file(pkgJsonPath).exists()) {
        dirs.push(fullPath);
      }
    }
  }
  return dirs.sort();
}

async function readPackageJson(dir: string): Promise<Record<string, any>> {
  const file = Bun.file(join(dir, "package.json"));
  if (!(await file.exists())) {
    throw new Error(`No package.json found in ${dir}`);
  }
  return file.json();
}
