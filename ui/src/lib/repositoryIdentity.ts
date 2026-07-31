export const GITHUB_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

export function isGitHubSegment(value: string): boolean {
  return GITHUB_SEGMENT_PATTERN.test(value)
}

export function getGitHubOwnerUrl(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}`
}

export function getGitHubRepoUrl(owner: string, repoName: string): string {
  return `${getGitHubOwnerUrl(owner)}/${encodeURIComponent(repoName)}`
}

export function getGitHubRepoPath(owner: string, repoName: string): string {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`
}
