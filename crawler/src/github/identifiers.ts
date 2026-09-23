const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const githubPathSegmentPattern = /^[A-Za-z0-9._-]+$/
const repositoryNamePattern = /^[A-Za-z0-9._-]{1,100}$/
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

export function isValidGitHubOwner(value: string): boolean {
  return ownerPattern.test(value)
}

export function isValidGitHubPathSegment(value: string): boolean {
  return value !== '.' && value !== '..' && githubPathSegmentPattern.test(value)
}

export function isValidGitHubRepositoryName(value: string): boolean {
  return value !== '.' && value !== '..' && repositoryNamePattern.test(value)
}

export function parseGitHubRepository(value: string | undefined): [string, string] | undefined {
  const parts = value?.split('/')
  if (parts?.length !== 2 || !isValidGitHubOwner(parts[0]) || !isValidGitHubRepositoryName(parts[1])) {
    return undefined
  }
  return [parts[0], parts[1]]
}

export function parseGitHubOwnerUrl(value: string): string | undefined {
  const prefix = 'https://github.com/'
  if (!value.startsWith(prefix)) return undefined
  const owner = value.slice(prefix.length)
  return isValidGitHubPathSegment(owner) ? owner : undefined
}

export function parseGitHubRepositoryUrl(value: string): { owner: string; repo: string } | undefined {
  const prefix = 'https://github.com/'
  if (!value.startsWith(prefix)) return undefined
  const parts = value.slice(prefix.length).split('/')
  if (parts.length !== 2 || !isValidGitHubPathSegment(parts[0]) || !isValidGitHubPathSegment(parts[1])) {
    return undefined
  }
  return { owner: parts[0], repo: parts[1] }
}

export function isValidGitBranch(branch: string): boolean {
  if (branch === '@' || branch.includes('@{')) return false
  return !branch
    .split('/')
    .some(
      (part) =>
        !part ||
        part.startsWith('.') ||
        part.endsWith('.') ||
        part.endsWith('.lock') ||
        part.includes('..') ||
        /[\\~^:?*[\]\s]/u.test(part),
    )
}

export function isValidGitSha(value: unknown): value is string {
  return typeof value === 'string' && shaPattern.test(value)
}
