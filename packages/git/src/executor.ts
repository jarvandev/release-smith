import { execFile } from "node:child_process";

export function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(" ")} failed (exit ${error.code}): ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
