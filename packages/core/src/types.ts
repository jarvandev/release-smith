export type BumpLevel = "major" | "minor" | "patch";

export interface ConventionalCommit {
  hash: string;
  type: string;
  scope: string | null;
  description: string;
  body: string;
  breaking: boolean;
  rawMessage: string;
}

export interface PackageCommit {
  packagePath: string;
  commit: ConventionalCommit;
}

export interface VersionBump {
  packagePath: string;
  /** Canonical npm name (keys groups, propagation, and dependency updates). */
  packageName: string;
  /** Name used for tags, changelogs, and commit messages. */
  displayName: string;
  currentVersion: string;
  newVersion: string;
  level: BumpLevel;
  commits: ConventionalCommit[];
  propagated: boolean;
  /** Tag of the previous release, if any. Used for changelog compare links. */
  previousTag?: string | null;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: {
    title: string;
    items: Array<{ message: string; hash: string; scope: string | null }>;
  }[];
}

export interface ReleaseResult {
  packageName: string;
  packagePath: string;
  version: string;
  changelog: string;
  tagName: string;
}
