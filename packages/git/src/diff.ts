import { execGit } from "./executor";

export async function getChangedFiles(cwd: string, commitHash: string): Promise<string[]> {
  const output = await execGit(
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commitHash],
    cwd,
  );
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}
