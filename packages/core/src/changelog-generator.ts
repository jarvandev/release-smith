import type { ChangelogConfig, ChangelogSectionConfig } from "@release-smith/config";
import type { ConventionalCommit, VersionBump } from "./types";

interface Section {
  title: string;
  filter: (c: ConventionalCommit) => boolean;
}

export interface ChangelogOptions {
  config?: ChangelogConfig;
  /** Tag of the previous release; required to render the compare link. */
  previousTag?: string | null;
  /** Tag of the release being generated; required to render the compare link. */
  newTag?: string;
}

export function generateChangelog(
  bump: VersionBump,
  date: string,
  repoUrl: string | null,
  options?: ChangelogOptions,
): string {
  const lines: string[] = [];
  lines.push(`## [${bump.newVersion}] - ${date}`);
  lines.push("");
  if (options?.config?.compareLink && repoUrl && options.previousTag && options.newTag) {
    lines.push(`**Full Changelog**: ${repoUrl}/compare/${options.previousTag}...${options.newTag}`);
    lines.push("");
  }
  if (bump.commits.length === 0) {
    lines.push(
      bump.propagated
        ? "- Bump version due to dependency update"
        : "- Bump version due to version group alignment",
    );
    lines.push("");
    return lines.join("\n");
  }
  for (const section of resolveSections(options?.config?.sections)) {
    const matching = bump.commits.filter(section.filter);
    if (matching.length === 0) continue;
    lines.push(`### ${section.title}`);
    lines.push("");
    for (const commit of matching) lines.push(formatEntry(commit, repoUrl));
    lines.push("");
  }
  return lines.join("\n");
}

function resolveSections(configured?: ChangelogSectionConfig[]): Section[] {
  const titles = { feat: "Features", fix: "Bug Fixes" };
  const extras: Section[] = [];
  for (const entry of configured ?? []) {
    if (entry.type === "feat" || entry.type === "fix") {
      titles[entry.type] = entry.title;
    } else {
      extras.push({
        title: entry.title,
        filter: (c) => c.type === entry.type && !c.breaking,
      });
    }
  }
  return [
    { title: "Breaking Changes", filter: (c) => c.breaking },
    { title: titles.feat, filter: (c) => c.type === "feat" && !c.breaking },
    { title: titles.fix, filter: (c) => c.type === "fix" && !c.breaking },
    ...extras,
  ];
}

function formatEntry(commit: ConventionalCommit, repoUrl: string | null): string {
  const shortHash = commit.hash.slice(0, 7);
  const hashRef = repoUrl ? `[${shortHash}](${repoUrl}/commit/${commit.hash})` : shortHash;
  const scope = commit.scope ? `**${commit.scope}:** ` : "";
  const description = repoUrl
    ? commit.description.replace(/\(#(\d+)\)/g, `([#$1](${repoUrl}/pull/$1))`)
    : commit.description;
  return `- ${scope}${description} (${hashRef})`;
}

export function insertChangelog(existing: string, newEntry: string): string {
  // Strip BOM and normalize CRLF to LF to avoid mixed line endings
  const normalized = existing.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const trimmed = normalized.trimStart();
  if (!trimmed) return `# Changelog\n\n${newEntry}\n`;
  const headerMatch = trimmed.match(/^# Changelog\s*\n?$/m);
  if (headerMatch && headerMatch.index === 0) {
    // Skip any blank lines after the header, then insert the new entry
    const afterHeader = headerMatch[0].length;
    const rest = trimmed.slice(afterHeader).replace(/^\n+/, "");
    return `# Changelog\n\n${newEntry}\n${rest}`;
  }
  return `# Changelog\n\n${newEntry}\n\n${trimmed}`;
}
