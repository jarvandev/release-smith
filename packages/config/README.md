# @release-smith/config

Configuration loader and workspace discovery for [release-smith](https://github.com/jarvandev/release-smith).

## API

### `loadConfig(cwd: string): Promise<RawConfig | null>`

Load `release-smith.json` from the given directory. Returns `null` if not found.

### `discoverPackages(cwd: string, config: RawConfig | null): Promise<ResolvedPackage[]>`

Discover workspace packages, resolve publish flags, and collect workspace dependency graph.

## License

MIT
