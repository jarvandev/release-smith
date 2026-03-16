import type { ConventionalCommit, VersionBump } from "./types";

const SECTION_ORDER: Array<{ title: string; filter: (c: ConventionalCommit) => boolean }> = [
  { title: "Breaking Changes", filter: (c) => c.breaking },
  { title: "Features", filter: (c) => c.type === "feat" && !c.breaking },
  { title: "Bug Fixes", filter: (c) => c.type === "fix" && !c.breaking },
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
  // Normalize CRLF to LF to avoid mixed line endings
  const normalized = existing.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return `# Changelog\n\n${newEntry}\n`;
  const headerMatch = normalized.match(/^# Changelog\s*\n?$/m);
  if (headerMatch && headerMatch.index === 0) {
    // Skip any blank lines after the header, then insert the new entry
    const afterHeader = headerMatch[0].length;
    const rest = normalized.slice(afterHeader).replace(/^\n+/, "");
    return `# Changelog\n\n${newEntry}\n${rest}`;
  }
  return `# Changelog\n\n${newEntry}\n\n${normalized}`;
}
