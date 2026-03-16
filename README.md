# release-smith

Lightweight release management tool for Node.js/Bun projects. Inspired by [release-please](https://github.com/googleapis/release-please), built entirely with Bun.

## Features

- **Conventional Commits** -- parses `feat:`, `fix:`, `BREAKING CHANGE` to determine version bumps
- **Automatic SemVer** -- `fix:` = patch, `feat:` = minor, breaking = major
- **Changelog generation** -- only meaningful changes (feat/fix/breaking), no noise from chore/test/refactor
- **GitHub Release creation** -- creates GitHub Releases with changelog as body
- **Release PR mode** -- create a PR for review before publishing, merge commits are marked as Verified
- **Monorepo support** -- workspace auto-detection, per-package changelogs, dependency-driven propagation
- **Changelog rollup** -- commits from unpublished sub-packages merge into the parent changelog
- **Pre-release versions** -- branch-based (`branches` config) or CLI flag (`--prerelease beta`)
- **Configurable tag format** -- `v{version}`, `{name}@v{version}`, or any custom template
- **Version groups** -- fixed (all same version) and linked (bumped packages share highest)
- **Auto PR labels** -- configurable labels added to Release PRs
- **Package name override** -- custom names for tags, changelogs, and commit messages
- **`ignoreFiles`** -- glob patterns to exclude test/doc files from triggering releases
- **`from` baseline** -- prevent new packages from including entire git history on first release
- **GitHub Actions outputs** -- `releases_created`, per-package version/tag outputs for CI pipelines

## Install

```bash
npm install -g release-smith
# or
bun add -g release-smith
# or run directly
npx release-smith
bunx release-smith
```

## Quick Start

```bash
# 1. Initialize configuration (auto-detects workspace packages)
release-smith init

# 2. See what would be released
release-smith status

# 3. Preview changelog
release-smith changelog

# 4. Execute release (dry run first)
release-smith release --dry-run

# 5. Execute release
release-smith release --push --github-release
```

## Configuration

Create `release-smith.json` in your project root, or run `release-smith init` to auto-generate it.

### Minimal (single published package)

```json
{
  "packages": {
    "packages/cli": {}
  }
}
```

Only list packages you want to publish. Unlisted packages default to `publish: false`.

### Full Example

```json
{
  "packages": {
    "packages/cli": {
      "publish": true,
      "name": "my-cli",
      "from": "abc1234",
      "changelog": "CHANGELOG.md"
    },
    "packages/core": {
      "publish": false
    }
  },
  "tagFormat": "{name}@v{version}",
  "branches": {
    "next": { "prerelease": "beta" },
    "alpha": { "prerelease": "alpha" }
  },
  "groups": {
    "fixed": [["@myapp/core", "@myapp/cli"]],
    "linked": [["@myapp/ui", "@myapp/theme"]]
  },
  "prLabels": ["autorelease: pending"],
  "ignoreFiles": ["**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*.md"]
}
```

### Config Reference

| Field | Type | Description |
|-------|------|-------------|
| `packages` | `Record<string, PackageConfig>` | Map of package path to config. Listed = managed; unlisted = `publish: false` |
| `packages.*.publish` | `boolean` | Whether to publish this package (default: `true` if listed) |
| `packages.*.name` | `string` | Override package name for tags/changelogs/commits (default: `package.json` name) |
| `packages.*.from` | `string` | Starting commit hash. Only commits after this are considered for the first release |
| `packages.*.changelog` | `string` | Custom changelog file path (default: `<packageDir>/CHANGELOG.md`) |
| `packages.*.ignoreFiles` | `string[]` | Per-package glob patterns for files to ignore (merged with global, relative to package dir) |
| `ignoreFiles` | `string[]` | Global glob patterns for files to ignore when assigning commits (relative to each package dir) |
| `tagFormat` | `string` | Tag template with `{name}` and `{version}` placeholders. Must include `{version}` |
| `branches` | `Record<string, BranchConfig>` | Map of branch name to pre-release config |
| `branches.*.prerelease` | `string` | Pre-release identifier (e.g., `"beta"`, `"alpha"`, `"rc"`) |
| `groups.fixed` | `string[][]` | Package groups that always share the same version |
| `groups.linked` | `string[][]` | Bumped packages in a group share the highest version |
| `prLabels` | `string[]` | Labels to add to Release PRs (default: `["autorelease: pending"]`) |

### Tag Format

| Scenario | Default | Example |
|----------|---------|---------|
| Single package | `v{version}` | `v1.0.0` |
| Monorepo | `{name}@{version}` | `@myapp/cli@1.0.0` |
| Custom | `{name}@v{version}` | `@myapp/cli@v1.0.0` |

## How It Works

### Pipeline

```
1. Load config          -- read release-smith.json
2. Discover packages    -- resolve workspace packages from package.json
3. Find latest tags     -- per-package tag lookup (only stable versions)
4. Collect commits      -- git log from last tag to HEAD
5. Parse commits        -- extract type, scope, description, breaking flag
6. Assign to packages   -- match changed file paths to package directories
7. Apply ignoreFiles    -- skip commits whose matched files are all ignored
8. Filter by baseline   -- per-package tag timestamp or "from" config
9. Calculate bumps      -- highest bump level wins (major > minor > patch)
10. Roll up             -- merge unpublished dep commits into parent
11. Apply groups        -- enforce fixed/linked version constraints
12. Generate output     -- changelog, version bump, tag name
```

### Version Bump Rules

| Commit Type | Bump Level | In Changelog |
|------------|-----------|-------------|
| `feat:` | minor | Yes (Features) |
| `fix:` | patch | Yes (Bug Fixes) |
| `feat!:` / `BREAKING CHANGE:` | major | Yes (Breaking Changes) |
| `chore:`, `test:`, `refactor:`, `docs:`, etc. | none | No |

### Monorepo Behavior

**Commit assignment**: commits are assigned to packages based on which files were changed. A commit modifying `packages/core/src/index.ts` belongs to the `packages/core` package. A commit touching multiple packages is assigned to all of them.

**Dependency propagation**: when package A changes and package B depends on A:

| A's publish status | B's behavior | B's changelog |
|-------------------|-------------|--------------|
| `publish: true` | patch bump, `propagated: true` | "Bump version due to dependency update" |
| `publish: false` | inherits A's bump level | A's commits merged into B's changelog |

**Rollup**: if a sub-package has `publish: false`, its commits are "rolled up" into the parent published package's changelog. This is useful for monorepos where internal packages are bundled into a single published CLI or library. The rollup walks the dependency graph transitively -- if A depends on B depends on C (both unpublished), A gets commits from both B and C.

**Workspace deps**: `dependencies`, `peerDependencies`, and `devDependencies` that reference workspace packages are all tracked for propagation and rollup.

### Pre-release Versions

Pre-release mode is activated by CLI flag or branch config:

```bash
# CLI flag (highest priority)
release-smith release --prerelease beta

# Or via branch config in release-smith.json
# When on the "next" branch, automatically uses "beta" pre-release
```

Algorithm: calculates the target stable version from the last stable tag, then either increments the pre-release number (if already targeting the same base) or starts a new sequence.

```
Last stable: 1.0.0, commit: feat → target: 1.1.0

Current 1.0.0       → 1.1.0-beta.0  (new sequence)
Current 1.1.0-beta.0 → 1.1.0-beta.1  (increment)
Current 1.1.0-beta.5 → 1.1.0-beta.6  (increment)
Current 1.1.0-beta.3, commit: feat! → 2.0.0-beta.0  (level escalated, new sequence)
```

### Version Groups

**Fixed groups**: all packages in the group always share the same version. When any package is bumped, all others are bumped to match. Packages with no changes are added with empty changelogs.

```json
{ "groups": { "fixed": [["@myapp/core", "@myapp/cli"]] } }
```

**Linked groups**: only bumped packages share the highest version. Packages with no changes are left alone.

```json
{ "groups": { "linked": [["@myapp/ui", "@myapp/theme"]] } }
```

### The `from` Field

When a new package is added to an existing monorepo, it has no release tag. Without a baseline, the pipeline would include the entire git history in its first release.

The `from` field sets a starting commit -- only commits after this hash are considered:

```json
{
  "packages": {
    "packages/new-pkg": { "from": "abc1234" }
  }
}
```

`release-smith init` automatically sets `from` to the current HEAD for all packages. After the first release creates a tag, `from` is no longer needed (the tag takes precedence).

## Release Modes

### Direct Mode (default)

Commits directly to the current branch and creates tags locally.

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

The Release PR body includes:
- A summary table with package names, versions, and tags
- Per-package changelog sections
- Hidden machine-readable metadata (`<!-- release-smith:metadata ... -->`) used by `release-tags`

## CLI Reference

### `release-smith init`

Create `release-smith.json` with auto-detected workspace packages. Sets `from` to current HEAD for all packages.

### `release-smith status`

Show pending version bumps and their commits. Useful for previewing what the next release will include.

### `release-smith changelog`

Generate and preview changelog output without making any changes.

### `release-smith release`

Execute the full release pipeline.

| Flag | Description |
|------|-------------|
| `--dry-run` | Analyze only, no file writes or git operations |
| `--target <pkgs>` | Release specific packages only (comma-separated names) |
| `--push` | Push commits and tags to remote after release |
| `--github-release` | Create GitHub Releases (implies `--push`) |
| `--prerelease <id>` | Pre-release identifier (e.g., `beta`). Overrides branch config |
| `--pr` | Create a Release PR instead of committing directly |
| `--branch <name>` | Release branch name for `--pr` mode (default: `release/next`) |
| `--cwd <dir>` | Working directory |

`--pr` is mutually exclusive with `--push` and `--github-release`.

### `release-smith release-tags`

Create tags and GitHub Releases from a merged Release PR.

| Flag | Description |
|------|-------------|
| `--pr-number <n>` | The merged Release PR number (required) |
| `--github-release` | Create GitHub Releases after tagging (default: `true`) |
| `--cwd <dir>` | Working directory |

When running in GitHub Actions, this command automatically writes outputs to `$GITHUB_OUTPUT`:

| Output | Description |
|--------|-------------|
| `releases_created` | `"true"` if any releases were created |
| `<name>--release_created` | `"true"` for each released package |
| `<name>--tag_name` | Tag name (e.g., `release-smith@1.0.0`) |
| `<name>--version` | Version string (e.g., `1.0.0`) |
| `all` | JSON array of all releases |

Package names are sanitized for output keys: `@scope/pkg` becomes `scope-pkg`.

## GitHub Actions

### Required Permissions

```yaml
permissions:
  contents: write        # push commits, tags, create releases
  pull-requests: write   # create/update Release PRs
```

### Workflow Setup

Two workflows cover the full release cycle:

**Workflow 1: Create Release PR** (on push to main)

```yaml
# .github/workflows/release-pr.yml
name: Release PR

on:
  push:
    branches: [main]

concurrency:
  group: release-pr
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  release-pr:
    runs-on: ubuntu-latest
    if: >-
      !startsWith(github.event.head_commit.message, 'chore(release):')
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2

      - run: bun install --frozen-lockfile

      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Create or update Release PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bunx release-smith release --pr
```

**Workflow 2: Publish on PR merge** (on Release PR closed)

```yaml
# .github/workflows/release.yml
name: Release Publish

on:
  pull_request:
    types: [closed]
    branches: [main]

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    if: >-
      github.event.pull_request.merged == true &&
      startsWith(github.event.pull_request.title, 'chore(release):')
    outputs:
      releases_created: ${{ steps.release.outputs.releases_created }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2

      - run: bun install --frozen-lockfile

      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Create tags and GitHub Releases
        id: release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: bunx release-smith release-tags --pr-number=${{ github.event.pull_request.number }}

  # Add downstream jobs here:
  publish-npm:
    needs: release
    if: needs.release.outputs.releases_created == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "publish to npm..."
```

### Triggering Downstream Workflows

`GITHUB_TOKEN` cannot trigger other workflows (GitHub's infinite loop prevention). Two options:

**Option 1: Same workflow with outputs (recommended)**

Use `release-tags` outputs to conditionally run downstream jobs in the same workflow (shown above). No extra tokens needed.

**Option 2: GitHub App Token for cross-workflow triggers**

If you need to trigger a separate workflow (e.g., `on: release` or `on: push: tags`), use a [GitHub App Token](https://github.com/actions/create-github-app-token):

```yaml
- uses: actions/create-github-app-token@v2
  id: app-token
  with:
    app-id: ${{ vars.APP_ID }}
    private-key: ${{ secrets.APP_PRIVATE_KEY }}

- name: Create tags and GitHub Releases
  env:
    GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}
  run: bunx release-smith release-tags --pr-number=${{ github.event.pull_request.number }}
```

Tags and releases created with the App Token will trigger `on: push: tags` and `on: release` workflows.

## Packages

| Package | Description |
|---------|-------------|
| [release-smith](./packages/cli) | CLI entry point |
| [@release-smith/core](./packages/core) | Version calculation, changelog generation, releaser |
| [@release-smith/config](./packages/config) | Configuration loading and workspace discovery |
| [@release-smith/git](./packages/git) | Git operations (log, tag, diff) |
| [@release-smith/github](./packages/github) | GitHub API client (releases, PRs, labels) |

## Development

```bash
bun install
bun run dev <command>  # Run CLI locally (e.g., bun run dev status)
bun run test           # Run all tests
bun run typecheck      # Typecheck all packages
bun run lint           # Lint + format check (Biome)
bun run lint:fix       # Auto-fix lint + format
bun run check          # typecheck + lint + test (CI gate)
```

## License

MIT
