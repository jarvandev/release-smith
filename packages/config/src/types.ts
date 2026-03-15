export interface PackageConfig {
  /** Whether this package should be published. */
  publish: boolean;
  /** Path to the changelog file. Defaults to <packageDir>/CHANGELOG.md. */
  changelog: string;
  /** Override the package name used in tags, changelogs, and commit messages. */
  name: string;
}

export interface BranchConfig {
  /** Pre-release identifier (e.g., "beta", "alpha", "rc"). */
  prerelease: string;
}

export interface RawConfig {
  packages?: Record<string, Partial<Pick<PackageConfig, "publish" | "changelog" | "name">>>;
  /** Branch-based release configuration. Maps branch names to release behavior. */
  branches?: Record<string, BranchConfig>;
  /**
   * Tag name format template. Supports `{version}` and `{name}` placeholders.
   * Defaults: single package = `"v{version}"`, monorepo = `"{name}@{version}"`.
   */
  tagFormat?: string;
  /** Version groups for monorepo version alignment. */
  groups?: VersionGroups;
  /** Labels to add to Release PRs. Defaults to ["autorelease: pending"]. */
  prLabels?: string[];
}

export interface VersionGroups {
  /** Fixed groups: all packages always share the same version. */
  fixed?: string[][];
  /** Linked groups: bumped packages share the highest version. */
  linked?: string[][];
}

export interface ResolvedPackage {
  /** Package name from package.json */
  name: string;
  /** Relative path from project root (e.g., "packages/core") */
  path: string;
  /** Whether to publish this package */
  publish: boolean;
  /** Absolute path to changelog file */
  changelogPath: string;
  /** Current version from package.json */
  version: string;
  /** Whether package.json has private: true */
  isPrivate: boolean;
  /** dependencies + peerDependencies that are in the workspace */
  workspaceDeps: string[];
}
