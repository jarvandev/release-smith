import { GitHubApiError, githubRequest } from "./client";

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
  // Repo names may contain dots (e.g. next.js); only a final ".git"
  // suffix and trailing slash are stripped.
  const match = remoteUrl.trim().match(/github\.com[/:]([^/:]+)\/(.+?)(?:\.git)?\/?$/);
  if (!match?.[1] || !match[2] || match[2].includes("/")) return null;
  return { owner: match[1], repo: match[2] };
}

export async function createGitHubRelease(
  options: CreateReleaseOptions,
): Promise<CreateReleaseResult> {
  if (!options.token)
    return { skipped: true, reason: "GITHUB_TOKEN not set. Skipping GitHub Release creation." };

  // Check if release already exists for this tag. Tags may contain "/"
  // (scoped package names), so the path segment must be encoded.
  try {
    const existing = await githubRequest(
      "GET",
      `/repos/${options.owner}/${options.repo}/releases/tags/${encodeURIComponent(options.tag)}`,
      { token: options.token },
    );
    const data = (await existing.json()) as { html_url: string };
    return {
      skipped: true,
      reason: `GitHub Release for tag ${options.tag} already exists: ${data.html_url}`,
    };
  } catch (error) {
    // Only 404 means the release doesn't exist; auth or rate-limit
    // failures must not be mistaken for that.
    if (!(error instanceof GitHubApiError) || error.status !== 404) throw error;
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
