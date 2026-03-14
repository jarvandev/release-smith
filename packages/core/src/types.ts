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
  packageName: string;
  currentVersion: string;
  newVersion: string;
  level: BumpLevel;
  commits: ConventionalCommit[];
  propagated: boolean;
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
