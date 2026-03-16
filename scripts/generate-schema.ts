/**
 * Generate JSON Schema from RawConfig TypeScript type.
 *
 * Usage: bun run scripts/generate-schema.ts
 * Output: packages/config/src/schema.json
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGenerator } from "ts-json-schema-generator";

const root = resolve(import.meta.dir, "..");

const generator = createGenerator({
  path: resolve(root, "packages/config/src/types.ts"),
  type: "RawConfig",
  tsconfig: resolve(root, "packages/config/tsconfig.json"),
  additionalProperties: false,
});

const schema = generator.createSchema("RawConfig");

// Add $id for external reference
schema.$id = "https://github.com/jarvandev/release-smith/raw/main/packages/config/src/schema.json";
// Add title
(schema as Record<string, unknown>).title = "Release Smith Configuration";

// Allow $schema property in the root definition
const rawConfigDef = schema.definitions?.RawConfig;
if (!rawConfigDef || typeof rawConfigDef !== "object" || !("properties" in rawConfigDef)) {
  throw new Error("Failed to locate RawConfig definition with properties in generated schema");
}
(rawConfigDef.properties as Record<string, unknown>).$schema = {
  type: "string",
  description: "Path or URL to the JSON Schema for editor validation.",
};

const output = resolve(root, "packages/config/src/schema.json");
writeFileSync(output, `${JSON.stringify(schema, null, 2)}\n`);

// Format with biome to match project conventions
execSync(`bunx biome format --write ${output}`, { stdio: "inherit" });
console.log(`Schema written to ${output}`);
