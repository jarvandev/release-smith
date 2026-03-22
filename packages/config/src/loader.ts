import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RawConfig } from "./types";

const CONFIG_FILENAME = "release-smith.json";

export async function loadConfig(cwd: string): Promise<RawConfig | null> {
  const configPath = join(cwd, CONFIG_FILENAME);

  let text: string;
  try {
    text = await readFile(configPath, "utf-8");
  } catch {
    return null;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse config file ${configPath}: ${error.message}`);
    }
    throw error;
  }

  const KNOWN_KEYS = new Set([
    "packages",
    "tagFormat",
    "branches",
    "groups",
    "prLabels",
    "ignoreFiles",
  ]);
  const unknownKeys = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k));
  if (unknownKeys.length > 0) {
    console.warn(`Warning: Unknown config keys: ${unknownKeys.join(", ")}. Check for typos.`);
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
