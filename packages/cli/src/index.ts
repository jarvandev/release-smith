#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { version } from "../package.json";

const subCommands = {
  release: () => import("./commands/release").then((m) => m.default),
  "release-tags": () => import("./commands/release-tags").then((m) => m.default),
  status: () => import("./commands/status").then((m) => m.default),
  changelog: () => import("./commands/changelog").then((m) => m.default),
  init: () => import("./commands/init").then((m) => m.default),
};

const main = defineCommand({
  meta: {
    name: "release-smith",
    version,
    description: "Lightweight release management for Node.js/Bun",
  },
  subCommands,
});

const GLOBAL_FLAGS = new Set(["help", "version"]);

/**
 * citty parses with strict: false, so unknown flags are silently ignored
 * (a mistyped --dry-run performs a real release) and `--flag=false` reaches
 * boolean args as the truthy string "false". Validate and normalize flags
 * before citty sees them.
 */
async function normalizeArgs(rawArgs: string[]): Promise<string[]> {
  const cmdName = rawArgs.find((a) => !a.startsWith("-"));
  if (!cmdName || !(cmdName in subCommands)) return rawArgs;
  const cmd = await subCommands[cmdName as keyof typeof subCommands]();
  const defs = (cmd.args ?? {}) as Record<string, { type?: string }>;

  const normalized: string[] = [];
  for (const token of rawArgs) {
    if (!token.startsWith("--") || token === "--") {
      normalized.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? null : body.slice(eq + 1);
    const bare = name.startsWith("no-") ? name.slice(3) : name;
    const def = defs[name] ?? (name.startsWith("no-") ? defs[bare] : undefined);
    if (!def && !GLOBAL_FLAGS.has(name)) {
      throw new Error(
        `Unknown flag "--${name}" for "${cmdName}". Run "release-smith ${cmdName} --help" to list supported flags.`,
      );
    }
    if (def?.type === "boolean" && value !== null) {
      if (value !== "true" && value !== "false") {
        throw new Error(`Boolean flag "--${name}" only accepts true or false, got "${value}".`);
      }
      const enabled = (value === "true") !== name.startsWith("no-");
      normalized.push(enabled ? `--${bare}` : `--no-${bare}`);
      continue;
    }
    normalized.push(token);
  }
  return normalized;
}

normalizeArgs(process.argv.slice(2))
  .then((rawArgs) => runMain(main, { rawArgs }))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
