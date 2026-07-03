import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGit } from "@release-smith/git";

const CLI = join(import.meta.dir, "../src/index.ts");

async function runCLI(args: string[], cwd: string) {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  const proc = Bun.spawn(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe", env });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("CLI flag validation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rs-args-"));
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    await execGit(["init"], tempDir);
    await execGit(["config", "user.email", "test@test.com"], tempDir);
    await execGit(["config", "user.name", "Test"], tempDir);
    await execGit(["add", "."], tempDir);
    await execGit(["commit", "-m", "feat: initial"], tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects unknown flags instead of silently ignoring them", async () => {
    const result = await runCLI(["release", "--dry-runn"], tempDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown flag");
    expect(result.stderr).toContain("--dry-runn");
  });

  it("treats --flag=false on booleans as false, not a truthy string", async () => {
    // With GITHUB_TOKEN unset, entering PR mode fails fast; --pr=false must
    // stay in direct mode and complete the dry run instead.
    const result = await runCLI(["release", "--pr=false", "--dry-run"], tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("GITHUB_TOKEN");
  });

  it("treats --flag=true on booleans as true", async () => {
    const result = await runCLI(["release", "--pr=true", "--dry-run"], tempDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("GITHUB_TOKEN");
  });

  it("rejects non-boolean values on boolean flags", async () => {
    const result = await runCLI(["release", "--pr=maybe"], tempDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("only accepts true or false");
  });
});
