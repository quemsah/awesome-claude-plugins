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

/**
 * Encodes a multi-segment value without flattening it. Manifest paths and refs such as
 * `commands/example.md` or `release/v1.2` carry separators that GitHub resolves, so encoding the
 * whole value would emit `%2F` and 404 every one of them.
 */
export function encodeGitHubPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/')
}

export function getGitHubBlobUrl(repoPath: string, ref: string, path: string): string {
  return `https://github.com/${encodeGitHubPath(repoPath)}/blob/${encodeGitHubPath(ref)}/${encodeGitHubPath(path)}`
}
