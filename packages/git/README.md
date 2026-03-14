# @release-smith/git

Git operations wrapper for [release-smith](https://github.com/jarvandev/release-smith).

Uses `node:child_process` to call git commands directly. No third-party git libraries.

## API

### `execGit(args: string[], cwd: string): Promise<string>`

Execute a git command and return stdout.

### `getCommits(cwd: string, fromRef: string | null, toRef: string): Promise<RawCommit[]>`

Get commits between two refs. If `fromRef` is null, returns all commits up to `toRef`.

### `getLatestVersionTag(cwd: string, packageName: string | null): Promise<string | null>`

Find the latest SemVer tag. For monorepo, matches `<packageName>@<version>` format.

### `getChangedFiles(cwd: string, commitHash: string): Promise<string[]>`

Get list of files changed in a specific commit.

## License

MIT
