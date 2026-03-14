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
 * Find the latest stable version tag matching the given prefix.
 * Only matches tags with a stable semver suffix (X.Y.Z, no pre-release).
 * Pre-release tags (e.g., v1.0.0-beta.0) are intentionally excluded so
 * the pipeline always calculates from the last stable release.
 */
export async function getLatestVersionTag(cwd: string, tagPrefix: string): Promise<string | null> {
  const tags = await getTags(cwd);
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

export async function createTag(cwd: string, tag: string): Promise<void> {
  await execGit(["tag", tag], cwd);
}
