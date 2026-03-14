export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
}

export async function githubRequest(
  method: string,
  path: string,
  options: GitHubClientOptions,
  body?: object,
): Promise<Response> {
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response;
}
