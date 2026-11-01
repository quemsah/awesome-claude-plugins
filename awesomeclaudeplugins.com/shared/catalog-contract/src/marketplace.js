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

export function isValidSource(value) {
  if (isSafePath(value)) return true
  if (!isRecord(value) || !isSafePath(value.source)) return false

  return (
    (value.source !== 'github' || typeof value.repo === 'string') &&
    (value.source !== 'url' || typeof value.url === 'string') &&
    (value.repo === undefined || (typeof value.repo === 'string' && GITHUB_REPO_PATH_PATTERN.test(value.repo))) &&
    (value.url === undefined || isSafeSourceUrl(value.url)) &&
    (value.path === undefined || isSafePath(value.path)) &&
    (value.branch === undefined || isSafePath(value.branch)) &&
    (value.ref === undefined || isSafePath(value.ref)) &&
    (value.commit === undefined || (typeof value.commit === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.commit))) &&
    (value.sha === undefined || (typeof value.sha === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.sha)))
  )
}

export function getMarketplacePluginIssue(value) {
  if (!isRecord(value)) return { message: 'Must be a marketplace plugin entry object', path: [] }
  if (!isSafePluginId(value.name)) return { message: 'Must be a safe plugin identifier', path: ['id'] }
  if (value.source === undefined) return { message: 'Must be a safe repository path', path: ['source'] }

  if (typeof value.source === 'string') {
    if (!isSafePath(value.source)) return { message: 'Must be a safe repository path', path: ['source'] }
    return undefined
  }

  if (!isRecord(value.source)) return { message: 'Must be a safe repository path', path: ['source'] }
  if (!isSafePath(value.source.source)) return { message: 'Must be a safe repository path', path: ['source', 'source'] }

  if (value.source.source === 'github') {
    if (typeof value.source.repo !== 'string' || !GITHUB_REPO_PATH_PATTERN.test(value.source.repo)) {
      return { message: 'Must be a GitHub repository path', path: ['source', 'repo'] }
    }
  }

  if (value.source.source === 'url') {
    if (typeof value.source.url !== 'string' || !isSafeSourceUrl(value.source.url)) {
      return { message: 'Must be a safe HTTP(S) URL', path: ['source', 'url'] }
    }
  }

  if (value.source.repo !== undefined && (typeof value.source.repo !== 'string' || !GITHUB_REPO_PATH_PATTERN.test(value.source.repo))) {
    return { message: 'Must be a GitHub repository path', path: ['source', 'repo'] }
  }

  if (value.source.url !== undefined && (typeof value.source.url !== 'string' || !isSafeSourceUrl(value.source.url))) {
    return { message: 'Must be a safe HTTP(S) URL', path: ['source', 'url'] }
  }

  if (value.source.path !== undefined && !isSafePath(value.source.path)) {
    return { message: 'Must be a safe repository path', path: ['source', 'path'] }
  }

  if (value.source.branch !== undefined && !isSafePath(value.source.branch)) {
    return { message: 'Must be a safe source ref', path: ['source', 'branch'] }
  }

  if (value.source.ref !== undefined && !isSafePath(value.source.ref)) {
    return { message: 'Must be a safe source ref', path: ['source', 'ref'] }
  }

  if (value.source.commit !== undefined && (typeof value.source.commit !== 'string' || !/^[A-Fa-f0-9]{7,64}$/.test(value.source.commit))) {
    return { message: 'Must be a valid source commit', path: ['source', 'commit'] }
  }

  if (value.source.sha !== undefined && (typeof value.source.sha !== 'string' || !/^[A-Fa-f0-9]{7,64}$/.test(value.source.sha))) {
    return { message: 'Must be a valid source commit', path: ['source', 'sha'] }
  }

  return undefined
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
