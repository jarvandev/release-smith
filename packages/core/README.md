# @release-smith/core

Core pipeline logic for [release-smith](https://github.com/jarvandev/release-smith).

## API

### Commit Parser

- `parseConventionalCommit(hash, message, body)` - Parse a conventional commit message
- `assignCommitsToPackages(commits, filesMap, packagePaths)` - Assign commits to packages by file path

### Version Calculator

- `bumpVersion(current, level)` - Bump a SemVer version string
- `calculateVersionBumps(packages, commits)` - Calculate version bumps with dependency propagation
- `detectCircularDeps(packages)` - Detect circular dependencies in workspace

### Changelog Generator

- `generateChangelog(bump, date, repoUrl)` - Generate Keep a Changelog format output
- `insertChangelog(existing, newEntry)` - Insert new entry into existing changelog

### Releaser

- `executeRelease(options)` - Execute full release: update versions, write changelogs, create tags and GitHub Releases

## License

MIT
