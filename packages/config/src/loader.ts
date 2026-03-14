import { join } from "node:path";
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
