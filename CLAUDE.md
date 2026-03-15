# Release Smith

Lightweight release management tool for Node.js/Bun, built with Bun.

## Development

- Runtime: Bun
- Lint + Format: Biome (`biome.json`)

### Commands

```bash
bun run dev <command>      # Run CLI locally (e.g. bun run dev status)
bun run dev release --pr   # Create/update a Release PR (recommended)
bun run dev release-tags --pr-number=N  # Tag + publish from merged PR
bun run test               # Run all tests
bun run test:watch         # Run tests in watch mode
bun run typecheck          # Typecheck all packages
bun run lint               # Lint + format check (Biome)
bun run lint:fix           # Auto-fix lint + format issues
bun run check              # typecheck + lint + test (CI gate)
bun run build:binary       # Build standalone binaries
```

### Single package

```bash
bun test packages/config/  # Test one package
```

## Architecture

Monorepo with 5 packages: config, git, core, github, cli.
Pipeline: config -> git -> parse -> version -> changelog -> release.

Key modules:
- `pipeline.ts` -- orchestrates the full flow: tag lookup, commit collection, filtering, bump calculation
- `version-calculator.ts` -- bump logic, prerelease, rollup from unpublished deps, version groups
- `changelog-generator.ts` -- markdown generation (only feat/fix/breaking)
- `releaser.ts` -- file writes (package.json, CHANGELOG.md), git commit/tag
- `tag-format.ts` -- tag name resolution with `{name}` and `{version}` placeholders
- `workspace.ts` -- package discovery, config resolution, workspace dep collection

Config fields: packages (publish/name/from/changelog), tagFormat, branches, groups, prLabels.
See README.md for full configuration reference and usage documentation.

## Conventions

- Conventional Commits for all commit messages
- Tests use `bun:test`, git tests use real repos in temp dirs (no mocking)
- `@release-smith/<name>` package naming
- Use `node:` protocol for Node.js built-in imports
- Run `bun run lint:fix` before committing
