const DEFAULT_SINGLE = "v{version}";
const DEFAULT_MONO = "{name}@{version}";

export function resolveTagFormat(tagFormat: string | undefined, isMonorepo: boolean): string {
  if (tagFormat !== undefined) {
    if (!tagFormat.includes("{version}")) {
      throw new Error('tagFormat must include "{version}" placeholder');
    }
    if (isMonorepo && !tagFormat.includes("{name}")) {
      throw new Error('tagFormat must contain "{name}" placeholder for monorepo projects');
    }
    if (!tagFormat.endsWith("{version}")) {
      throw new Error('tagFormat must end with "{version}" placeholder');
    }
  }
  return tagFormat ?? (isMonorepo ? DEFAULT_MONO : DEFAULT_SINGLE);
}

export function formatTagName(format: string, packageName: string, version: string): string {
  return format.replaceAll("{version}", version).replaceAll("{name}", packageName);
}

export function resolveTagPrefix(format: string, packageName: string): string {
  return format.replaceAll("{version}", "").replaceAll("{name}", packageName);
}
