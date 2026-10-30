const ownerPattern = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const githubPathSegmentPattern = /^[A-Za-z0-9._-]+$/
const repositoryNamePattern = /^[A-Za-z0-9._-]{1,100}$/
const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

export const GITHUB_SEGMENT_PATTERN = githubPathSegmentPattern

export function isGitHubSegment(value) {
  return isValidGitHubPathSegment(value)
}

export function isValidGitHubOwner(value) {
  return ownerPattern.test(value)
}

export function isValidGitHubPathSegment(value) {
  return value !== '.' && value !== '..' && githubPathSegmentPattern.test(value)
}

export function isValidGitHubRepositoryName(value) {
  return value !== '.' && value !== '..' && repositoryNamePattern.test(value)
}

export function parseGitHubRepository(value) {
  const parts = value?.split('/')
  if (parts?.length !== 2 || !isValidGitHubOwner(parts[0]) || !isValidGitHubRepositoryName(parts[1])) {
    return undefined
  }
  return [parts[0], parts[1]]
}

export function parseGitHubOwnerUrl(value) {
  const prefix = 'https://github.com/'
  if (!value.startsWith(prefix)) return undefined
  const owner = value.slice(prefix.length)
  return isValidGitHubPathSegment(owner) ? owner : undefined
}

export function parseGitHubRepositoryUrl(value) {
  const prefix = 'https://github.com/'
  if (!value.startsWith(prefix)) return undefined
  const parts = value.slice(prefix.length).split('/')
  if (parts.length !== 2 || !isValidGitHubPathSegment(parts[0]) || !isValidGitHubPathSegment(parts[1])) {
    return undefined
  }
  return { owner: parts[0], repo: parts[1] }
}

export function isValidGitBranch(branch) {
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

export function isValidGitSha(value) {
  return typeof value === 'string' && shaPattern.test(value)
}

export function getGitHubOwnerUrl(owner) {
  return `https://github.com/${encodeURIComponent(owner)}`
}

export function getGitHubRepoUrl(owner, repoName) {
  return `${getGitHubOwnerUrl(owner)}/${encodeURIComponent(repoName)}`
}

export function getGitHubRepoPath(owner, repoName) {
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`
}

function replaceUnpairedSurrogates(value) {
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

/** Encodes each path segment while preserving GitHub's meaningful slash separators. */
export function encodeGitHubPath(value) {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(replaceUnpairedSurrogates(segment)))
    .join('/')
}

export function getGitHubBlobUrl(repoPath, ref, path) {
  return `https://github.com/${encodeGitHubPath(repoPath)}/blob/${encodeGitHubPath(ref)}/${encodeGitHubPath(path)}`
}
