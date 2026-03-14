# Release Smith

Lightweight release management tool for Node.js/Bun, built with Bun.

## Development

- Runtime: Bun
- Test: `bun test --recursive`
- Typecheck: `bunx tsc --noEmit -p packages/<name>/tsconfig.json`
- Build binaries: `bun run scripts/build.ts`
- Run CLI locally: `bun run packages/cli/src/index.ts <command>`

## Architecture

Monorepo with 5 packages: config, git, core, github, cli.
Pipeline pattern: config -> git -> parse -> version -> changelog -> release.
See `docs/superpowers/specs/2026-03-14-release-smith-design.md` for full spec.

## Conventions

- Conventional Commits for all commit messages
- Tests use `bun:test`, git tests use real repos in temp dirs (no mocking)
- `@release-smith/<name>` package naming
