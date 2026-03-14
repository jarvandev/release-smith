# Release Smith - Design Specification

A lightweight release management tool inspired by release-please, built entirely with Bun. Supports only Node.js/Bun ecosystem.

## Requirements

- Conventional Commits parsing with strict SemVer version derivation
- Automatic changelog generation (Keep a Changelog format)
- GitHub Release creation
- Monorepo support with selective publishing and dependency-driven version propagation
- CLI-first, published as both npm package and standalone binary
- JSON configuration file

## Architecture: Pipeline Pattern

The release process is decomposed into independent, composable pipeline stages:

```
Load Config → Discover Packages → Git Analyzer → Commit Parser → Version Calculator → Changelog Generator → Releaser
```

Each stage has well-defined input/output types. Monorepo logic is handled by dispatching per-package at the Commit Parser stage, with subsequent stages executing per-package.

## Project Structure (Monorepo)

```
release-smith/
  packages/
    core/            # Pipeline logic: commit parsing, version calculation, changelog generation
    git/             # Git operations: log, tag, diff (via Bun.spawn, no third-party git libs)
    github/          # GitHub API: create Release, read repo info
    config/          # Configuration loading and validation
    cli/             # CLI entry point, command definitions, orchestrator
  docs/
  .github/
  package.json       # workspace root
  bunfig.toml
```

### Package Dependencies

- `cli` depends on all other packages (the only published package)
- `core` depends on `git`, `config` (via interfaces for testability)
- `github` is standalone (only GitHub API concerns)
- `config` is standalone (configuration schema and loader)
- `git` is standalone (git command wrapper)

## Data Flow

```
                         ┌─────────────────────────────────┐
                         │          CLI (orchestrator)       │
                         └──────────────┬──────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
   Load Config                   Discover Packages            Git Analyzer
   (config pkg)                  (workspace detection)        (git pkg)
          │                             │                             │
          └─────────────────────────────┼─────────────────────────────┘
                                        ▼
                              Commit Parser (core)
                         Parse conventional commits
                         Assign to packages by file path
                                        │
                                        ▼
                            Version Calculator (core)
                         Per-package version calculation
                         Dependency-driven propagation
                                        │
                                        ▼
                          Changelog Generator (core)
                         Per-package changelog generation
                         Keep a Changelog format
                                        │
                                        ▼
                              Releaser (core + github)
                         Update package.json versions
                         Update inter-package dependencies
                         Create git tags and GitHub Releases
```

## Configuration

Configuration file: `release-smith.json` at project root.

```json
{
  "packages": {
    "packages/core": {
      "publish": false
    },
    "packages/utils": {
      "publish": false
    },
    "packages/cli": {
      "publish": true,
      "changelog": "packages/cli/CHANGELOG.md"
    }
  }
}
```

### Rules

- **No config file:** Treat as single-package project (analyze root `package.json`).
- **Config file with empty/missing `packages`:** Auto-detect all workspace packages. Packages with `private: true` in their `package.json` default to `publish: false`; non-private packages default to `publish: true`.
- **Explicit `packages` entries:** Override default behavior for declared packages.
- **Undeclared workspace packages:** Default to `publish: false`.
- **`changelog` field:** Optional, defaults to `<package-dir>/CHANGELOG.md`.
- **Dependency graph:** Auto-detected from each package's `package.json` `dependencies` and `peerDependencies` only. `devDependencies` are excluded from propagation since they do not affect published output.

## CLI Commands

```bash
# Core command - execute full release pipeline
release-smith release
  --dry-run          # Analyze and output results only, no write operations
  --target <pkg>     # Release only specified packages (can be used multiple times)
  --cwd <dir>        # Specify working directory, defaults to current directory

# Utility commands
release-smith init          # Interactive generation of release-smith.json
release-smith status        # View current version status and pending changes per package
release-smith changelog     # Generate changelog only, no release
```

## Edge Cases and Decisions

### First Release (No Existing Tags)

When no version tags exist in the repository, the tool reads the current `version` from each package's `package.json` as the baseline. If commits since the initial commit warrant a bump, the version is bumped from that baseline. If no conventional commits exist, the current version is used as-is for the first release.

### Pre-1.0 Versions

Versions `0.x.y` follow the same rules as post-1.0: `BREAKING CHANGE` still bumps major (0.x.y -> 1.0.0). This is an intentional simplification -- if a project wants to stay in 0.x, it should avoid `BREAKING CHANGE` markers.

### GitHub Authentication

The tool uses the `GITHUB_TOKEN` environment variable for GitHub API access. Required permission: `contents: write`. If `GITHUB_TOKEN` is not set, git tag creation still works but GitHub Release creation is skipped with a warning.

### Tag Format

- **Monorepo:** `<pkg-name>@<version>` (e.g., `cli@1.2.0`)
- **Single-package:** `v<version>` (e.g., `v1.2.0`)

### `--target` and Dependency Propagation

When `--target <pkg>` is specified, only the targeted packages are released. Dependency propagation is still calculated but only applied to targeted packages. The tool warns if untargeted packages have pending changes that would normally trigger a release.

### Circular Dependencies

If circular dependencies are detected in the workspace dependency graph, the tool exits with an error and reports the cycle.

### Failure and Recovery

Releaser executes write operations in order: update files -> git commit -> git tag -> GitHub Release. If GitHub Release creation fails (network, auth, rate limit), local changes (commit + tag) are preserved. The user can retry with `release-smith release` which detects existing tags and only retries the GitHub Release. File writes and git operations are not rolled back as they represent correct state.

### Changelog Commit Hash Links

Repository URL is auto-detected from `git remote get-url origin`. If no remote exists, commit hashes are rendered without links.

### Scope Field

The `scope` field in conventional commits is recorded in metadata but NOT used for package assignment. Package assignment is strictly path-based. Scope appears in changelog entries as-is.

## Core Modules

### Git Analyzer (`packages/git`)

Wraps all git operations via `Bun.spawn`, providing structured data.

- Get commit list between two refs (`git log`)
- Get changed files per commit (`git diff-tree`)
- Read and create tags (`git tag`)
- Find latest version tag (sorted by SemVer)

### Commit Parser (`packages/core`)

Parses conventional commit messages and assigns them to packages.

- Parse format: `type(scope): description`, extract type, scope, description, body, footer
- Recognize `BREAKING CHANGE` footer and `!` suffix (e.g., `feat!:`)
- Assign commits to packages by file path (from Git Analyzer's changed file list)
- A single commit can belong to multiple packages
- Non-conventional commits are ignored (do not participate in version calculation)

### Version Calculator (`packages/core`)

Computes new version numbers per package based on commit types.

- Version derivation rules:
  - `fix:` -> patch
  - `feat:` -> minor
  - `BREAKING CHANGE` / `!` -> major
  - Highest level wins
- **Dependency propagation:** Build workspace dependency graph. When a package has changes, propagate upward through dependents, triggering at least a patch bump.
- Only compute final versions for `publish: true` packages, but non-published package changes still propagate.

### Changelog Generator (`packages/core`)

Generates Keep a Changelog format output.

- Group by version, within each version group by type:
  - `### Breaking Changes`
  - `### Features`
  - `### Bug Fixes`
  - Other types under `### Other Changes`
- Each entry includes short commit hash link
- Append to existing CHANGELOG.md, preserving history

### Releaser (`packages/core` + `packages/github`)

Executes all write operations.

- Update `version` field in each package's `package.json`
- Update inter-package dependency versions within workspace
- Write CHANGELOG.md files
- Create git commit and tags (see Tag Format in Edge Cases section)
- Create GitHub Release via API (body = current version's changelog content)

## Testing Strategy

- **Framework:** Bun built-in `bun:test`
- **Unit tests:** Each core module has independent unit tests
  - Commit Parser: various commit message format parsing
  - Version Calculator: version derivation, dependency propagation logic
  - Changelog Generator: output format correctness
  - Config: loading, validation, defaults
- **Integration tests:** Initialize real git repos in temp directories, simulate full commit-to-release flow
- **No git mocking:** Git operation tests use real git commands and temp repos

## Build and Distribution

- **npm package:** `cli` package published to npm with `bin` field. Users run via `bunx release-smith` or `npx release-smith`.
- **Standalone binary:** Compiled via `bun build --compile`, attached as GitHub Release assets.
- **Target platforms:** darwin-arm64, darwin-x64, linux-x64
