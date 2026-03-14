#!/usr/bin/env bun

const args = process.argv.slice(2);
const command = args[0];

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
          flags[key] = Array.isArray(existing) ? [...existing, next] : [next];
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
    case "release": { const { runRelease } = await import("./commands/release"); await runRelease(flags); break; }
    case "status": { const { runStatus } = await import("./commands/status"); await runStatus(flags); break; }
    case "changelog": { const { runChangelog } = await import("./commands/changelog"); await runChangelog(flags); break; }
    case "init": { const { runInit } = await import("./commands/init"); await runInit(flags); break; }
    case "--help": case "-h": case undefined: printHelp(); break;
    default: console.error(`Unknown command: ${command}`); printHelp(); process.exit(1);
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

main().catch((err) => { console.error(err.message); process.exit(1); });
