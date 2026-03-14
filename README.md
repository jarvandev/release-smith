# release-smith

Lightweight release management tool for Node.js/Bun projects. Inspired by [release-please](https://github.com/googleapis/release-please), built entirely with Bun.

## Features

- Conventional Commits parsing
- Automatic SemVer version bumping
- Keep a Changelog format changelog generation
- GitHub Release creation
- Release PR mode -- create a PR for review before publishing (verified commits)
- Monorepo support with selective publishing and dependency-driven version propagation

## Install

```bash
# npm
npm install -g release-smith

# bun
bun add -g release-smith

# or run directly
npx release-smith
bunx release-smith
```

## Quick Start

```bash
# Initialize configuration (optional, auto-detects workspace)
release-smith init

# See what would be released
release-smith status

# Preview changelog
release-smith changelog

# Execute release (dry run)
release-smith release --dry-run

# Execute release
release-smith release
```

## Configuration

Create `release-smith.json` in your project root:

```json
{
  "packages": {
    "packages/core": { "publish": false },
    "packages/cli": { "publish": true }
  }
}
```

### Rules

- **No config file**: Treated as single-package project
- **Empty packages**: Auto-detect workspace, `private: true` packages default to `publish: false`
- **Explicit entries**: Override default behavior
- **Undeclared packages**: Default to `publish: false`

## How It Works

1. Analyzes git commits since last release tag using [Conventional Commits](https://www.conventionalcommits.org/)
2. Assigns commits to packages by file path
3. Calculates version bumps: `fix:` -> patch, `feat:` -> minor, `BREAKING CHANGE` -> major
4. Propagates version bumps through workspace dependency graph
5. Generates changelog, updates `package.json` versions, creates git tags and GitHub Releases

## Monorepo Support

- Auto-detects workspace packages from `package.json` `workspaces` field
- Commits are assigned to packages based on changed file paths
- When a dependency package changes, dependent packages get at least a patch bump
- Only `dependencies` and `peerDependencies` trigger propagation (`devDependencies` are excluded)

## Release Modes

### Direct Mode (default)

Commits directly to the current branch, creates tags locally.

```bash
release-smith release                          # local commit + tag
release-smith release --push                   # + push to remote
release-smith release --push --github-release  # + create GitHub Releases
```

### Release PR Mode (recommended for CI)

Creates a Pull Request for review. After merging, a separate CI step creates tags and publishes. Merge commits are automatically marked as **Verified** by GitHub.

```bash
# Step 1: Create/update Release PR (runs on push to main)
release-smith release --pr

# Step 2: After PR is merged, create tags + GitHub Releases
release-smith release-tags --pr-number=42
```

The Release PR includes a summary table, changelogs, and machine-readable metadata for the tagging step.

## CLI Commands

### `release-smith release`

Execute the full release pipeline.

```
Options:
  --dry-run          Analyze only, no write operations
  --target           Release specific packages (comma-separated)
  --push             Push commits and tags to remote after release
  --github-release   Create GitHub Releases after push (implies --push)
  --pr               Create a Release PR instead of committing directly
  --branch           Release branch name for --pr mode (default: release/next)
  --cwd              Working directory (default: current)
```

`--pr` is mutually exclusive with `--push` and `--github-release`.

### `release-smith release-tags`

Create tags and GitHub Releases from a merged Release PR.

```
Options:
  --pr-number        The merged Release PR number (required)
  --github-release   Create GitHub Releases after tagging (default: true)
  --cwd              Working directory (default: current)
```

### `release-smith status`

View current version status and pending changes per package.

### `release-smith changelog`

Generate and preview changelog without releasing.

### `release-smith init`

Create `release-smith.json` configuration with auto-detected workspace packages.

## GitHub Integration

Set `GITHUB_TOKEN` environment variable with `contents: write` and `pull-requests: write` permissions.

- **Direct mode**: If `GITHUB_TOKEN` is not set, git tags are still created but GitHub Release creation is skipped.
- **PR mode**: `GITHUB_TOKEN` is required.

### CI Workflows

Two GitHub Actions workflows are provided:

- **`.github/workflows/release-pr.yml`** -- On push to main, runs `release-smith release --pr` to create/update the Release PR.
- **`.github/workflows/release-publish.yml`** -- On Release PR merge, runs `release-smith release-tags`, builds, and publishes to npm.

## Packages

| Package | Description |
|---------|-------------|
| [release-smith](./packages/cli) | CLI entry point |
| [@release-smith/core](./packages/core) | Commit parsing, version calculation, changelog generation, releaser |
| [@release-smith/config](./packages/config) | Configuration loading and workspace discovery |
| [@release-smith/git](./packages/git) | Git operations (log, tag, diff) |
| [@release-smith/github](./packages/github) | GitHub API client |

## Development

```bash
bun install
bun run test           # Run all tests
bun run typecheck      # Typecheck all packages
bun run lint           # Lint check
bun run check          # typecheck + lint + test
bun run dev <command>  # Run CLI locally
```

## License

MIT
