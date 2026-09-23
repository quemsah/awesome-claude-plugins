export type RepositoryIdentity = { owner: string; repo: string }

export function parseRepositoryUrl(url: string): RepositoryIdentity | null {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(url)
  if (!match?.[1] || !match[2] || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') {
    return null
  }
  return { owner: match[1], repo: match[2] }
}
