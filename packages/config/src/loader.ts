import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawConfig } from "./types";

const CONFIG_FILENAME = "release-smith.json";

const KNOWN_KEYS = new Set([
  "$schema",
  "packages",
  "tagFormat",
  "branches",
  "groups",
  "prLabels",
  "ignoreFiles",
]);

const KNOWN_PACKAGE_KEYS = new Set([
  "publish",
  "changelog",
  "name",
  "from",
  "ignoreFiles",
  "extraDeps",
]);

export async function loadConfig(cwd: string): Promise<RawConfig | null> {
  const configPath = join(cwd, CONFIG_FILENAME);

  let text: string;
  try {
    text = await readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Failed to read config file ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse config file ${configPath}: ${error.message}`);
    }
    throw error;
  }

  return validateConfig(raw, configPath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validateConfig(raw: unknown, configPath: string): RawConfig {
  const invalid = (message: string) => new Error(`Invalid config in ${configPath}: ${message}`);

  if (!isPlainObject(raw)) {
    throw invalid("root value must be a JSON object");
  }

  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
  if (unknownKeys.length > 0) {
    console.warn(`Warning: Unknown config keys: ${unknownKeys.join(", ")}. Check for typos.`);
  }

  if (raw.packages !== undefined && !isPlainObject(raw.packages)) {
    throw invalid('"packages" must be an object mapping package paths to entries');
  }
  for (const [path, entry] of Object.entries(raw.packages ?? {})) {
    if (!isPlainObject(entry)) {
      throw invalid(`package entry "${path}" must be an object`);
    }
    if (entry.publish !== undefined && typeof entry.publish !== "boolean") {
      throw invalid(`"publish" in package entry "${path}" must be a boolean`);
    }
    for (const field of ["changelog", "name", "from"] as const) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        throw invalid(`"${field}" in package entry "${path}" must be a string`);
      }
    }
    for (const field of ["ignoreFiles", "extraDeps"] as const) {
      if (entry[field] !== undefined && !isStringArray(entry[field])) {
        throw invalid(`"${field}" in package entry "${path}" must be an array of strings`);
      }
    }
    const unknownEntryKeys = Object.keys(entry).filter((k) => !KNOWN_PACKAGE_KEYS.has(k));
    if (unknownEntryKeys.length > 0) {
      console.warn(
        `Warning: Unknown keys in package entry "${path}": ${unknownEntryKeys.join(", ")}. Check for typos.`,
      );
    }
  }

  if (raw.branches !== undefined) {
    if (!isPlainObject(raw.branches)) {
      throw invalid('"branches" must be an object mapping branch names to settings');
    }
    for (const [branch, entry] of Object.entries(raw.branches)) {
      if (!isPlainObject(entry) || typeof entry.prerelease !== "string") {
        throw invalid(
          `branches entry "${branch}" must be an object with a "prerelease" string, e.g. {"prerelease": "beta"}`,
        );
      }
    }
  }

  if (raw.tagFormat !== undefined && typeof raw.tagFormat !== "string") {
    throw invalid('"tagFormat" must be a string');
  }

  if (raw.groups !== undefined) {
    if (!isPlainObject(raw.groups)) {
      throw invalid('"groups" must be an object with "fixed" and/or "linked" arrays');
    }
    for (const kind of ["fixed", "linked"] as const) {
      const value = raw.groups[kind];
      if (value === undefined) continue;
      if (!Array.isArray(value) || !value.every(isStringArray)) {
        throw invalid(`"groups.${kind}" must be an array of string arrays`);
      }
    }
  }

  if (raw.prLabels !== undefined && !isStringArray(raw.prLabels)) {
    throw invalid('"prLabels" must be an array of strings');
  }

  if (raw.ignoreFiles !== undefined && !isStringArray(raw.ignoreFiles)) {
    throw invalid('"ignoreFiles" must be an array of strings');
  }

  return {
    packages: (raw.packages as RawConfig["packages"]) ?? {},
    branches: raw.branches as RawConfig["branches"],
    tagFormat: raw.tagFormat as RawConfig["tagFormat"],
    groups: raw.groups as RawConfig["groups"],
    prLabels: raw.prLabels as RawConfig["prLabels"],
    ignoreFiles: raw.ignoreFiles as RawConfig["ignoreFiles"],
  };
}
