import picomatch from "picomatch";
import type { ConventionalCommit, PackageCommit } from "./types";

const CONVENTIONAL_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/;

export function parseConventionalCommit(
  hash: string,
  message: string,
  body: string,
): ConventionalCommit | null {
  const match = message.match(CONVENTIONAL_REGEX);
  if (!match?.[1] || !match[4]) return null;
  const breakingInFooter = /^BREAKING[ -]CHANGE\s*:/m.test(body);
  return {
    hash,
    type: match[1],
    scope: match[2] ?? null,
    description: match[4].trim(),
    body,
    breaking: match[3] === "!" || breakingInFooter,
    rawMessage: message,
  };
}

/**
 * Create a compiled matcher for ignore patterns.
 * Returns null if no patterns are provided.
 */
export function createIgnoreMatcher(patterns: string[]): picomatch.Matcher | null {
  if (patterns.length === 0) return null;
  return picomatch(patterns, { dot: true });
}

/**
 * Check whether all files in a list are matched by the given ignore matcher.
 * Returns true if ALL files are ignored (commit should be excluded).
 */
export function allFilesIgnored(files: string[], matcher: picomatch.Matcher): boolean {
  if (files.length === 0) return false;
  return !files.some((f) => !matcher(f));
}

export function assignCommitsToPackages(
  commits: ConventionalCommit[],
  filesMap: Map<string, string[]>,
  packagePaths: string[],
  ignoreFilesMap?: Map<string, string[]>,
): PackageCommit[] {
  // Pre-compile ignore matchers per package
  const ignoreMatchers = new Map<string, picomatch.Matcher>();
  if (ignoreFilesMap) {
    for (const [pkgPath, patterns] of ignoreFilesMap) {
      if (patterns.length > 0) {
        ignoreMatchers.set(pkgPath, picomatch(patterns, { dot: true }));
      }
    }
  }

  const results: PackageCommit[] = [];
  for (const commit of commits) {
    const files = filesMap.get(commit.hash) ?? [];
    // Collect per-package relative file paths in a single pass
    const pkgFilesMap = new Map<string, string[]>();
    for (const file of files) {
      for (const pkgPath of packagePaths) {
        if (pkgPath === "." || file.startsWith(`${pkgPath}/`)) {
          let list = pkgFilesMap.get(pkgPath);
          if (!list) {
            list = [];
            pkgFilesMap.set(pkgPath, list);
          }
          list.push(pkgPath === "." ? file : file.slice(pkgPath.length + 1));
        }
      }
    }
    for (const [pkgPath, pkgFiles] of pkgFilesMap) {
      const isIgnored = ignoreMatchers.get(pkgPath);
      if (isIgnored && !pkgFiles.some((f) => !isIgnored(f))) continue;
      results.push({ packagePath: pkgPath, commit });
    }
  }
  return results;
}
