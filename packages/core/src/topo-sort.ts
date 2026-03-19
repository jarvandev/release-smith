import type { ResolvedPackage } from "@release-smith/config";

/**
 * Topologically sort packages so that dependencies come before dependents.
 * Uses DFS post-order traversal on the workspace dependency graph.
 * Packages with no dependencies appear first.
 */
export function topologicalSort(packages: ResolvedPackage[]): ResolvedPackage[] {
  const packageByName = new Map(packages.map((p) => [p.name, p]));
  const visited = new Set<string>();
  const result: ResolvedPackage[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);

    const pkg = packageByName.get(name);
    if (!pkg) return;

    for (const dep of pkg.workspaceDeps) {
      visit(dep);
    }

    result.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg.name);
  }

  return result;
}
