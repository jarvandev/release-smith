const DEFAULT_SINGLE = "v{version}";
const DEFAULT_MONO = "{name}@{version}";

export function resolveTagFormat(tagFormat: string | undefined, isMonorepo: boolean): string {
  return tagFormat ?? (isMonorepo ? DEFAULT_MONO : DEFAULT_SINGLE);
}

export function formatTagName(format: string, packageName: string, version: string): string {
  return format.replace("{version}", version).replace("{name}", packageName);
}

export function resolveTagPrefix(format: string, packageName: string): string {
  return format.replace("{version}", "").replace("{name}", packageName);
}
