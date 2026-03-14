# @release-smith/github

GitHub API client for [release-smith](https://github.com/jarvandev/release-smith).

## API

### `parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null`

Parse GitHub repository owner and name from a remote URL (HTTPS or SSH).

### `createGitHubRelease(options): Promise<CreateReleaseResult>`

Create a GitHub Release. Skips with a warning if `token` is null.

## License

MIT
