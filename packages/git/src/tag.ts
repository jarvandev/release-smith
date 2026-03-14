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

export async function getLatestVersionTag(
  cwd: string,
  packageName: string | null,
): Promise<string | null> {
  const tags = await getTags(cwd);
  const versionRegex = /^(\d+)\.(\d+)\.(\d+)$/;

  const parsed = tags
    .map((tag) => {
      let version: string;
      if (packageName) {
        const prefix = `${packageName}@`;
        if (!tag.startsWith(prefix)) return null;
        version = tag.slice(prefix.length);
      } else {
        if (!tag.startsWith("v")) return null;
        version = tag.slice(1);
      }
      const match = version.match(versionRegex);
      if (!match) return null;
      return {
        tag,
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
      };
    })
    .filter(Boolean) as Array<{ tag: string; major: number; minor: number; patch: number }>;

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return parsed[0].tag;
}

export async function createTag(cwd: string, tag: string): Promise<void> {
  await execGit(["tag", tag], cwd);
}
