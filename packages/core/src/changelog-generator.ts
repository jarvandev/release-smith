import type { ConventionalCommit, VersionBump } from "./types";

const SECTION_ORDER: Array<{ title: string; filter: (c: ConventionalCommit) => boolean }> = [
  { title: "Breaking Changes", filter: (c) => c.breaking },
  { title: "Features", filter: (c) => c.type === "feat" && !c.breaking },
  { title: "Bug Fixes", filter: (c) => c.type === "fix" && !c.breaking },
  { title: "Other Changes", filter: (c) => c.type !== "feat" && c.type !== "fix" && !c.breaking },
];

export function generateChangelog(bump: VersionBump, date: string, repoUrl: string | null): string {
  const lines: string[] = [];
  lines.push(`## [${bump.newVersion}] - ${date}`);
  lines.push("");
  if (bump.commits.length === 0) {
    lines.push(
      bump.propagated
        ? "- Bump version due to dependency update"
        : "- Bump version due to version group alignment",
    );
    lines.push("");
    return lines.join("\n");
  }
  for (const section of SECTION_ORDER) {
    const matching = bump.commits.filter(section.filter);
    if (matching.length === 0) continue;
    lines.push(`### ${section.title}`);
    lines.push("");
    for (const commit of matching) lines.push(formatEntry(commit, repoUrl));
    lines.push("");
  }
  return lines.join("\n");
}

function formatEntry(commit: ConventionalCommit, repoUrl: string | null): string {
  const shortHash = commit.hash.slice(0, 7);
  const hashRef = repoUrl ? `[${shortHash}](${repoUrl}/commit/${commit.hash})` : shortHash;
  const scope = commit.scope ? `**${commit.scope}:** ` : "";
  return `- ${scope}${commit.description} (${hashRef})`;
}

export function insertChangelog(existing: string, newEntry: string): string {
  if (!existing.trim()) return `# Changelog\n\n${newEntry}\n`;
  const headerMatch = existing.match(/^# Changelog\s*\n/);
  if (headerMatch) {
    const insertPos = headerMatch.index! + headerMatch[0].length;
    return `${existing.slice(0, insertPos)}\n${newEntry}\n${existing.slice(insertPos)}`;
  }
  return `# Changelog\n\n${newEntry}\n\n${existing}`;
}
