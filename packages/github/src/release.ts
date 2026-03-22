import { githubRequest } from "./client";

export interface CreateReleaseOptions {
  owner: string;
  repo: string;
  tag: string;
  name: string;
  body: string;
  token: string | null;
}

export interface CreateReleaseResult {
  skipped: boolean;
  reason?: string;
  url?: string;
}

export function parseGitHubUrl(remoteUrl: string): { owner: string; repo: string } | null {
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (httpsMatch?.[1] && httpsMatch[2]) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) return { owner: sshMatch[1], repo: sshMatch[2] };
  return null;
}

export async function createGitHubRelease(
  options: CreateReleaseOptions,
): Promise<CreateReleaseResult> {
  if (!options.token)
    return { skipped: true, reason: "GITHUB_TOKEN not set. Skipping GitHub Release creation." };

  // Check if release already exists for this tag
  try {
    const existing = await githubRequest(
      "GET",
      `/repos/${options.owner}/${options.repo}/releases/tags/${options.tag}`,
      { token: options.token },
    );
    const data = (await existing.json()) as { html_url: string };
    return {
      skipped: true,
      reason: `GitHub Release for tag ${options.tag} already exists: ${data.html_url}`,
    };
  } catch {
    // Release doesn't exist, proceed to create
  }

  const response = await githubRequest(
    "POST",
    `/repos/${options.owner}/${options.repo}/releases`,
    { token: options.token },
    { tag_name: options.tag, name: options.name, body: options.body },
  );
  const data = (await response.json()) as { html_url: string };
  return { skipped: false, url: data.html_url };
}
