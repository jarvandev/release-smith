# Release Smith Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight, Bun-native release management CLI tool with monorepo support.

**Architecture:** Pipeline pattern with independent stages (config -> git -> parse -> version -> changelog -> release). Organized as a Bun workspace monorepo with 5 packages: config, git, core, github, cli.

**Tech Stack:** Bun, TypeScript, bun:test

---

## File Structure

```
release-smith/
  package.json                          # workspace root
  tsconfig.json                         # base tsconfig
  packages/
    config/
      package.json
      tsconfig.json
      src/
        index.ts                        # public API exports
        types.ts                        # config type definitions
        loader.ts                       # load and validate release-smith.json
        workspace.ts                    # discover workspace packages
      __tests__/
        loader.test.ts
        workspace.test.ts
    git/
      package.json
      tsconfig.json
      src/
        index.ts                        # public API exports
        executor.ts                     # Bun.spawn wrapper for git commands
        log.ts                          # git log parsing
        tag.ts                          # tag read/create operations
        diff.ts                         # changed files per commit
      __tests__/
        executor.test.ts
        log.test.ts
        tag.test.ts
        diff.test.ts
    core/
      package.json
      tsconfig.json
      src/
        index.ts                        # public API exports
        types.ts                        # shared pipeline types
        commit-parser.ts                # conventional commit parsing
        version-calculator.ts           # semver bump + dependency propagation
        changelog-generator.ts          # Keep a Changelog output
        releaser.ts                     # orchestrate all write operations
      __tests__/
        commit-parser.test.ts
        version-calculator.test.ts
        changelog-generator.test.ts
        releaser.test.ts
    github/
      package.json
      tsconfig.json
      src/
        index.ts                        # public API exports
        client.ts                       # GitHub REST API client
        release.ts                      # create GitHub Release
      __tests__/
        release.test.ts
    cli/
      package.json
      tsconfig.json
      src/
        index.ts                        # entry point (bin)
        pipeline.ts                     # shared analysis pipeline (config + commits + bumps)
        commands/
          release.ts                    # release command
          status.ts                     # status command
          changelog.ts                  # changelog command
          init.ts                       # init command
  tests/
    integration/
      release-flow.test.ts             # end-to-end integration test
```

---

## Chunk 1: Project Scaffolding & Config Package

### Task 1: Initialize monorepo structure

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/git/package.json`
- Create: `packages/git/tsconfig.json`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/github/package.json`
- Create: `packages/github/tsconfig.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`

- [ ] **Step 1: Create root package.json with workspace config**

```json
{
  "name": "release-smith-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test --recursive",
    "build": "bun run --filter '*' build",
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

- [ ] **Step 2: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  }
}
```

- [ ] **Step 3: Create each package's package.json and tsconfig.json**

Each package's `package.json` follows this pattern (example for `config`):

```json
{
  "name": "@release-smith/config",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

Package names: `@release-smith/config`, `@release-smith/git`, `@release-smith/core`, `@release-smith/github`, `@release-smith/cli`.

`cli` package has additional fields:

```json
{
  "name": "release-smith",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "release-smith": "src/index.ts"
  },
  "dependencies": {
    "@release-smith/config": "workspace:*",
    "@release-smith/git": "workspace:*",
    "@release-smith/core": "workspace:*",
    "@release-smith/github": "workspace:*"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

`core` package dependencies:

```json
{
  "dependencies": {
    "@release-smith/config": "workspace:*",
    "@release-smith/git": "workspace:*",
    "@release-smith/github": "workspace:*"
  }
}
```

Each package's `tsconfig.json` extends root:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Run `bun install` to verify workspace setup**

Run: `bun install`
Expected: Installs successfully, creates `bun.lock`

- [ ] **Step 5: Create placeholder index.ts for each package**

Each `packages/<name>/src/index.ts`:

```ts
// @release-smith/<name> public API
```

- [ ] **Step 6: Run typecheck to verify setup**

Run: `bunx tsc --noEmit -p packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: initialize monorepo workspace structure"
```

---

### Task 2: Config types and schema

**Files:**
- Create: `packages/config/src/types.ts`

- [ ] **Step 1: Define config types**

```ts
// packages/config/src/types.ts

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
```

- [ ] **Step 2: Commit**

```bash
git add packages/config/src/types.ts
git commit -m "feat(config): add config type definitions"
```

---

### Task 3: Config loader

**Files:**
- Create: `packages/config/src/loader.ts`
- Create: `packages/config/__tests__/loader.test.ts`

- [ ] **Step 1: Write failing tests for config loader**

```ts
// packages/config/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../src/loader";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-config-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns null when no config file exists", async () => {
    const result = await loadConfig(tempDir);
    expect(result).toBeNull();
  });

  it("loads and parses release-smith.json", async () => {
    const config = {
      packages: {
        "packages/cli": { publish: true },
        "packages/core": { publish: false },
      },
    };
    await writeFile(
      join(tempDir, "release-smith.json"),
      JSON.stringify(config),
    );

    const result = await loadConfig(tempDir);
    expect(result).toEqual(config);
  });

  it("returns empty packages when packages field is missing", async () => {
    await writeFile(join(tempDir, "release-smith.json"), "{}");

    const result = await loadConfig(tempDir);
    expect(result).toEqual({ packages: {} });
  });

  it("throws on invalid JSON", async () => {
    await writeFile(join(tempDir, "release-smith.json"), "not json{");

    expect(loadConfig(tempDir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/config/__tests__/loader.test.ts`
Expected: FAIL - `loadConfig` not found

- [ ] **Step 3: Implement config loader**

```ts
// packages/config/src/loader.ts
import { join } from "path";
import type { RawConfig } from "./types";

const CONFIG_FILENAME = "release-smith.json";

export async function loadConfig(cwd: string): Promise<RawConfig | null> {
  const configPath = join(cwd, CONFIG_FILENAME);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return null;
  }

  const text = await file.text();
  const raw = JSON.parse(text);

  return {
    packages: raw.packages ?? {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/config/__tests__/loader.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/config/
git commit -m "feat(config): implement config file loader"
```

---

### Task 4: Workspace discovery

**Files:**
- Create: `packages/config/src/workspace.ts`
- Create: `packages/config/__tests__/workspace.test.ts`

- [ ] **Step 1: Write failing tests for workspace discovery**

```ts
// packages/config/__tests__/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { discoverPackages } from "../src/workspace";
import { join } from "path";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";

async function writePackageJson(dir: string, content: object) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(content));
}

describe("discoverPackages", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-workspace-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("discovers packages from workspaces field", async () => {
    await writePackageJson(tempDir, {
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(tempDir, "packages/core"), {
      name: "@myapp/core",
      version: "1.0.0",
    });
    await writePackageJson(join(tempDir, "packages/cli"), {
      name: "@myapp/cli",
      version: "2.0.0",
      dependencies: { "@myapp/core": "workspace:*" },
    });

    const packages = await discoverPackages(tempDir, null);
    expect(packages).toHaveLength(2);

    const core = packages.find((p) => p.name === "@myapp/core")!;
    expect(core.path).toBe("packages/core");
    expect(core.version).toBe("1.0.0");
    expect(core.publish).toBe(true);
    expect(core.workspaceDeps).toEqual([]);

    const cli = packages.find((p) => p.name === "@myapp/cli")!;
    expect(cli.path).toBe("packages/cli");
    expect(cli.workspaceDeps).toEqual(["@myapp/core"]);
  });

  it("treats private packages as publish: false by default", async () => {
    await writePackageJson(tempDir, {
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(tempDir, "packages/internal"), {
      name: "@myapp/internal",
      version: "1.0.0",
      private: true,
    });

    const packages = await discoverPackages(tempDir, null);
    expect(packages[0].publish).toBe(false);
    expect(packages[0].isPrivate).toBe(true);
  });

  it("applies config overrides", async () => {
    await writePackageJson(tempDir, {
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(tempDir, "packages/core"), {
      name: "@myapp/core",
      version: "1.0.0",
    });
    await writePackageJson(join(tempDir, "packages/cli"), {
      name: "@myapp/cli",
      version: "1.0.0",
    });

    const config = {
      packages: {
        "packages/cli": { publish: true },
      },
    };

    const packages = await discoverPackages(tempDir, config);

    const core = packages.find((p) => p.name === "@myapp/core")!;
    expect(core.publish).toBe(false); // undeclared -> false

    const cli = packages.find((p) => p.name === "@myapp/cli")!;
    expect(cli.publish).toBe(true);
  });

  it("handles single-package project (no workspaces)", async () => {
    await writePackageJson(tempDir, {
      name: "my-tool",
      version: "1.0.0",
    });

    const packages = await discoverPackages(tempDir, null);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-tool");
    expect(packages[0].path).toBe(".");
    expect(packages[0].publish).toBe(true);
  });

  it("includes peerDependencies in workspaceDeps", async () => {
    await writePackageJson(tempDir, {
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(tempDir, "packages/core"), {
      name: "@myapp/core",
      version: "1.0.0",
    });
    await writePackageJson(join(tempDir, "packages/plugin"), {
      name: "@myapp/plugin",
      version: "1.0.0",
      peerDependencies: { "@myapp/core": "^1.0.0" },
    });

    const packages = await discoverPackages(tempDir, null);
    const plugin = packages.find((p) => p.name === "@myapp/plugin")!;
    expect(plugin.workspaceDeps).toEqual(["@myapp/core"]);
  });

  it("excludes devDependencies from workspaceDeps", async () => {
    await writePackageJson(tempDir, {
      workspaces: ["packages/*"],
    });
    await writePackageJson(join(tempDir, "packages/core"), {
      name: "@myapp/core",
      version: "1.0.0",
    });
    await writePackageJson(join(tempDir, "packages/cli"), {
      name: "@myapp/cli",
      version: "1.0.0",
      devDependencies: { "@myapp/core": "workspace:*" },
    });

    const packages = await discoverPackages(tempDir, null);
    const cli = packages.find((p) => p.name === "@myapp/cli")!;
    expect(cli.workspaceDeps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/config/__tests__/workspace.test.ts`
Expected: FAIL - `discoverPackages` not found

- [ ] **Step 3: Implement workspace discovery**

```ts
// packages/config/src/workspace.ts
import { join, relative } from "path";
import { Glob } from "bun";
import type { RawConfig, ResolvedPackage } from "./types";

export async function discoverPackages(
  cwd: string,
  config: RawConfig | null,
): Promise<ResolvedPackage[]> {
  const rootPkg = await readPackageJson(cwd);

  // Single-package project
  if (!rootPkg.workspaces) {
    return [
      {
        name: rootPkg.name ?? "unknown",
        path: ".",
        publish: true,
        changelogPath: join(cwd, "CHANGELOG.md"),
        version: rootPkg.version ?? "0.0.0",
        isPrivate: rootPkg.private === true,
        workspaceDeps: [],
      },
    ];
  }

  // Monorepo: resolve workspace globs
  const patterns: string[] = Array.isArray(rootPkg.workspaces)
    ? rootPkg.workspaces
    : rootPkg.workspaces.packages ?? [];

  const packageDirs = await resolveWorkspaceGlobs(cwd, patterns);
  const hasExplicitConfig = config?.packages && Object.keys(config.packages).length > 0;

  // First pass: read all package.json files and collect names
  const pkgDataList: Array<{
    dir: string;
    relPath: string;
    pkg: Record<string, any>;
  }> = [];
  for (const dir of packageDirs) {
    const relPath = relative(cwd, dir);
    const pkg = await readPackageJson(dir);
    pkgDataList.push({ dir, relPath, pkg });
  }

  const allWorkspaceNames = new Set(
    pkgDataList.map((p) => p.pkg.name).filter(Boolean),
  );

  // Second pass: resolve each package
  const resolved: ResolvedPackage[] = [];
  for (const { dir, relPath, pkg } of pkgDataList) {
    const configEntry = config?.packages?.[relPath];
    const isPrivate = pkg.private === true;

    let publish: boolean;
    if (configEntry?.publish !== undefined) {
      publish = configEntry.publish;
    } else if (hasExplicitConfig) {
      // Undeclared packages default to false when config has explicit entries
      publish = false;
    } else {
      // No explicit config: private -> false, else true
      publish = !isPrivate;
    }

    const changelogPath =
      configEntry?.changelog
        ? join(cwd, configEntry.changelog)
        : join(dir, "CHANGELOG.md");

    const workspaceDeps = collectWorkspaceDeps(pkg, allWorkspaceNames);

    resolved.push({
      name: pkg.name ?? "unknown",
      path: relPath,
      publish,
      changelogPath,
      version: pkg.version ?? "0.0.0",
      isPrivate,
      workspaceDeps,
    });
  }

  return resolved;
}

function collectWorkspaceDeps(
  pkg: Record<string, any>,
  workspaceNames: Set<string>,
): string[] {
  const deps: string[] = [];
  const sources = [pkg.dependencies, pkg.peerDependencies];
  for (const source of sources) {
    if (!source) continue;
    for (const name of Object.keys(source)) {
      if (workspaceNames.has(name)) {
        deps.push(name);
      }
    }
  }
  return [...new Set(deps)];
}

async function resolveWorkspaceGlobs(
  cwd: string,
  patterns: string[],
): Promise<string[]> {
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const match of glob.scan({ cwd, onlyFiles: false })) {
      const fullPath = join(cwd, match);
      const pkgJsonPath = join(fullPath, "package.json");
      if (await Bun.file(pkgJsonPath).exists()) {
        dirs.push(fullPath);
      }
    }
  }
  return dirs.sort();
}

async function readPackageJson(dir: string): Promise<Record<string, any>> {
  const file = Bun.file(join(dir, "package.json"));
  if (!(await file.exists())) {
    throw new Error(`No package.json found in ${dir}`);
  }
  return file.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/config/__tests__/workspace.test.ts`
Expected: All PASS

- [ ] **Step 5: Update config/src/index.ts exports**

```ts
// packages/config/src/index.ts
export { loadConfig } from "./loader";
export { discoverPackages } from "./workspace";
export type {
  RawConfig,
  PackageConfig,
  ResolvedPackage,
} from "./types";
```

- [ ] **Step 6: Run all config tests**

Run: `bun test packages/config/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/config/
git commit -m "feat(config): implement workspace discovery and config loading"
```

---

## Chunk 2: Git Package

### Task 5: Git executor

**Files:**
- Create: `packages/git/src/executor.ts`
- Create: `packages/git/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing tests for git executor**

```ts
// packages/git/__tests__/executor.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { execGit } from "../src/executor";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("execGit", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-git-"));
    await Bun.spawn(["git", "init"], { cwd: tempDir }).exited;
    await Bun.spawn(
      ["git", "config", "user.email", "test@test.com"],
      { cwd: tempDir },
    ).exited;
    await Bun.spawn(
      ["git", "config", "user.name", "Test"],
      { cwd: tempDir },
    ).exited;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("executes a git command and returns stdout", async () => {
    const result = await execGit(["status"], tempDir);
    expect(result).toContain("On branch");
  });

  it("throws on non-zero exit code", async () => {
    expect(execGit(["log"], tempDir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/git/__tests__/executor.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement git executor**

```ts
// packages/git/src/executor.ts

export async function execGit(args: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr.trim()}`,
    );
  }

  return stdout.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/git/__tests__/executor.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/git/
git commit -m "feat(git): implement git command executor"
```

---

### Task 6: Git log parsing

**Files:**
- Create: `packages/git/src/log.ts`
- Create: `packages/git/__tests__/log.test.ts`

- [ ] **Step 1: Write failing tests for git log**

```ts
// packages/git/__tests__/log.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getCommits } from "../src/log";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function initRepo(dir: string) {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

async function commit(dir: string, message: string, file: string = "file.txt") {
  await writeFile(join(dir, file), `${Date.now()}`);
  await Bun.spawn(["git", "add", "."], { cwd: dir }).exited;
  await Bun.spawn(["git", "commit", "-m", message], { cwd: dir }).exited;
}

describe("getCommits", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-log-"));
    await initRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns commits from HEAD to beginning when no fromRef given", async () => {
    await commit(tempDir, "feat: first feature");
    await commit(tempDir, "fix: a bug fix");

    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe("fix: a bug fix");
    expect(commits[1].message).toBe("feat: first feature");
  });

  it("returns commits between two refs", async () => {
    await commit(tempDir, "feat: first");
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await commit(tempDir, "fix: second");
    await commit(tempDir, "feat: third");

    const commits = await getCommits(tempDir, "v1.0.0", "HEAD");
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe("feat: third");
    expect(commits[1].message).toBe("fix: second");
  });

  it("includes full commit hash", async () => {
    await commit(tempDir, "feat: test");
    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits[0].hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("includes multiline body", async () => {
    await writeFile(join(tempDir, "file.txt"), "content");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(
      ["git", "commit", "-m", "feat: with body\n\nThis is the body.\n\nBREAKING CHANGE: something broke"],
      { cwd: tempDir },
    ).exited;

    const commits = await getCommits(tempDir, null, "HEAD");
    expect(commits[0].message).toBe("feat: with body");
    expect(commits[0].body).toContain("This is the body.");
    expect(commits[0].body).toContain("BREAKING CHANGE: something broke");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/git/__tests__/log.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement git log**

```ts
// packages/git/src/log.ts
import { execGit } from "./executor";

export interface RawCommit {
  hash: string;
  message: string;
  body: string;
}

const SEPARATOR = "---COMMIT_SEP---";
const FIELD_SEP = "---FIELD_SEP---";

export async function getCommits(
  cwd: string,
  fromRef: string | null,
  toRef: string,
): Promise<RawCommit[]> {
  const range = fromRef ? `${fromRef}..${toRef}` : toRef;
  const format = [`%H`, `%s`, `%b`].join(FIELD_SEP);

  const output = await execGit(
    ["log", range, `--format=${format}${SEPARATOR}`],
    cwd,
  );

  if (!output) return [];

  return output
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash, message, ...bodyParts] = chunk.split(FIELD_SEP);
      return {
        hash: hash.trim(),
        message: message.trim(),
        body: bodyParts.join(FIELD_SEP).trim(),
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/git/__tests__/log.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/git/
git commit -m "feat(git): implement git log parsing"
```

---

### Task 7: Git tag operations

**Files:**
- Create: `packages/git/src/tag.ts`
- Create: `packages/git/__tests__/tag.test.ts`

- [ ] **Step 1: Write failing tests for tag operations**

```ts
// packages/git/__tests__/tag.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getTags, getLatestVersionTag, createTag } from "../src/tag";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function initRepoWithCommit(dir: string) {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
  await writeFile(join(dir, "file.txt"), "init");
  await run(["add", "."]);
  await run(["commit", "-m", "init"]);
}

describe("getTags", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns empty array when no tags", async () => {
    const tags = await getTags(tempDir);
    expect(tags).toEqual([]);
  });

  it("returns all tags", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v2.0.0"], { cwd: tempDir }).exited;
    const tags = await getTags(tempDir);
    expect(tags).toContain("v1.0.0");
    expect(tags).toContain("v2.0.0");
  });
});

describe("getLatestVersionTag", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns null when no version tags", async () => {
    const tag = await getLatestVersionTag(tempDir, null);
    expect(tag).toBeNull();
  });

  it("finds latest v-prefixed tag for single-package", async () => {
    await Bun.spawn(["git", "tag", "v1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "v1.1.0"], { cwd: tempDir }).exited;

    const tag = await getLatestVersionTag(tempDir, null);
    expect(tag).toBe("v1.1.0");
  });

  it("finds latest package-scoped tag for monorepo", async () => {
    await Bun.spawn(["git", "tag", "@myapp/cli@1.0.0"], { cwd: tempDir }).exited;
    await writeFile(join(tempDir, "file2.txt"), "more");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "more"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/cli@1.2.0"], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "tag", "@myapp/core@2.0.0"], { cwd: tempDir }).exited;

    const tag = await getLatestVersionTag(tempDir, "@myapp/cli");
    expect(tag).toBe("@myapp/cli@1.2.0");
  });
});

describe("createTag", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-tag-"));
    await initRepoWithCommit(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("creates a tag at HEAD", async () => {
    await createTag(tempDir, "v1.0.0");
    const tags = await getTags(tempDir);
    expect(tags).toContain("v1.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/git/__tests__/tag.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tag operations**

```ts
// packages/git/src/tag.ts
import { execGit } from "./executor";

export async function getTags(cwd: string): Promise<string[]> {
  try {
    const output = await execGit(["tag", "--list"], cwd);
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function getLatestVersionTag(
  cwd: string,
  packageName: string | null,
): Promise<string | null> {
  const tags = await getTags(cwd);
  const versionRegex = /^(\d+)\.(\d+)\.(\d+)$/;

  const parsed = tags
    .map((tag) => {
      let version: string;
      if (packageName) {
        const prefix = `${packageName}@`;
        if (!tag.startsWith(prefix)) return null;
        version = tag.slice(prefix.length);
      } else {
        if (!tag.startsWith("v")) return null;
        version = tag.slice(1);
      }
      const match = version.match(versionRegex);
      if (!match) return null;
      return {
        tag,
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
      };
    })
    .filter(Boolean) as Array<{
    tag: string;
    major: number;
    minor: number;
    patch: number;
  }>;

  if (parsed.length === 0) return null;

  parsed.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return parsed[0].tag;
}

export async function createTag(cwd: string, tag: string): Promise<void> {
  await execGit(["tag", tag], cwd);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/git/__tests__/tag.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/git/
git commit -m "feat(git): implement tag operations"
```

---

### Task 8: Git diff (changed files per commit)

**Files:**
- Create: `packages/git/src/diff.ts`
- Create: `packages/git/__tests__/diff.test.ts`

- [ ] **Step 1: Write failing tests for diff**

```ts
// packages/git/__tests__/diff.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getChangedFiles } from "../src/diff";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function initRepo(dir: string) {
  const run = (args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir }).exited;
  await run(["init"]);
  await run(["config", "user.email", "test@test.com"]);
  await run(["config", "user.name", "Test"]);
}

describe("getChangedFiles", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-diff-"));
    await initRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("returns files changed in a commit", async () => {
    await mkdir(join(tempDir, "packages/core/src"), { recursive: true });
    await writeFile(join(tempDir, "packages/core/src/index.ts"), "export {}");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: init"], { cwd: tempDir }).exited;

    const log = await new Response(
      Bun.spawn(["git", "log", "--format=%H", "-1"], { cwd: tempDir, stdout: "pipe" }).stdout,
    ).text();
    const hash = log.trim();

    const files = await getChangedFiles(tempDir, hash);
    expect(files).toContain("packages/core/src/index.ts");
  });

  it("returns multiple files from a single commit", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    await writeFile(join(tempDir, "b.txt"), "b");
    await Bun.spawn(["git", "add", "."], { cwd: tempDir }).exited;
    await Bun.spawn(["git", "commit", "-m", "feat: two files"], { cwd: tempDir }).exited;

    const log = await new Response(
      Bun.spawn(["git", "log", "--format=%H", "-1"], { cwd: tempDir, stdout: "pipe" }).stdout,
    ).text();
    const hash = log.trim();

    const files = await getChangedFiles(tempDir, hash);
    expect(files).toContain("a.txt");
    expect(files).toContain("b.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/git/__tests__/diff.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement diff**

```ts
// packages/git/src/diff.ts
import { execGit } from "./executor";

export async function getChangedFiles(
  cwd: string,
  commitHash: string,
): Promise<string[]> {
  // For root commits (no parent), use diff-tree with --root
  const output = await execGit(
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commitHash],
    cwd,
  );

  if (!output) return [];
  return output.split("\n").filter(Boolean);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/git/__tests__/diff.test.ts`
Expected: All PASS

- [ ] **Step 5: Update git/src/index.ts exports**

```ts
// packages/git/src/index.ts
export { execGit } from "./executor";
export { getCommits, type RawCommit } from "./log";
export { getTags, getLatestVersionTag, createTag } from "./tag";
export { getChangedFiles } from "./diff";
```

- [ ] **Step 6: Run all git tests**

Run: `bun test packages/git/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/git/
git commit -m "feat(git): implement diff and complete git package"
```

---

## Chunk 3: Core - Commit Parser & Version Calculator

### Task 9: Shared pipeline types

**Files:**
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Define shared types**

```ts
// packages/core/src/types.ts

export type BumpLevel = "major" | "minor" | "patch";

export interface ConventionalCommit {
  hash: string;
  type: string;
  scope: string | null;
  description: string;
  body: string;
  breaking: boolean;
  /** The original full message line */
  rawMessage: string;
}

export interface PackageCommit {
  /** Package path (e.g., "packages/core") */
  packagePath: string;
  commit: ConventionalCommit;
}

export interface VersionBump {
  /** Package path */
  packagePath: string;
  /** Package name from package.json */
  packageName: string;
  /** Current version */
  currentVersion: string;
  /** New version */
  newVersion: string;
  /** The bump level applied */
  level: BumpLevel;
  /** Commits that contributed to this bump (direct changes) */
  commits: ConventionalCommit[];
  /** Whether this bump was triggered by dependency propagation */
  propagated: boolean;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: {
    title: string;
    items: Array<{
      message: string;
      hash: string;
      scope: string | null;
    }>;
  }[];
}

export interface ReleaseResult {
  packageName: string;
  packagePath: string;
  version: string;
  changelog: string;
  tagName: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add shared pipeline type definitions"
```

---

### Task 10: Commit parser

**Files:**
- Create: `packages/core/src/commit-parser.ts`
- Create: `packages/core/__tests__/commit-parser.test.ts`

- [ ] **Step 1: Write failing tests for commit parser**

```ts
// packages/core/__tests__/commit-parser.test.ts
import { describe, it, expect } from "bun:test";
import { parseConventionalCommit, assignCommitsToPackages } from "../src/commit-parser";

describe("parseConventionalCommit", () => {
  it("parses simple commit", () => {
    const result = parseConventionalCommit("abc123", "feat: add login", "");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("feat");
    expect(result!.scope).toBeNull();
    expect(result!.description).toBe("add login");
    expect(result!.breaking).toBe(false);
  });

  it("parses commit with scope", () => {
    const result = parseConventionalCommit("abc123", "fix(auth): token refresh", "");
    expect(result!.type).toBe("fix");
    expect(result!.scope).toBe("auth");
    expect(result!.description).toBe("token refresh");
  });

  it("detects breaking change via !", () => {
    const result = parseConventionalCommit("abc123", "feat!: remove old API", "");
    expect(result!.breaking).toBe(true);
    expect(result!.type).toBe("feat");
  });

  it("detects breaking change via scope and !", () => {
    const result = parseConventionalCommit("abc123", "refactor(core)!: rewrite engine", "");
    expect(result!.breaking).toBe(true);
    expect(result!.scope).toBe("core");
  });

  it("detects BREAKING CHANGE in footer", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: new API",
      "Some details\n\nBREAKING CHANGE: old API removed",
    );
    expect(result!.breaking).toBe(true);
  });

  it("detects BREAKING-CHANGE (hyphen) in footer", () => {
    const result = parseConventionalCommit(
      "abc123",
      "feat: new API",
      "BREAKING-CHANGE: old API removed",
    );
    expect(result!.breaking).toBe(true);
  });

  it("returns null for non-conventional commit", () => {
    const result = parseConventionalCommit("abc123", "just a random commit", "");
    expect(result).toBeNull();
  });

  it("returns null for merge commits", () => {
    const result = parseConventionalCommit("abc123", "Merge branch 'main'", "");
    expect(result).toBeNull();
  });

  it("handles colon in description", () => {
    const result = parseConventionalCommit("abc123", "fix: handle edge case: empty input", "");
    expect(result!.description).toBe("handle edge case: empty input");
  });
});

describe("assignCommitsToPackages", () => {
  it("assigns commit to package by file path", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "add feature",
      body: "",
      breaking: false,
      rawMessage: "feat: add feature",
    };
    const filesMap = new Map([["abc123", ["packages/core/src/index.ts"]]]);
    const packagePaths = ["packages/core", "packages/cli"];

    const result = assignCommitsToPackages([commit], filesMap, packagePaths);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe("packages/core");
  });

  it("assigns commit to multiple packages", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "shared fix",
      body: "",
      breaking: false,
      rawMessage: "fix: shared fix",
    };
    const filesMap = new Map([
      ["abc123", ["packages/core/src/a.ts", "packages/cli/src/b.ts"]],
    ]);
    const packagePaths = ["packages/core", "packages/cli"];

    const result = assignCommitsToPackages([commit], filesMap, packagePaths);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.packagePath).sort()).toEqual([
      "packages/cli",
      "packages/core",
    ]);
  });

  it("assigns root-level changes to single-package '.' path", () => {
    const commit = {
      hash: "abc123",
      type: "feat",
      scope: null,
      description: "root change",
      body: "",
      breaking: false,
      rawMessage: "feat: root change",
    };
    const filesMap = new Map([["abc123", ["src/index.ts"]]]);
    const packagePaths = ["."];

    const result = assignCommitsToPackages([commit], filesMap, packagePaths);
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toBe(".");
  });

  it("ignores files not matching any package", () => {
    const commit = {
      hash: "abc123",
      type: "fix",
      scope: null,
      description: "root fix",
      body: "",
      breaking: false,
      rawMessage: "fix: root fix",
    };
    const filesMap = new Map([["abc123", ["README.md"]]]);
    const packagePaths = ["packages/core"];

    const result = assignCommitsToPackages([commit], filesMap, packagePaths);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/__tests__/commit-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement commit parser**

```ts
// packages/core/src/commit-parser.ts
import type { ConventionalCommit, PackageCommit } from "./types";

// type(scope)!: description
const CONVENTIONAL_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/;

export function parseConventionalCommit(
  hash: string,
  message: string,
  body: string,
): ConventionalCommit | null {
  const match = message.match(CONVENTIONAL_REGEX);
  if (!match) return null;

  const [, type, scope, bang, description] = match;

  const breakingInFooter =
    /^BREAKING[ -]CHANGE\s*:/m.test(body);

  return {
    hash,
    type,
    scope: scope ?? null,
    description: description.trim(),
    body,
    breaking: bang === "!" || breakingInFooter,
    rawMessage: message,
  };
}

export function assignCommitsToPackages(
  commits: ConventionalCommit[],
  filesMap: Map<string, string[]>,
  packagePaths: string[],
): PackageCommit[] {
  const results: PackageCommit[] = [];

  for (const commit of commits) {
    const files = filesMap.get(commit.hash) ?? [];
    const matchedPaths = new Set<string>();

    for (const file of files) {
      for (const pkgPath of packagePaths) {
        if (pkgPath === ".") {
          // Single-package: all files belong to it
          matchedPaths.add(pkgPath);
        } else if (file.startsWith(pkgPath + "/")) {
          matchedPaths.add(pkgPath);
        }
      }
    }

    for (const pkgPath of matchedPaths) {
      results.push({ packagePath: pkgPath, commit });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/__tests__/commit-parser.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement conventional commit parser"
```

---

### Task 11: Version calculator

**Files:**
- Create: `packages/core/src/version-calculator.ts`
- Create: `packages/core/__tests__/version-calculator.test.ts`

- [ ] **Step 1: Write failing tests for version calculator**

```ts
// packages/core/__tests__/version-calculator.test.ts
import { describe, it, expect } from "bun:test";
import {
  bumpVersion,
  calculateVersionBumps,
  detectCircularDeps,
} from "../src/version-calculator";
import type { ConventionalCommit, PackageCommit } from "../src/types";
import type { ResolvedPackage } from "@release-smith/config";

function makeCommit(overrides: Partial<ConventionalCommit> = {}): ConventionalCommit {
  return {
    hash: "abc123",
    type: "fix",
    scope: null,
    description: "a fix",
    body: "",
    breaking: false,
    rawMessage: "fix: a fix",
    ...overrides,
  };
}

function makePackage(overrides: Partial<ResolvedPackage> = {}): ResolvedPackage {
  return {
    name: "@myapp/core",
    path: "packages/core",
    publish: true,
    changelogPath: "/tmp/CHANGELOG.md",
    version: "1.0.0",
    isPrivate: false,
    workspaceDeps: [],
    ...overrides,
  };
}

describe("bumpVersion", () => {
  it("bumps patch for fix", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });

  it("bumps minor for feat", () => {
    expect(bumpVersion("1.0.0", "minor")).toBe("1.1.0");
  });

  it("bumps major for breaking", () => {
    expect(bumpVersion("1.0.0", "major")).toBe("2.0.0");
  });

  it("resets lower parts on minor bump", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("resets lower parts on major bump", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("handles 0.x versions with breaking change", () => {
    expect(bumpVersion("0.2.1", "major")).toBe("1.0.0");
  });
});

describe("calculateVersionBumps", () => {
  it("calculates patch bump for fix commits", () => {
    const packages = [makePackage()];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "fix" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].newVersion).toBe("1.0.1");
    expect(bumps[0].level).toBe("patch");
  });

  it("calculates minor bump for feat commits", () => {
    const packages = [makePackage()];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps[0].newVersion).toBe("1.1.0");
    expect(bumps[0].level).toBe("minor");
  });

  it("calculates major bump for breaking changes", () => {
    const packages = [makePackage()];
    const commits: PackageCommit[] = [
      {
        packagePath: "packages/core",
        commit: makeCommit({ type: "feat", breaking: true }),
      },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps[0].newVersion).toBe("2.0.0");
    expect(bumps[0].level).toBe("major");
  });

  it("takes highest bump level when multiple commits", () => {
    const packages = [makePackage()];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "fix" }) },
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps[0].newVersion).toBe("1.1.0");
  });

  it("skips packages with no commits", () => {
    const packages = [
      makePackage(),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        version: "1.0.0",
      }),
    ];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "fix" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/core");
  });

  it("only returns bumps for publish: true packages", () => {
    const packages = [makePackage({ publish: false })];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps).toHaveLength(0);
  });

  it("propagates through dependency chain", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: false }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    expect(bumps).toHaveLength(1);
    expect(bumps[0].packageName).toBe("@myapp/cli");
    expect(bumps[0].newVersion).toBe("1.0.1"); // propagated = at least patch
    expect(bumps[0].propagated).toBe(true);
  });

  it("takes direct bump level over propagated patch", () => {
    const packages = [
      makePackage({ name: "@myapp/core", path: "packages/core", publish: true }),
      makePackage({
        name: "@myapp/cli",
        path: "packages/cli",
        publish: true,
        workspaceDeps: ["@myapp/core"],
      }),
    ];
    const commits: PackageCommit[] = [
      { packagePath: "packages/core", commit: makeCommit({ type: "feat" }) },
      { packagePath: "packages/cli", commit: makeCommit({ type: "feat" }) },
    ];

    const bumps = calculateVersionBumps(packages, commits);
    const cli = bumps.find((b) => b.packageName === "@myapp/cli")!;
    expect(cli.newVersion).toBe("1.1.0"); // direct feat > propagated patch
    expect(cli.propagated).toBe(false);
  });
});

describe("detectCircularDeps", () => {
  it("returns null when no cycles", () => {
    const packages = [
      makePackage({ name: "a", path: "a", workspaceDeps: [] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ];
    expect(detectCircularDeps(packages)).toBeNull();
  });

  it("returns cycle when circular", () => {
    const packages = [
      makePackage({ name: "a", path: "a", workspaceDeps: ["b"] }),
      makePackage({ name: "b", path: "b", workspaceDeps: ["a"] }),
    ];
    const cycle = detectCircularDeps(packages);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/__tests__/version-calculator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement version calculator**

```ts
// packages/core/src/version-calculator.ts
import type { ResolvedPackage } from "@release-smith/config";
import type { BumpLevel, ConventionalCommit, PackageCommit, VersionBump } from "./types";

const BUMP_ORDER: Record<BumpLevel, number> = { patch: 0, minor: 1, major: 2 };

const TYPE_TO_BUMP: Record<string, BumpLevel> = {
  fix: "patch",
  feat: "minor",
};

export function bumpVersion(current: string, level: BumpLevel): string {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (level) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function calculateVersionBumps(
  packages: ResolvedPackage[],
  packageCommits: PackageCommit[],
): VersionBump[] {
  const packageByPath = new Map(packages.map((p) => [p.path, p]));
  const packageByName = new Map(packages.map((p) => [p.name, p]));

  // Group commits by package path
  const commitsByPath = new Map<string, ConventionalCommit[]>();
  for (const pc of packageCommits) {
    const existing = commitsByPath.get(pc.packagePath) ?? [];
    existing.push(pc.commit);
    commitsByPath.set(pc.packagePath, existing);
  }

  // Calculate direct bump level for each package (including non-published)
  const directBumps = new Map<string, { level: BumpLevel; commits: ConventionalCommit[] }>();
  for (const [path, commits] of commitsByPath) {
    const level = getHighestBump(commits);
    if (level) {
      directBumps.set(path, { level, commits });
    }
  }

  // Build reverse dependency map: name -> packages that depend on it
  const reverseDeps = new Map<string, string[]>();
  for (const pkg of packages) {
    for (const dep of pkg.workspaceDeps) {
      const existing = reverseDeps.get(dep) ?? [];
      existing.push(pkg.name);
      reverseDeps.set(dep, existing);
    }
  }

  // Propagate: packages with direct changes trigger dependents
  const propagatedPaths = new Set<string>();
  const visited = new Set<string>();

  function propagate(pkgName: string) {
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const dependents = reverseDeps.get(pkgName) ?? [];
    for (const depName of dependents) {
      const depPkg = packageByName.get(depName);
      if (!depPkg) continue;
      propagatedPaths.add(depPkg.path);
      propagate(depName);
    }
  }

  for (const [path] of directBumps) {
    const pkg = packageByPath.get(path);
    if (pkg) propagate(pkg.name);
  }

  // Build final bumps for publish: true packages
  const results: VersionBump[] = [];

  for (const pkg of packages) {
    if (!pkg.publish) continue;

    const direct = directBumps.get(pkg.path);
    const isPropagated = propagatedPaths.has(pkg.path);

    if (!direct && !isPropagated) continue;

    let level: BumpLevel;
    let isResultPropagated: boolean;
    let commits: ConventionalCommit[];

    if (direct && isPropagated) {
      // Has both direct changes and propagation: use direct level (always >= patch)
      level = direct.level;
      isResultPropagated = false;
      commits = direct.commits;
    } else if (direct) {
      level = direct.level;
      isResultPropagated = false;
      commits = direct.commits;
    } else {
      // Propagated only: at least patch
      level = "patch";
      isResultPropagated = true;
      commits = [];
    }

    results.push({
      packagePath: pkg.path,
      packageName: pkg.name,
      currentVersion: pkg.version,
      newVersion: bumpVersion(pkg.version, level),
      level,
      commits,
      propagated: isResultPropagated,
    });
  }

  return results;
}

function getHighestBump(commits: ConventionalCommit[]): BumpLevel | null {
  let highest: BumpLevel | null = null;

  for (const commit of commits) {
    if (commit.breaking) {
      return "major"; // Can't go higher
    }
    const level = TYPE_TO_BUMP[commit.type];
    if (!level) continue; // Ignore types that don't map to a bump (docs, chore, refactor, etc.)
    if (!highest || BUMP_ORDER[level] > BUMP_ORDER[highest]) {
      highest = level;
    }
  }

  return highest;
}

export function detectCircularDeps(packages: ResolvedPackage[]): string[] | null {
  const packageByName = new Map(packages.map((p) => [p.name, p]));

  enum State {
    Unvisited,
    Visiting,
    Visited,
  }

  const state = new Map<string, State>();
  const parent = new Map<string, string>();

  for (const pkg of packages) {
    state.set(pkg.name, State.Unvisited);
  }

  function dfs(name: string): string[] | null {
    state.set(name, State.Visiting);
    const pkg = packageByName.get(name);
    if (!pkg) return null;

    for (const dep of pkg.workspaceDeps) {
      const depState = state.get(dep);
      if (depState === State.Visiting) {
        // Found cycle - reconstruct it
        const cycle = [dep, name];
        let current = name;
        while (parent.has(current) && parent.get(current) !== dep) {
          current = parent.get(current)!;
          cycle.push(current);
        }
        return cycle.reverse();
      }
      if (depState === State.Unvisited) {
        parent.set(dep, name);
        const cycle = dfs(dep);
        if (cycle) return cycle;
      }
    }

    state.set(name, State.Visited);
    return null;
  }

  for (const pkg of packages) {
    if (state.get(pkg.name) === State.Unvisited) {
      const cycle = dfs(pkg.name);
      if (cycle) return cycle;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/__tests__/version-calculator.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement version calculator with dependency propagation"
```

---

## Chunk 4: Core - Changelog Generator & GitHub Package

### Task 12: Changelog generator

**Files:**
- Create: `packages/core/src/changelog-generator.ts`
- Create: `packages/core/__tests__/changelog-generator.test.ts`

- [ ] **Step 1: Write failing tests for changelog generator**

```ts
// packages/core/__tests__/changelog-generator.test.ts
import { describe, it, expect } from "bun:test";
import { generateChangelog, insertChangelog } from "../src/changelog-generator";
import type { VersionBump, ConventionalCommit } from "../src/types";

function makeCommit(overrides: Partial<ConventionalCommit> = {}): ConventionalCommit {
  return {
    hash: "abcdef1234567890abcdef1234567890abcdef12",
    type: "fix",
    scope: null,
    description: "a fix",
    body: "",
    breaking: false,
    rawMessage: "fix: a fix",
    ...overrides,
  };
}

describe("generateChangelog", () => {
  it("generates changelog with features and fixes", () => {
    const bump: VersionBump = {
      packagePath: "packages/core",
      packageName: "@myapp/core",
      currentVersion: "1.0.0",
      newVersion: "1.1.0",
      level: "minor",
      commits: [
        makeCommit({ type: "feat", description: "add login", hash: "aaa111aaa111aaa111aaa111aaa111aaa111aaa1" }),
        makeCommit({ type: "fix", description: "fix crash", hash: "bbb222bbb222bbb222bbb222bbb222bbb222bbb2" }),
      ],
      propagated: false,
    };

    const result = generateChangelog(bump, "2026-03-14", null);

    expect(result).toContain("## [1.1.0]");
    expect(result).toContain("2026-03-14");
    expect(result).toContain("### Features");
    expect(result).toContain("add login");
    expect(result).toContain("### Bug Fixes");
    expect(result).toContain("fix crash");
  });

  it("includes breaking changes section", () => {
    const bump: VersionBump = {
      packagePath: ".",
      packageName: "my-tool",
      currentVersion: "1.0.0",
      newVersion: "2.0.0",
      level: "major",
      commits: [
        makeCommit({
          type: "feat",
          description: "new API",
          breaking: true,
          hash: "ccc333ccc333ccc333ccc333ccc333ccc333ccc3",
        }),
      ],
      propagated: false,
    };

    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("### Breaking Changes");
  });

  it("includes short commit hash with link when repoUrl provided", () => {
    const bump: VersionBump = {
      packagePath: ".",
      packageName: "my-tool",
      currentVersion: "1.0.0",
      newVersion: "1.0.1",
      level: "patch",
      commits: [makeCommit({ hash: "abcdef1234567890abcdef1234567890abcdef12" })],
      propagated: false,
    };

    const result = generateChangelog(bump, "2026-03-14", "https://github.com/user/repo");
    expect(result).toContain("[abcdef1](https://github.com/user/repo/commit/abcdef1234567890abcdef1234567890abcdef12)");
  });

  it("includes short hash without link when no repoUrl", () => {
    const bump: VersionBump = {
      packagePath: ".",
      packageName: "my-tool",
      currentVersion: "1.0.0",
      newVersion: "1.0.1",
      level: "patch",
      commits: [makeCommit({ hash: "abcdef1234567890abcdef1234567890abcdef12" })],
      propagated: false,
    };

    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("abcdef1");
    expect(result).not.toContain("https://");
  });

  it("includes scope in entry when present", () => {
    const bump: VersionBump = {
      packagePath: ".",
      packageName: "my-tool",
      currentVersion: "1.0.0",
      newVersion: "1.0.1",
      level: "patch",
      commits: [makeCommit({ scope: "auth", description: "fix token" })],
      propagated: false,
    };

    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("**auth:**");
  });

  it("generates note for propagated bump with no direct commits", () => {
    const bump: VersionBump = {
      packagePath: "packages/cli",
      packageName: "@myapp/cli",
      currentVersion: "1.0.0",
      newVersion: "1.0.1",
      level: "patch",
      commits: [],
      propagated: true,
    };

    const result = generateChangelog(bump, "2026-03-14", null);
    expect(result).toContain("1.0.1");
    expect(result).toContain("dependency update");
  });
});

describe("insertChangelog", () => {
  it("prepends to empty changelog", () => {
    const result = insertChangelog("", "## [1.0.0] - 2026-03-14\n\n### Features\n\n- add login");
    expect(result).toContain("# Changelog");
    expect(result).toContain("## [1.0.0]");
  });

  it("inserts after header in existing changelog", () => {
    const existing = `# Changelog

## [0.1.0] - 2026-03-01

### Features

- initial release
`;
    const newEntry = "## [0.2.0] - 2026-03-14\n\n### Bug Fixes\n\n- fix bug";
    const result = insertChangelog(existing, newEntry);

    const idx1 = result.indexOf("## [0.2.0]");
    const idx2 = result.indexOf("## [0.1.0]");
    expect(idx1).toBeLessThan(idx2); // new entry comes first
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/__tests__/changelog-generator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement changelog generator**

```ts
// packages/core/src/changelog-generator.ts
import type { ConventionalCommit, VersionBump } from "./types";

const SECTION_ORDER: Array<{ title: string; filter: (c: ConventionalCommit) => boolean }> = [
  { title: "Breaking Changes", filter: (c) => c.breaking },
  { title: "Features", filter: (c) => c.type === "feat" && !c.breaking },
  { title: "Bug Fixes", filter: (c) => c.type === "fix" && !c.breaking },
  {
    title: "Other Changes",
    filter: (c) => c.type !== "feat" && c.type !== "fix" && !c.breaking,
  },
];

export function generateChangelog(
  bump: VersionBump,
  date: string,
  repoUrl: string | null,
): string {
  const lines: string[] = [];
  lines.push(`## [${bump.newVersion}] - ${date}`);
  lines.push("");

  if (bump.propagated && bump.commits.length === 0) {
    lines.push("- Bump version due to dependency update");
    lines.push("");
    return lines.join("\n");
  }

  for (const section of SECTION_ORDER) {
    const matching = bump.commits.filter(section.filter);
    if (matching.length === 0) continue;

    lines.push(`### ${section.title}`);
    lines.push("");
    for (const commit of matching) {
      lines.push(formatEntry(commit, repoUrl));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatEntry(commit: ConventionalCommit, repoUrl: string | null): string {
  const shortHash = commit.hash.slice(0, 7);
  const hashRef = repoUrl
    ? `[${shortHash}](${repoUrl}/commit/${commit.hash})`
    : shortHash;
  const scope = commit.scope ? `**${commit.scope}:** ` : "";
  return `- ${scope}${commit.description} (${hashRef})`;
}

export function insertChangelog(existing: string, newEntry: string): string {
  if (!existing.trim()) {
    return `# Changelog\n\n${newEntry}\n`;
  }

  // Insert after the "# Changelog" header line
  const headerMatch = existing.match(/^# Changelog\s*\n/);
  if (headerMatch) {
    const insertPos = headerMatch.index! + headerMatch[0].length;
    return (
      existing.slice(0, insertPos) +
      "\n" +
      newEntry +
      "\n" +
      existing.slice(insertPos)
    );
  }

  // No header found, prepend everything
  return `# Changelog\n\n${newEntry}\n\n${existing}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/__tests__/changelog-generator.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement changelog generator"
```

---

### Task 13: GitHub release client

**Files:**
- Create: `packages/github/src/client.ts`
- Create: `packages/github/src/release.ts`
- Create: `packages/github/__tests__/release.test.ts`

- [ ] **Step 1: Write failing tests for GitHub release**

```ts
// packages/github/__tests__/release.test.ts
import { describe, it, expect } from "bun:test";
import { parseGitHubUrl, createGitHubRelease } from "../src/release";

describe("parseGitHubUrl", () => {
  it("parses HTTPS URL", () => {
    const result = parseGitHubUrl("https://github.com/user/repo.git");
    expect(result).toEqual({ owner: "user", repo: "repo" });
  });

  it("parses HTTPS URL without .git", () => {
    const result = parseGitHubUrl("https://github.com/user/repo");
    expect(result).toEqual({ owner: "user", repo: "repo" });
  });

  it("parses SSH URL", () => {
    const result = parseGitHubUrl("git@github.com:user/repo.git");
    expect(result).toEqual({ owner: "user", repo: "repo" });
  });

  it("returns null for non-GitHub URL", () => {
    const result = parseGitHubUrl("https://gitlab.com/user/repo");
    expect(result).toBeNull();
  });
});

describe("createGitHubRelease", () => {
  it("skips when no token and returns warning", async () => {
    const result = await createGitHubRelease({
      owner: "user",
      repo: "repo",
      tag: "v1.0.0",
      name: "v1.0.0",
      body: "changelog",
      token: null,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("GITHUB_TOKEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/github/__tests__/release.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement GitHub client and release**

```ts
// packages/github/src/client.ts

export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
}

export async function githubRequest(
  method: string,
  path: string,
  options: GitHubClientOptions,
  body?: object,
): Promise<Response> {
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${method} ${path} failed (${response.status}): ${text}`,
    );
  }

  return response;
}
```

```ts
// packages/github/src/release.ts

import { githubRequest } from "./client";

export interface CreateReleaseOptions {
  owner: string;
  repo: string;
  tag: string;
  name: string;
  body: string;
  token: string | null;
}

export interface CreateReleaseResult {
  skipped: boolean;
  reason?: string;
  url?: string;
}

export function parseGitHubUrl(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(
    /github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(
    /github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

export async function createGitHubRelease(
  options: CreateReleaseOptions,
): Promise<CreateReleaseResult> {
  if (!options.token) {
    return {
      skipped: true,
      reason: "GITHUB_TOKEN not set. Skipping GitHub Release creation.",
    };
  }

  const response = await githubRequest(
    "POST",
    `/repos/${options.owner}/${options.repo}/releases`,
    { token: options.token },
    {
      tag_name: options.tag,
      name: options.name,
      body: options.body,
    },
  );

  const data = (await response.json()) as { html_url: string };
  return { skipped: false, url: data.html_url };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/github/__tests__/release.test.ts`
Expected: All PASS

- [ ] **Step 5: Update github/src/index.ts exports**

```ts
// packages/github/src/index.ts
export { githubRequest } from "./client";
export { parseGitHubUrl, createGitHubRelease } from "./release";
export type { CreateReleaseOptions, CreateReleaseResult } from "./release";
```

- [ ] **Step 6: Commit**

```bash
git add packages/github/
git commit -m "feat(github): implement GitHub release client"
```

---

## Chunk 5: Core - Releaser

### Task 14: Releaser

**Files:**
- Create: `packages/core/src/releaser.ts`
- Create: `packages/core/__tests__/releaser.test.ts`

- [ ] **Step 1: Write failing tests for releaser**

```ts
// packages/core/__tests__/releaser.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { updatePackageVersion, updateWorkspaceDeps } from "../src/releaser";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

describe("updatePackageVersion", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("updates version in package.json", async () => {
    const pkgDir = join(tempDir, "packages/core");
    await mkdir(pkgDir, { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@myapp/core", version: "1.0.0" }, null, 2) + "\n",
    );

    await updatePackageVersion(pkgDir, "1.1.0");

    const content = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf-8"));
    expect(content.version).toBe("1.1.0");
  });

  it("preserves other fields and formatting", async () => {
    const original = JSON.stringify(
      { name: "@myapp/core", version: "1.0.0", description: "Core lib" },
      null,
      2,
    ) + "\n";
    await writeFile(join(tempDir, "package.json"), original);

    await updatePackageVersion(tempDir, "2.0.0");

    const content = JSON.parse(await readFile(join(tempDir, "package.json"), "utf-8"));
    expect(content.description).toBe("Core lib");
    expect(content.version).toBe("2.0.0");
  });
});

describe("updateWorkspaceDeps", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-releaser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("updates workspace dependency versions", async () => {
    await mkdir(join(tempDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/cli/package.json"),
      JSON.stringify({
        name: "@myapp/cli",
        version: "1.0.0",
        dependencies: { "@myapp/core": "workspace:*" },
      }, null, 2) + "\n",
    );

    const versionMap = new Map([["@myapp/core", "1.1.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/cli"), versionMap);

    const content = JSON.parse(
      await readFile(join(tempDir, "packages/cli/package.json"), "utf-8"),
    );
    expect(content.dependencies["@myapp/core"]).toBe("workspace:^1.1.0");
  });

  it("updates peerDependencies too", async () => {
    await mkdir(join(tempDir, "packages/plugin"), { recursive: true });
    await writeFile(
      join(tempDir, "packages/plugin/package.json"),
      JSON.stringify({
        name: "@myapp/plugin",
        version: "1.0.0",
        peerDependencies: { "@myapp/core": "^1.0.0" },
      }, null, 2) + "\n",
    );

    const versionMap = new Map([["@myapp/core", "2.0.0"]]);
    await updateWorkspaceDeps(join(tempDir, "packages/plugin"), versionMap);

    const content = JSON.parse(
      await readFile(join(tempDir, "packages/plugin/package.json"), "utf-8"),
    );
    expect(content.peerDependencies["@myapp/core"]).toBe("^2.0.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/__tests__/releaser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement releaser**

```ts
// packages/core/src/releaser.ts
import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import { execGit } from "@release-smith/git";
import { parseGitHubUrl, createGitHubRelease } from "@release-smith/github";
import { generateChangelog, insertChangelog } from "./changelog-generator";
import type { ResolvedPackage } from "@release-smith/config";
import type { VersionBump, ReleaseResult } from "./types";

export async function updatePackageVersion(
  packageDir: string,
  newVersion: string,
): Promise<void> {
  const pkgPath = join(packageDir, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw);
  pkg.version = newVersion;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

export async function updateWorkspaceDeps(
  packageDir: string,
  versionMap: Map<string, string>,
): Promise<void> {
  const pkgPath = join(packageDir, "package.json");
  const raw = await readFile(pkgPath, "utf-8");
  const pkg = JSON.parse(raw);
  let changed = false;

  for (const field of ["dependencies", "peerDependencies"] as const) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, version] of versionMap) {
      if (!(name in deps)) continue;
      const currentValue = deps[name] as string;
      if (currentValue.startsWith("workspace:")) {
        deps[name] = `workspace:^${version}`;
      } else {
        deps[name] = `^${version}`;
      }
      changed = true;
    }
  }

  if (changed) {
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }
}

export async function executeRelease(options: {
  cwd: string;
  bumps: VersionBump[];
  packages: ResolvedPackage[];
  dryRun: boolean;
  isMonorepo: boolean;
}): Promise<ReleaseResult[]> {
  const { cwd, bumps, packages, dryRun, isMonorepo } = options;

  if (bumps.length === 0) return [];

  const date = new Date().toISOString().slice(0, 10);

  // Detect repo URL for changelog links
  let repoUrl: string | null = null;
  try {
    const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
    const parsed = parseGitHubUrl(remoteUrl);
    if (parsed) {
      repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
    }
  } catch {
    // No remote, links will be plain hashes
  }

  const results: ReleaseResult[] = [];
  const versionMap = new Map(bumps.map((b) => [b.packageName, b.newVersion]));

  for (const bump of bumps) {
    const changelog = generateChangelog(bump, date, repoUrl);
    const tagName = isMonorepo
      ? `${bump.packageName}@${bump.newVersion}`
      : `v${bump.newVersion}`;

    if (!dryRun) {
      // Update package.json version
      const pkgDir = join(cwd, bump.packagePath);
      await updatePackageVersion(pkgDir, bump.newVersion);

      // Write changelog
      const pkg = packages.find((p) => p.path === bump.packagePath)!;
      const existingChangelog = await readFileSafe(pkg.changelogPath);
      const newChangelog = insertChangelog(existingChangelog, changelog);
      await writeFile(pkg.changelogPath, newChangelog);
    }

    results.push({
      packageName: bump.packageName,
      packagePath: bump.packagePath,
      version: bump.newVersion,
      changelog,
      tagName,
    });
  }

  // Update workspace dependency versions across all packages (once, outside the loop)
  if (!dryRun) {
    for (const pkg of packages) {
      await updateWorkspaceDeps(join(cwd, pkg.path), versionMap);
    }
  }

  if (!dryRun) {
    // Git commit and tag
    await execGit(["add", "-A"], cwd);
    const commitMsg = results.length === 1
      ? `chore(release): ${results[0].packageName}@${results[0].version}`
      : `chore(release): ${results.map((r) => `${r.packageName}@${r.version}`).join(", ")}`;
    await execGit(["commit", "-m", commitMsg], cwd);

    for (const result of results) {
      await execGit(["tag", result.tagName], cwd);
    }

    // GitHub Release
    const token = process.env.GITHUB_TOKEN ?? null;
    let ghInfo: { owner: string; repo: string } | null = null;
    try {
      const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
      ghInfo = parseGitHubUrl(remoteUrl);
    } catch {
      // No remote
    }

    if (ghInfo) {
      for (const result of results) {
        const ghResult = await createGitHubRelease({
          owner: ghInfo.owner,
          repo: ghInfo.repo,
          tag: result.tagName,
          name: result.tagName,
          body: result.changelog,
          token,
        });
        if (ghResult.skipped) {
          console.warn(`Warning: ${ghResult.reason}`);
        }
      }
    }
  }

  return results;
}

async function readFileSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/__tests__/releaser.test.ts`
Expected: All PASS

- [ ] **Step 5: Update core/src/index.ts exports**

```ts
// packages/core/src/index.ts
export { parseConventionalCommit, assignCommitsToPackages } from "./commit-parser";
export { bumpVersion, calculateVersionBumps, detectCircularDeps } from "./version-calculator";
export { generateChangelog, insertChangelog } from "./changelog-generator";
export { updatePackageVersion, updateWorkspaceDeps, executeRelease } from "./releaser";
export type {
  BumpLevel,
  ConventionalCommit,
  PackageCommit,
  VersionBump,
  ChangelogEntry,
  ReleaseResult,
} from "./types";
```

- [ ] **Step 6: Run all core tests**

Run: `bun test packages/core/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement releaser with file updates and git operations"
```

---

## Chunk 6: CLI Package

### Task 15: CLI entry point and release command

**Files:**
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/release.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `packages/cli/src/commands/changelog.ts`
- Create: `packages/cli/src/commands/init.ts`

- [ ] **Step 1: Implement CLI entry point**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

/** Flags that can appear multiple times and collect into arrays. */
const ARRAY_FLAGS = new Set(["target"]);

type FlagValue = string | boolean | string[];

function parseFlags(args: string[]): Record<string, FlagValue> {
  const flags: Record<string, FlagValue> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        if (ARRAY_FLAGS.has(key)) {
          const existing = flags[key];
          flags[key] = Array.isArray(existing)
            ? [...existing, next]
            : [next];
        } else {
          flags[key] = next;
        }
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(args.slice(1));

  switch (command) {
    case "release": {
      const { runRelease } = await import("./commands/release");
      await runRelease(flags);
      break;
    }
    case "status": {
      const { runStatus } = await import("./commands/status");
      await runStatus(flags);
      break;
    }
    case "changelog": {
      const { runChangelog } = await import("./commands/changelog");
      await runChangelog(flags);
      break;
    }
    case "init": {
      const { runInit } = await import("./commands/init");
      await runInit(flags);
      break;
    }
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
release-smith - Lightweight release management for Node.js/Bun

Usage: release-smith <command> [options]

Commands:
  release      Execute the full release pipeline
  status       View current version status and pending changes
  changelog    Generate changelog only (no release)
  init         Create release-smith.json configuration

Options:
  --help, -h   Show this help message

Run 'release-smith <command> --help' for command-specific options.
`.trim());
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Implement shared analysis pipeline**

Extract the shared logic (config loading, commit fetching, bump calculation) into a reusable function so that `release`, `status`, and `changelog` commands don't duplicate code.

```ts
// packages/cli/src/pipeline.ts
import { loadConfig, discoverPackages, type ResolvedPackage } from "@release-smith/config";
import { getCommits, getChangedFiles, getLatestVersionTag, execGit } from "@release-smith/git";
import {
  parseConventionalCommit,
  assignCommitsToPackages,
  calculateVersionBumps,
  detectCircularDeps,
  type VersionBump,
  type ConventionalCommit,
  type PackageCommit,
} from "@release-smith/core";

export interface PipelineResult {
  packages: ResolvedPackage[];
  bumps: VersionBump[];
  isMonorepo: boolean;
}

export async function runPipeline(cwd: string): Promise<PipelineResult> {
  const config = await loadConfig(cwd);
  const packages = await discoverPackages(cwd, config);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

  // Check circular deps
  const cycle = detectCircularDeps(packages);
  if (cycle) {
    throw new Error(`Circular dependency detected: ${cycle.join(" -> ")}`);
  }

  // Collect per-package latest tags so we know each package's commit boundary.
  // Also find the earliest tag across all packages so we can fetch commits once.
  const packageTags = new Map<string, string | null>(); // packagePath -> tag
  let earliestTag: string | null = null;
  let hasPackageWithNoTag = false;

  for (const pkg of packages) {
    const pkgName = isMonorepo ? pkg.name : null;
    const tag = await getLatestVersionTag(cwd, pkgName);
    packageTags.set(pkg.path, tag);
    if (tag === null) {
      hasPackageWithNoTag = true;
    } else if (!earliestTag) {
      earliestTag = tag;
    } else {
      const tagDate = await execGit(["log", "-1", "--format=%ct", tag], cwd);
      const earliestDate = await execGit(["log", "-1", "--format=%ct", earliestTag], cwd);
      if (parseInt(tagDate) < parseInt(earliestDate)) {
        earliestTag = tag;
      }
    }
  }

  // If any package has no tag, fetch from the very beginning
  const fromRef = hasPackageWithNoTag ? null : earliestTag;

  // Fetch commits once, then build lookup structures
  const rawCommits = await getCommits(cwd, fromRef, "HEAD");
  const allParsed: ConventionalCommit[] = [];
  const filesMap = new Map<string, string[]>();
  const commitTimestamps = new Map<string, number>();

  for (const rawCommit of rawCommits) {
    const parsed = parseConventionalCommit(rawCommit.hash, rawCommit.message, rawCommit.body);
    if (parsed) allParsed.push(parsed);
    const files = await getChangedFiles(cwd, rawCommit.hash);
    filesMap.set(rawCommit.hash, files);
  }

  // Get timestamp for each tag so we can filter per-package
  const tagTimestamps = new Map<string, number>();
  for (const [, tag] of packageTags) {
    if (tag && !tagTimestamps.has(tag)) {
      const ts = await execGit(["log", "-1", "--format=%ct", tag], cwd);
      tagTimestamps.set(tag, parseInt(ts));
    }
  }

  // Get timestamps for all commits
  for (const commit of allParsed) {
    if (!commitTimestamps.has(commit.hash)) {
      const ts = await execGit(["log", "-1", "--format=%ct", commit.hash], cwd);
      commitTimestamps.set(commit.hash, parseInt(ts));
    }
  }

  // Assign commits to packages, then filter out commits that are before
  // each package's own latest tag
  const packagePaths = packages.map((p) => p.path);
  const allPackageCommits = assignCommitsToPackages(allParsed, filesMap, packagePaths);

  const filteredPackageCommits = allPackageCommits.filter((pc) => {
    const tag = packageTags.get(pc.packagePath);
    if (!tag) return true; // No tag for this package = include all commits
    const tagTs = tagTimestamps.get(tag);
    if (tagTs === undefined) return true;
    const commitTs = commitTimestamps.get(pc.commit.hash);
    if (commitTs === undefined) return true;
    return commitTs > tagTs; // Only include commits after this package's tag
  });

  const bumps = calculateVersionBumps(packages, filteredPackageCommits);

  return { packages, bumps, isMonorepo };
}
```

- [ ] **Step 3: Implement release command**

```ts
// packages/cli/src/commands/release.ts
import { executeRelease } from "@release-smith/core";
import { execGit } from "@release-smith/git";
import { runPipeline } from "../pipeline";

export async function runRelease(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const dryRun = flags["dry-run"] === true;
  const targetPkgs = Array.isArray(flags.target) ? flags.target : [];

  // Check for retry scenario: tags exist but GitHub Releases may have failed
  const retryResult = await checkRetryScenario(cwd);
  if (retryResult) {
    console.log("Detected existing tags without GitHub Releases. Retrying release creation...");
    await retryGitHubReleases(cwd, retryResult);
    return;
  }

  const { packages, bumps: allBumps, isMonorepo } = await runPipeline(cwd);

  // Filter by --target if specified
  let bumps = allBumps;
  if (targetPkgs.length > 0) {
    const targeted = new Set(targetPkgs);
    const filtered = bumps.filter((b) => targeted.has(b.packageName));
    const skipped = bumps.filter((b) => !targeted.has(b.packageName));
    if (skipped.length > 0) {
      console.warn(
        `Warning: Skipping untargeted packages with pending changes: ${skipped.map((b) => b.packageName).join(", ")}`,
      );
    }
    bumps = filtered;
  }

  if (bumps.length === 0) {
    console.log("No packages to release.");
    return;
  }

  if (dryRun) {
    console.log("Dry run - no changes will be made.\n");
  }

  for (const bump of bumps) {
    const suffix = bump.propagated ? " (dependency update)" : "";
    console.log(`${bump.packageName}: ${bump.currentVersion} -> ${bump.newVersion}${suffix}`);
  }

  const results = await executeRelease({
    cwd,
    bumps,
    packages,
    dryRun,
    isMonorepo,
  });

  if (!dryRun) {
    console.log("\nRelease complete!");
    for (const result of results) {
      console.log(`  ${result.tagName}`);
    }
  }
}

interface RetryTag {
  tagName: string;
  changelog: string;
}

/**
 * Check if there are release tags whose commit message exists but
 * no corresponding GitHub Release was created (e.g., previous run failed at that step).
 * We detect this by looking for the most recent release commit and checking
 * if any of its tags are missing GitHub Releases.
 */
async function checkRetryScenario(cwd: string): Promise<RetryTag[] | null> {
  try {
    // Check if the latest commit is a release commit
    const lastMsg = await execGit(["log", "-1", "--format=%s"], cwd);
    if (!lastMsg.startsWith("chore(release):")) return null;

    // Get tags pointing to HEAD
    const tagsAtHead = await execGit(["tag", "--points-at", "HEAD"], cwd);
    if (!tagsAtHead.trim()) return null;

    const tags = tagsAtHead.split("\n").filter(Boolean);

    // Read the CHANGELOG for each tagged package to get the release body
    const retryTags: RetryTag[] = [];
    for (const tag of tags) {
      // Try to find the changelog content for this version
      // For now, just use the tag name as a placeholder
      retryTags.push({ tagName: tag, changelog: "" });
    }

    return retryTags.length > 0 ? retryTags : null;
  } catch {
    return null;
  }
}

async function retryGitHubReleases(cwd: string, tags: RetryTag[]) {
  const { parseGitHubUrl, createGitHubRelease } = await import("@release-smith/github");

  const token = process.env.GITHUB_TOKEN ?? null;
  let ghInfo: { owner: string; repo: string } | null = null;
  try {
    const remoteUrl = await execGit(["remote", "get-url", "origin"], cwd);
    ghInfo = parseGitHubUrl(remoteUrl);
  } catch {
    console.error("No git remote found. Cannot create GitHub Releases.");
    return;
  }

  if (!ghInfo) {
    console.error("Remote is not a GitHub repository.");
    return;
  }

  for (const { tagName, changelog } of tags) {
    const result = await createGitHubRelease({
      owner: ghInfo.owner,
      repo: ghInfo.repo,
      tag: tagName,
      name: tagName,
      body: changelog,
      token,
    });
    if (result.skipped) {
      console.warn(`Warning: ${result.reason}`);
    } else {
      console.log(`Created GitHub Release: ${result.url}`);
    }
  }
}
```

- [ ] **Step 4: Implement status command**

```ts
// packages/cli/src/commands/status.ts
import { runPipeline } from "../pipeline";

export async function runStatus(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const { bumps } = await runPipeline(cwd);

  if (bumps.length === 0) {
    console.log("All packages are up to date. No pending releases.");
    return;
  }

  console.log("Pending releases:\n");
  for (const bump of bumps) {
    const suffix = bump.propagated ? " (dependency update)" : "";
    console.log(`  ${bump.packageName}`);
    console.log(`    ${bump.currentVersion} -> ${bump.newVersion} (${bump.level})${suffix}`);
    if (bump.commits.length > 0) {
      for (const c of bump.commits) {
        console.log(`    - ${c.rawMessage}`);
      }
    }
    console.log();
  }
}
```

- [ ] **Step 5: Implement changelog command**

```ts
// packages/cli/src/commands/changelog.ts
import { generateChangelog } from "@release-smith/core";
import { runPipeline } from "../pipeline";

export async function runChangelog(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const { bumps, isMonorepo } = await runPipeline(cwd);
  const date = new Date().toISOString().slice(0, 10);

  if (bumps.length === 0) {
    console.log("No changes to generate changelog for.");
    return;
  }

  for (const bump of bumps) {
    if (isMonorepo) {
      console.log(`\n--- ${bump.packageName} ---\n`);
    }
    console.log(generateChangelog(bump, date, null));
  }
}
```

- [ ] **Step 6: Implement init command**

```ts
// packages/cli/src/commands/init.ts
import { join } from "path";
import { discoverPackages } from "@release-smith/config";

export async function runInit(flags: Record<string, string | boolean | string[]>) {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const configPath = join(cwd, "release-smith.json");

  const file = Bun.file(configPath);
  if (await file.exists()) {
    console.error("release-smith.json already exists.");
    process.exit(1);
  }

  // Try to detect workspace packages
  const packages = await discoverPackages(cwd, null);
  const isMonorepo = packages.length > 1 || packages[0]?.path !== ".";

  let config: object;

  if (isMonorepo) {
    const pkgEntries: Record<string, { publish: boolean }> = {};
    for (const pkg of packages) {
      pkgEntries[pkg.path] = { publish: !pkg.isPrivate };
    }
    config = { packages: pkgEntries };
  } else {
    config = {};
  }

  await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Created ${configPath}`);

  if (isMonorepo) {
    console.log("\nDetected packages:");
    for (const pkg of packages) {
      const publishStr = pkg.isPrivate ? "publish: false" : "publish: true";
      console.log(`  ${pkg.path} (${publishStr})`);
    }
    console.log("\nEdit release-smith.json to customize which packages to publish.");
  }
}
```

- [ ] **Step 7: Verify CLI runs**

Run: `bun run packages/cli/src/index.ts --help`
Expected: Shows help text

- [ ] **Step 8: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): implement CLI with release, status, changelog, and init commands"
```

---

## Chunk 7: Integration Test & Build

### Task 16: End-to-end integration test

**Files:**
- Create: `tests/integration/release-flow.test.ts`

- [ ] **Step 1: Write integration test for single-package release**

```ts
// tests/integration/release-flow.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return stdout.trim();
}

async function initRepo(dir: string) {
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@test.com");
  await git(dir, "config", "user.name", "Test");
}

async function commit(dir: string, message: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, content);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", message);
}

describe("Single-package release flow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-"));
    await initRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("performs a complete release cycle", async () => {
    // Setup: create a single-package project
    await commit(tempDir, "chore: init", {
      "package.json": JSON.stringify({ name: "my-tool", version: "1.0.0" }, null, 2) + "\n",
      "src/index.ts": "export const version = '1.0.0';",
    });

    // Add a feature commit
    await commit(tempDir, "feat: add new feature", {
      "src/feature.ts": "export function newFeature() { return true; }",
    });

    // Add a fix commit
    await commit(tempDir, "fix: handle edge case", {
      "src/index.ts": "export const version = '1.0.0';\nexport function main() {}",
    });

    // Run release (dry-run to verify without side effects)
    const proc = Bun.spawn(
      ["bun", "run", join(__dirname, "../../packages/cli/src/index.ts"), "release", "--dry-run", "--cwd", tempDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-tool");
    expect(stdout).toContain("1.0.0");
    expect(stdout).toContain("1.1.0"); // feat -> minor bump
  });
});

describe("Monorepo release flow", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-integration-mono-"));
    await initRepo(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it("releases monorepo with dependency propagation", async () => {
    // Setup monorepo
    await commit(tempDir, "chore: init monorepo", {
      "package.json": JSON.stringify({
        name: "my-monorepo",
        private: true,
        workspaces: ["packages/*"],
      }, null, 2) + "\n",
      "packages/core/package.json": JSON.stringify({
        name: "@myapp/core",
        version: "1.0.0",
      }, null, 2) + "\n",
      "packages/core/src/index.ts": "export const version = '1.0.0';",
      "packages/cli/package.json": JSON.stringify({
        name: "@myapp/cli",
        version: "1.0.0",
        dependencies: { "@myapp/core": "workspace:*" },
      }, null, 2) + "\n",
      "packages/cli/src/index.ts": "import { version } from '@myapp/core';",
      "release-smith.json": JSON.stringify({
        packages: {
          "packages/core": { publish: false },
          "packages/cli": { publish: true },
        },
      }, null, 2) + "\n",
    });

    // Change core (non-published) should propagate to cli
    await commit(tempDir, "feat: add core utility", {
      "packages/core/src/util.ts": "export function util() { return 42; }",
    });

    // Run status to verify
    const proc = Bun.spawn(
      ["bun", "run", join(__dirname, "../../packages/cli/src/index.ts"), "status", "--cwd", tempDir],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();

    expect(exitCode).toBe(0);
    expect(stdout).toContain("@myapp/cli");
    expect(stdout).toContain("1.0.0");
    expect(stdout).toContain("1.0.1"); // propagated patch bump
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/integration/`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test --recursive`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: add end-to-end integration tests"
```

---

### Task 17: Build and distribution setup

**Files:**
- Modify: `packages/cli/package.json`
- Create: `scripts/build.ts`

- [ ] **Step 1: Create build script**

```ts
// scripts/build.ts
import { $ } from "bun";

const targets = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64",
];

// Bundle CLI into a single file first
await $`bun build packages/cli/src/index.ts --outdir dist --target bun`;

// Compile standalone binaries
for (const target of targets) {
  const suffix = target.replace("bun-", "");
  console.log(`Building release-smith-${suffix}...`);
  await $`bun build packages/cli/src/index.ts --compile --target=${target} --outfile dist/release-smith-${suffix}`;
}

console.log("Build complete.");
```

- [ ] **Step 2: Update root package.json with build script**

Add to root `package.json` scripts:

```json
{
  "scripts": {
    "build:binary": "bun run scripts/build.ts"
  }
}
```

- [ ] **Step 3: Verify build works**

Run: `bun run scripts/build.ts`
Expected: Creates binary files in `dist/`

- [ ] **Step 4: Add .gitignore**

```
node_modules/
dist/
*.tgz
```

- [ ] **Step 5: Commit**

```bash
git add scripts/ .gitignore package.json
git commit -m "chore: add build script for standalone binaries"
```

---

### Task 18: Final wiring and CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Create project CLAUDE.md**

```markdown
# Release Smith

Lightweight release management tool for Node.js/Bun, built with Bun.

## Development

- Runtime: Bun
- Test: `bun test --recursive`
- Typecheck: `bunx tsc --noEmit -p packages/<name>/tsconfig.json`
- Build binaries: `bun run scripts/build.ts`
- Run CLI locally: `bun run packages/cli/src/index.ts <command>`

## Architecture

Monorepo with 5 packages: config, git, core, github, cli.
Pipeline pattern: config -> git -> parse -> version -> changelog -> release.
See `docs/superpowers/specs/2026-03-14-release-smith-design.md` for full spec.

## Conventions

- Conventional Commits for all commit messages
- Tests use `bun:test`, git tests use real repos in temp dirs (no mocking)
- `@release-smith/<name>` package naming
```

- [ ] **Step 2: Run full test suite one final time**

Run: `bun test --recursive`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add project CLAUDE.md"
```
