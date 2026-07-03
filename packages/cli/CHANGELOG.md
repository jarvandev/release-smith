# Changelog

## [0.9.1] - 2026-03-22

### Bug Fixes

- improve idempotency and resilience for CI retry scenarios (#13) ([021d62f](https://github.com/jarvandev/release-smith/commit/021d62ffd227d3329d32b8f48fe94ed0b4369dce))
- strengthen input validation and error reporting (#11) ([64448cd](https://github.com/jarvandev/release-smith/commit/64448cd83a8e82cfa7807a3a219a4eefe5d2ce0f))
- allow $schema key in config file without warning ([6558c0f](https://github.com/jarvandev/release-smith/commit/6558c0f0918e5e21c6a0e96aa42c994d0dbcc159))
- prevent changelog double header and validate tag format constraints (#10) ([ecf5bb7](https://github.com/jarvandev/release-smith/commit/ecf5bb700b626406ce4178e400db112033ebf34d))

## [0.9.0] - 2026-03-19

### Features

- update lock file after version bumps in release flow ([2d94f13](https://github.com/jarvandev/release-smith/commit/2d94f1373b5be2c9f636c5bf489c0bcd56bba70e))

### Bug Fixes

- prevent phantom dependency-update bumps from stale unpublished dep commits ([b7388a0](https://github.com/jarvandev/release-smith/commit/b7388a0e4655b1afc5878dcb2eeb25a8439438bf))

## [0.8.0] - 2026-03-18

### Features

- auto-detect new packages when running init with existing config ([3a402a7](https://github.com/jarvandev/release-smith/commit/3a402a7179fe915e6735d09bba0b7034d1f0aeb7))

## [0.7.1] - 2026-03-17

### Bug Fixes

- preserve version range format and fix prerelease in fixed groups ([c12998a](https://github.com/jarvandev/release-smith/commit/c12998a3faa398c447f9a0cdeb5ce62c6e8e36f3))

## [0.7.0] - 2026-03-16

### Features

- add extraDeps config for explicit dependency relationships ([3eebf5c](https://github.com/jarvandev/release-smith/commit/3eebf5cf13c3ee1b312a4f5baa36d97145d83737))

### Bug Fixes

- read CLI version from package.json instead of hardcoded value ([55ba9e9](https://github.com/jarvandev/release-smith/commit/55ba9e94d0e34f4922eebc45ebe3b4059d96eda8))
- insertChangelog handles CRLF and missing trailing newline ([c62805c](https://github.com/jarvandev/release-smith/commit/c62805cc00bd48399e5b221526de2616fd8692d3))
- ignoreFiles patterns now match dotfiles ([362c59b](https://github.com/jarvandev/release-smith/commit/362c59b6847aeaf5636e8371785904bc4a4828a0))

## [0.6.0] - 2026-03-16

### Features

- add ignoreFiles config to filter files from triggering releases ([1ea61e7](https://github.com/jarvandev/release-smith/commit/1ea61e7515cd132acf07b54c37bab8a61d1fe241))
- add JSON Schema for release-smith.json config ([4957cf0](https://github.com/jarvandev/release-smith/commit/4957cf0447ffa91c386d25b872e6c7ad78373af0))

## [0.5.1] - 2026-03-15

### Bug Fixes

- prevent duplicate blank lines in changelog insertion ([25efb95](https://github.com/jarvandev/release-smith/commit/25efb95ac5579f66e21f21ed585fd21fe2c49bbd))
- default listed packages to publish:true when not explicitly set ([281f3dc](https://github.com/jarvandev/release-smith/commit/281f3dc433d11c6acdd8f94c51bfb0b401bc9c99))

## [0.5.0] - 2026-03-15

### Features

- add GitHub Actions outputs to release-tags command ([bfbef9a](https://github.com/jarvandev/release-smith/commit/bfbef9a408ec20cbf1f89cd8c4fbd7d72dce704f))

## [0.4.0] - 2026-03-15

### Features

- add "from" config to set starting commit for new packages ([4162f6e](https://github.com/jarvandev/release-smith/commit/4162f6e479b260ca660390cb34c07ee2b2b849a2))
- add automatic PR label support ([5615df6](https://github.com/jarvandev/release-smith/commit/5615df64bb3877e56661e8fc7a067f17af6681a0))
- add linked/fixed version groups ([4b3010f](https://github.com/jarvandev/release-smith/commit/4b3010f51ebd6775b2a19e9c2f6fcb5f3e376f60))
- add configurable tag format ([577c5db](https://github.com/jarvandev/release-smith/commit/577c5dbc9392e528eaf1127e1f1a43674ae907ba))
- add pre-release version support ([0829f5e](https://github.com/jarvandev/release-smith/commit/0829f5e3790b8a285139ac79e267aaf70ff8ed7c))
- add configurable package name override and devDependencies tracking ([211f25e](https://github.com/jarvandev/release-smith/commit/211f25e6410f4034f07db0bb5a4ebe704aaf9df2))
- roll up commits from unpublished deps into parent changelog ([0eabd82](https://github.com/jarvandev/release-smith/commit/0eabd82af5080d99b72a8c53e965993cac53c7f4))

### Bug Fixes

- per-consumer rollup filtering for multi-published-package monorepos ([027a7f6](https://github.com/jarvandev/release-smith/commit/027a7f6489a49c5fc110ec532646ec77be369365))
- exclude non-feat/fix/breaking commits from changelog ([3283094](https://github.com/jarvandev/release-smith/commit/3283094afbe04843d83e6233c12755146c7aab96))
- address code review findings ([16e0213](https://github.com/jarvandev/release-smith/commit/16e0213e0e467bcbd1bfa160a5fde31f4ac54331))

## [0.3.0] - 2026-03-14

### Features

- add Release PR mode for verified commits ([0256b84](https://github.com/jarvandev/release-smith/commit/0256b842a9bce5420386290f382343d2fac013ac))

## [0.2.0] - 2026-03-14

### Features

- **cli:** implement CLI with release, status, changelog, and init commands ([d50a73b](https://github.com/jarvandev/release-smith/commit/d50a73b05b5fa10a14972862b1db4a3dfacfbb93))

### Bug Fixes

- separate GitHub Release creation from local release operations ([a65e42a](https://github.com/jarvandev/release-smith/commit/a65e42a20fef47ba5201b4d80c5918877a0bae6a))

### Other Changes

- only publish CLI package with npm best practices ([dfacdc6](https://github.com/jarvandev/release-smith/commit/dfacdc6e2df679c2f3156be7de66a4b1b6d19fba))
- prepare all packages for npm publishing ([1e15e25](https://github.com/jarvandev/release-smith/commit/1e15e25b93a4be915c2a6b495e2c7232021cbe53))
- replace Bun-specific APIs with Node.js standard library ([53c497b](https://github.com/jarvandev/release-smith/commit/53c497be0f558e2b80e4d640fc6d9873116bb7f9))
- simplify build to inline CLI commands ([f061a8b](https://github.com/jarvandev/release-smith/commit/f061a8b8b470fd40c6fe73e2ecb12296202f41cc))
- move build script to cli package ([c66ce1c](https://github.com/jarvandev/release-smith/commit/c66ce1c07bbd8ea39f0b71999066b9bad383a5a6))
- modernize tsconfig with dev-tools base config ([162cf4a](https://github.com/jarvandev/release-smith/commit/162cf4a6a22e5c00855bc54a708d10ec0d86e4bd))
- **release:** release-smith@0.2.0 ([5a96795](https://github.com/jarvandev/release-smith/commit/5a96795656ab700e46ea3f74e36a9dd75e091d9e))
- replace hand-written CLI and semver with citty and semver ([bae75a6](https://github.com/jarvandev/release-smith/commit/bae75a64336482a1355e93c95ada0875a1b6222f))
- add Biome linter/formatter and improve dev experience ([191a650](https://github.com/jarvandev/release-smith/commit/191a6502751fdfff3c26a2df762ec641372a7e22))
- initialize monorepo workspace structure ([ba34c5e](https://github.com/jarvandev/release-smith/commit/ba34c5eafb3b7eccc85abbc6280a56d12ce44320))

