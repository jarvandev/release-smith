import type { ConventionalCommit, PackageCommit } from "./types";

const CONVENTIONAL_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/;

export function parseConventionalCommit(hash: string, message: string, body: string): ConventionalCommit | null {
  const match = message.match(CONVENTIONAL_REGEX);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  const breakingInFooter = /^BREAKING[ -]CHANGE\s*:/m.test(body);
  return {
    hash,
    type,
    scope: scope ?? null,
    description: description.trim(),
    body,
    breaking: bang === "!" || breakingInFooter,
    rawMessage: message,
  };
}

export function assignCommitsToPackages(
  commits: ConventionalCommit[],
  filesMap: Map<string, string[]>,
  packagePaths: string[],
): PackageCommit[] {
  const results: PackageCommit[] = [];
  for (const commit of commits) {
    const files = filesMap.get(commit.hash) ?? [];
    const matchedPaths = new Set<string>();
    for (const file of files) {
      for (const pkgPath of packagePaths) {
        if (pkgPath === ".") {
          matchedPaths.add(pkgPath);
        } else if (file.startsWith(pkgPath + "/")) {
          matchedPaths.add(pkgPath);
        }
      }
    }
    for (const pkgPath of matchedPaths) {
      results.push({ packagePath: pkgPath, commit });
    }
  }
  return results;
}
