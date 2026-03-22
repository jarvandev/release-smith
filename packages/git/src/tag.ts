import { execGit } from "./executor";

export async function getTags(cwd: string): Promise<string[]> {
  try {
    const output = await execGit(["tag", "--list"], cwd);
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Find the latest stable version tag matching the given prefix from a
 * pre-fetched tag list. This is a pure function that avoids spawning a
 * subprocess, making it efficient when called for many packages against
 * the same repository.
 *
 * Only matches tags with a stable semver suffix (X.Y.Z, no pre-release).
 * Pre-release tags (e.g., v1.0.0-beta.0) are intentionally excluded so
 * the pipeline always calculates from the last stable release.
 */
export function findLatestVersionTag(tags: string[], tagPrefix: string): string | null {
  const versionRegex = /^(\d+)\.(\d+)\.(\d+)$/;

  const parsed = tags
    .map((tag) => {
      if (!tag.startsWith(tagPrefix)) return null;
      const version = tag.slice(tagPrefix.length);
      const match = version.match(versionRegex);
      if (!match?.[1] || !match[2] || !match[3]) return null;
      return {
        tag,
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
      };
    })
    .filter(Boolean) as Array<{
    tag: string;
    major: number;
    minor: number;
    patch: number;
  }>;

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return parsed[0]?.tag ?? null;
}

/**
 * Find the latest stable version tag matching the given prefix.
 * Convenience wrapper that fetches tags from the repository and delegates
 * to {@link findLatestVersionTag}.
 */
export async function getLatestVersionTag(cwd: string, tagPrefix: string): Promise<string | null> {
  const tags = await getTags(cwd);
  return findLatestVersionTag(tags, tagPrefix);
}

export async function tagExists(cwd: string, tagName: string): Promise<boolean> {
  const tags = await getTags(cwd);
  return tags.includes(tagName);
}

export async function getTagCommit(cwd: string, tagName: string): Promise<string | null> {
  try {
    return await execGit(["rev-parse", tagName], cwd);
  } catch {
    return null;
  }
}

export async function createTag(cwd: string, tag: string): Promise<void> {
  await execGit(["tag", tag], cwd);
}
