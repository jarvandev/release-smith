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
export type { PrereleaseOptions } from "./version-calculator";
export {
  bumpPrerelease,
  bumpVersion,
  calculateVersionBumps,
  detectCircularDeps,
} from "./version-calculator";
