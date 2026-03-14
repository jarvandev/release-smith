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

  const raw = JSON.parse(text);

  return {
    packages: raw.packages ?? {},
    branches: raw.branches,
    tagFormat: raw.tagFormat,
    groups: raw.groups,
    prLabels: raw.prLabels,
  };
}
