export interface PackageConfig {
  /** Whether this package should be published. */
  publish: boolean;
  /** Path to the changelog file. Defaults to <packageDir>/CHANGELOG.md. */
  changelog: string;
  /** Override the package name used in tags, changelogs, and commit messages. */
  name: string;
  /** Starting commit hash. Only commits after this are considered for the first release. */
  from: string;
  /** Glob patterns for files to ignore when assigning commits to this package. */
  ignoreFiles: string[];
  /** Extra workspace package names to treat as dependencies for propagation and rollup. */
  extraDeps: string[];
}

export interface BranchConfig {
  /** Pre-release identifier (e.g., "beta", "alpha", "rc"). */
  prerelease: string;
}

export interface ChangelogSectionConfig {
  /** Conventional commit type this section collects (e.g., "feat", "perf"). */
  type: string;
  /** Section heading rendered in the changelog. */
  title: string;
}

export interface ChangelogConfig {
  /**
   * Changelog sections. An entry whose type matches a built-in section
   * (`feat`, `fix`) overrides its title. Entries with other types add
   * sections after the built-in ones, in config order. Extra types never
   * affect version bump calculation.
   */
  sections?: ChangelogSectionConfig[];
  /**
   * Append a compare link (`**Full Changelog**: <repoUrl>/compare/<prev>...<new>`)
   * under each version header. Omitted on first releases. Defaults to false.
   */
  compareLink?: boolean;
}

export interface RawConfig {
  /** Glob patterns for files to ignore when assigning commits to packages (applied globally). */
  ignoreFiles?: string[];
  packages?: Record<
    string,
    Partial<
      Pick<PackageConfig, "publish" | "changelog" | "name" | "from" | "ignoreFiles" | "extraDeps">
    >
  >;
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
  /** Changelog rendering options. */
  changelog?: ChangelogConfig;
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
  /** Starting commit hash for first release (used when no tag exists) */
  from?: string;
  /** Merged glob patterns (global + per-package) for ignoring files in commit assignment. */
  ignoreFiles: string[];
}
