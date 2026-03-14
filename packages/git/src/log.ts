import { execGit } from "./executor";

export interface RawCommit {
  hash: string;
  message: string;
  body: string;
}

const SEPARATOR = "---COMMIT_SEP---";
const FIELD_SEP = "---FIELD_SEP---";

export async function getCommits(
  cwd: string,
  fromRef: string | null,
  toRef: string,
): Promise<RawCommit[]> {
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;
  const format = [`%H`, `%s`, `%b`].join(FIELD_SEP);

  const output = await execGit(["log", range, `--format=${format}${SEPARATOR}`], cwd);

  if (!output) return [];

  return output
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split(FIELD_SEP);
      const hash = parts[0] ?? "";
      const message = parts[1] ?? "";
      const body = parts.slice(2).join(FIELD_SEP).trim();
      return { hash: hash.trim(), message: message.trim(), body };
    });
}
