export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 30000 (30 seconds). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function githubRequest(
  method: string,
  path: string,
  options: GitHubClientOptions,
  body?: object,
): Promise<Response> {
  const baseUrl = options.baseUrl ?? "https://api.github.com";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`GitHub API request timed out after ${timeoutMs}ms: ${method} ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response;
}
