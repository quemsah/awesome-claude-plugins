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

function replaceUnpairedSurrogates(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1]
        index += 1
      } else {
        result += '\uFFFD'
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\uFFFD'
    } else {
      result += value[index]
    }
  }
  return result
}

/**
 * Encodes a multi-segment value without flattening it. Manifest paths and refs such as
 * `commands/example.md` or `release/v1.2` carry separators that GitHub resolves, so encoding the
 * whole value would emit `%2F` and 404 every one of them.
 */
export function encodeGitHubPath(value: string): string {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(replaceUnpairedSurrogates(segment)))
    .join('/')
}

export function getGitHubBlobUrl(repoPath: string, ref: string, path: string): string {
  return `https://github.com/${encodeGitHubPath(repoPath)}/blob/${encodeGitHubPath(ref)}/${encodeGitHubPath(path)}`
}
