import { execGit } from "./executor";

export async function getChangedFiles(cwd: string, commitHash: string): Promise<string[]> {
  const output = await execGit(
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commitHash],
    cwd,
  );
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

const HASH_SEPARATOR = "---HASH_SEP---";

/**
 * Batch-fetch changed files for multiple commits in a single git
 * subprocess call (or a small number of batched calls for very large
 * inputs). Returns a Map from commit hash to its list of changed files.
 *
 * This avoids spawning one `git diff-tree` process per commit, which
 * is the main bottleneck when packages use `ignoreFiles` patterns.
 */
export async function getChangedFilesForCommits(
  cwd: string,
  hashes: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (hashes.length === 0) return result;

  // Process in batches to avoid exceeding OS command-line length limits.
  // Each SHA-1 hash is 40 chars; 500 hashes is well within limits.
  const BATCH_SIZE = 500;

  for (let i = 0; i < hashes.length; i += BATCH_SIZE) {
    const batch = hashes.slice(i, i + BATCH_SIZE);
    const output = await execGit(
      ["log", "--no-walk", "--name-only", `--format=${HASH_SEPARATOR}%H`, ...batch],
      cwd,
    );

    if (!output) continue;

    // Parse output: each commit section starts with HASH_SEPARATOR<hash>
    const sections = output.split(HASH_SEPARATOR).filter(Boolean);
    for (const section of sections) {
      const lines = section.split("\n").filter(Boolean);
      const hash = lines[0]?.trim();
      if (!hash) continue;
      const files = lines
        .slice(1)
        .map((f) => f.trim())
        .filter(Boolean);
      result.set(hash, files);
    }
  }

  return result;
}
