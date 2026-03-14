export interface PackageConfig {
  /** Whether this package should be published. */
  publish: boolean;
  /** Path to the changelog file. Defaults to <packageDir>/CHANGELOG.md. */
  changelog: string;
}

export interface RawConfig {
  packages?: Record<string, Partial<Pick<PackageConfig, "publish" | "changelog">>>;
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
