// @release-smith/core public API

export { type ChangelogOptions, generateChangelog, insertChangelog } from "./changelog-generator";
export { allFilesIgnored, createIgnoreMatcher, parseConventionalCommit } from "./commit-parser";
export {
  applyReleaseChanges,
  buildCommitMessage,
  createReleaseTags,
  detectPackageManager,
  ensureCleanWorkingTree,
  executeRelease,
  publishGitHubReleases,
  stageReleaseChanges,
  updateLockFile,
  updatePackageVersion,
  updateVersionRange,
  updateWorkspaceDeps,
} from "./releaser";
export { formatTagName, resolveTagFormat, resolveTagPrefix } from "./tag-format";
export { topologicalSort } from "./topo-sort";
export type {
  BumpLevel,
  ChangelogEntry,
  ConventionalCommit,
  ReleaseResult,
  VersionBump,
} from "./types";
export type { PrereleaseOptions } from "./version-calculator";
export {
  applyVersionGroups,
  bumpPrerelease,
  bumpVersion,
  detectCircularDeps,
  getHighestBump,
} from "./version-calculator";
