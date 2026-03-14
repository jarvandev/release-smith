# Release Smith

Lightweight release management tool for Node.js/Bun, built with Bun.

## Development

- Runtime: Bun
- Lint + Format: Biome (`biome.json`)

### Commands

```bash
bun run dev <command>      # Run CLI locally (e.g. bun run dev status)
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
Pipeline pattern: config -> git -> parse -> version -> changelog -> release.
See `docs/superpowers/specs/2026-03-14-release-smith-design.md` for full spec.

## Conventions

- Conventional Commits for all commit messages
- Tests use `bun:test`, git tests use real repos in temp dirs (no mocking)
- `@release-smith/<name>` package naming
- Use `node:` protocol for Node.js built-in imports
- Run `bun run lint:fix` before committing
