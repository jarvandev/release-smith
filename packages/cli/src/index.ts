#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { version } from "../package.json";

const main = defineCommand({
  meta: {
    name: "release-smith",
    version,
    description: "Lightweight release management for Node.js/Bun",
  },
  subCommands: {
    release: () => import("./commands/release").then((m) => m.default),
    "release-tags": () => import("./commands/release-tags").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
    changelog: () => import("./commands/changelog").then((m) => m.default),
    init: () => import("./commands/init").then((m) => m.default),
  },
});

runMain(main);
