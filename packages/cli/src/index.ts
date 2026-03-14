#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "release-smith",
    version: "0.1.0",
    description: "Lightweight release management for Node.js/Bun",
  },
  subCommands: {
    release: () => import("./commands/release").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    changelog: () => import("./commands/changelog").then((m) => m.default),
    init: () => import("./commands/init").then((m) => m.default),
  },
});

runMain(main);
