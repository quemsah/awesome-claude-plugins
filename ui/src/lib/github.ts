const GITHUB_API_URL = process.env.GITHUB_API_URL ?? 'https://api.github.com'
export const GITHUB_RAW_URL = process.env.GITHUB_RAW_URL ?? 'https://raw.githubusercontent.com'

function getGitHubHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN?.trim()
  const headers = new Headers({ accept: 'application/vnd.github+json' })
  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }
  return headers
}

export async function fetchGitHubRepository(owner: string, repoName: string, timeoutMs = 5_000): Promise<Response> {
  return fetch(`${GITHUB_API_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, {
    headers: getGitHubHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 3_600, tags: [`github-repo:${owner}/${repoName}`] },
  })
}
