// @release-smith/core public API

export { generateChangelog, insertChangelog } from "./changelog-generator";
export { assignCommitsToPackages, parseConventionalCommit } from "./commit-parser";
export {
  applyReleaseChanges,
  buildCommitMessage,
  createReleaseTags,
  executeRelease,
  publishGitHubReleases,
  updatePackageVersion,
  updateWorkspaceDeps,
} from "./releaser";
export { formatTagName, resolveTagFormat, resolveTagPrefix } from "./tag-format";
export type {
  BumpLevel,
  ChangelogEntry,
  ConventionalCommit,
  PackageCommit,
  ReleaseResult,
  VersionBump,
} from "./types";
export type { PrereleaseOptions, RollupCutoffs } from "./version-calculator";
export {
  applyVersionGroups,
  bumpPrerelease,
  bumpVersion,
  calculateVersionBumps,
  detectCircularDeps,
} from "./version-calculator";
