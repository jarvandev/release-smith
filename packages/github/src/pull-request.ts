import { githubRequest } from "./client";

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  state: string;
  merged: boolean;
}

export async function findOpenPullRequest(
  owner: string,
  repo: string,
  head: string,
  base: string,
  token: string,
): Promise<PullRequest | null> {
  const headParam = head.includes(":") ? head : `${owner}:${head}`;
  const response = await githubRequest(
    "GET",
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(headParam)}&base=${encodeURIComponent(base)}`,
    { token },
  );
  const pulls = (await response.json()) as PullRequest[];
  return pulls[0] ?? null;
}

export async function createPullRequest(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  token: string,
): Promise<PullRequest> {
  const response = await githubRequest(
    "POST",
    `/repos/${owner}/${repo}/pulls`,
    { token },
    { head, base, title, body },
  );
  return (await response.json()) as PullRequest;
}

export async function updatePullRequest(
  owner: string,
  repo: string,
  number: number,
  title: string,
  body: string,
  token: string,
): Promise<PullRequest> {
  const response = await githubRequest(
    "PATCH",
    `/repos/${owner}/${repo}/pulls/${number}`,
    { token },
    { title, body },
  );
  return (await response.json()) as PullRequest;
}

export async function getPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<PullRequest> {
  const response = await githubRequest("GET", `/repos/${owner}/${repo}/pulls/${number}`, {
    token,
  });
  return (await response.json()) as PullRequest;
}

export async function addLabelsToPullRequest(
  owner: string,
  repo: string,
  number: number,
  labels: string[],
  token: string,
): Promise<void> {
  if (labels.length === 0) return;
  try {
    await githubRequest(
      "POST",
      `/repos/${owner}/${repo}/issues/${number}/labels`,
      { token },
      { labels },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: Failed to add labels to PR #${number}: ${message}`);
  }
}
