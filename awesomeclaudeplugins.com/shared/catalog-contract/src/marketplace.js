import { z } from 'zod'

export const GITHUB_REPO_PATH_PATTERN = /^(?!\.{1,2}\/)[A-Za-z0-9._-]+\/(?!\.{1,2}$)[A-Za-z0-9._-]+$/
export const PLUGIN_ID_PATTERN = /^[A-Za-z0-9._-]+$/

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isSafePath(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512 && !value.includes('..') && !/[\r\n]/.test(value)
}

export function isSafeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return false
  if (GITHUB_REPO_PATH_PATTERN.test(value)) return true

  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

export function isSafePluginId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 160 &&
    value !== '.' &&
    value !== '..' &&
    PLUGIN_ID_PATTERN.test(value)
  )
}

export function resolveMarketplacePluginDisplayName(entry) {
  if (!isRecord(entry)) return undefined
  if (typeof entry.displayName === 'string' && entry.displayName.trim().length > 0 && entry.displayName.length <= 160) {
    return entry.displayName
  }
  return typeof entry.name === 'string' ? entry.name : undefined
}

function isValidGitCommit(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value)
}

function isSourceRepoValid(source) {
  return source.repo === undefined || (typeof source.repo === 'string' && GITHUB_REPO_PATH_PATTERN.test(source.repo))
}

function isSourceUrlValid(source) {
  return source.url === undefined || isSafeSourceUrl(source.url)
}

function isSourceRefValid(ref) {
  return ref === undefined || isSafePath(ref)
}

function isSourceCommitValid(commit) {
  return commit === undefined || isValidGitCommit(commit)
}

export function isValidSource(value) {
  if (isSafePath(value)) return true
  if (!isRecord(value) || !isSafePath(value.source)) return false
  if (value.source === 'github' && typeof value.repo !== 'string') return false
  if (value.source === 'url' && typeof value.url !== 'string') return false

  return (
    isSourceRepoValid(value) &&
    isSourceUrlValid(value) &&
    isSourceRefValid(value.path) &&
    isSourceRefValid(value.branch) &&
    isSourceRefValid(value.ref) &&
    isSourceCommitValid(value.commit) &&
    isSourceCommitValid(value.sha)
  )
}

function checkSourceRepoIssue(source) {
  const needsRepo = source.source === 'github'
  const hasRepo = source.repo !== undefined
  if (needsRepo || hasRepo) {
    if (typeof source.repo !== 'string' || !GITHUB_REPO_PATH_PATTERN.test(source.repo)) {
      return { message: 'Must be a GitHub repository path', path: ['source', 'repo'] }
    }
  }
  return undefined
}

function checkSourceUrlIssue(source) {
  const needsUrl = source.source === 'url'
  const hasUrl = source.url !== undefined
  if (needsUrl || hasUrl) {
    if (typeof source.url !== 'string' || !isSafeSourceUrl(source.url)) {
      return { message: 'Must be a safe HTTP(S) URL', path: ['source', 'url'] }
    }
  }
  return undefined
}

function checkSourceRefsIssue(source) {
  if (source.path !== undefined && !isSafePath(source.path)) {
    return { message: 'Must be a safe repository path', path: ['source', 'path'] }
  }
  if (source.branch !== undefined && !isSafePath(source.branch)) {
    return { message: 'Must be a safe source ref', path: ['source', 'branch'] }
  }
  if (source.ref !== undefined && !isSafePath(source.ref)) {
    return { message: 'Must be a safe source ref', path: ['source', 'ref'] }
  }
  return undefined
}

function checkSourceCommitIssue(source) {
  if (source.commit !== undefined && !isValidGitCommit(source.commit)) {
    return { message: 'Must be a valid source commit', path: ['source', 'commit'] }
  }
  if (source.sha !== undefined && !isValidGitCommit(source.sha)) {
    return { message: 'Must be a valid source commit', path: ['source', 'sha'] }
  }
  return undefined
}

function checkSourceObjectIssue(source) {
  if (!isRecord(source)) return { message: 'Must be a safe repository path', path: ['source'] }
  if (!isSafePath(source.source)) return { message: 'Must be a safe repository path', path: ['source', 'source'] }
  return (
    checkSourceRepoIssue(source) ||
    checkSourceUrlIssue(source) ||
    checkSourceRefsIssue(source) ||
    checkSourceCommitIssue(source)
  )
}

export function getMarketplacePluginIssue(value) {
  if (!isRecord(value)) return { message: 'Must be a marketplace plugin entry object', path: [] }
  if (!isSafePluginId(value.name)) return { message: 'Must be a safe plugin identifier', path: ['id'] }
  if (value.source === undefined) return { message: 'Must be a safe repository path', path: ['source'] }

  if (typeof value.source === 'string') {
    return isSafePath(value.source) ? undefined : { message: 'Must be a safe repository path', path: ['source'] }
  }

  return checkSourceObjectIssue(value.source)
}

export function getMarketplacePluginRejection(value) {
  return getMarketplacePluginIssue(value)?.message
}

export function isMarketplacePlugin(value) {
  return isRecord(value) && isSafePluginId(value.name) && isValidSource(value.source)
}

export const MarketplaceRootSchema = z
  .object({
    name: z.string().trim().min(1),
    owner: z.object({ name: z.string().min(1) }).passthrough(),
    plugins: z.array(z.unknown()),
  })
  .passthrough()

export class MarketplaceFormatError extends Error {
  constructor() {
    super('Marketplace must have non-empty name, non-empty owner.name, and a plugins array')
    this.name = 'MarketplaceFormatError'
  }
}

export function parseMarketplace(value) {
  const result = MarketplaceRootSchema.safeParse(value)
  if (!result.success) throw new MarketplaceFormatError()
  return { plugins: result.data.plugins.filter(isMarketplacePlugin) }
}
