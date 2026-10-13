export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 4

export type Marketplace = { plugins: unknown[] }

export class MarketplaceFormatError extends Error {
  constructor() {
    super('Marketplace must have non-empty name, non-empty owner.name, and a plugins array')
    this.name = 'MarketplaceFormatError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPluginPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.includes('..') &&
    !/[\r\n]/.test(value)
  )
}

function isGitHubRepoPath(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)
}

function isSourceSha(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value)
}

function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isPluginSource(value: unknown): boolean {
  if (isPluginPath(value)) return true
  if (!isRecord(value) || !isPluginPath(value.source)) return false

  return (
    (value.repo === undefined || isGitHubRepoPath(value.repo)) &&
    (value.url === undefined || isSafeHttpUrl(value.url) || isGitHubRepoPath(value.url)) &&
    (value.branch === undefined || isPluginPath(value.branch)) &&
    (value.path === undefined || isPluginPath(value.path)) &&
    (value.ref === undefined || isPluginPath(value.ref)) &&
    (value.commit === undefined || isSourceSha(value.commit)) &&
    (value.sha === undefined || isSourceSha(value.sha))
  )
}

function isPlugin(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= 160 &&
    isPluginSource(value.source)
  )
}

export function parseMarketplace(value: unknown): Marketplace {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    !isRecord(value.owner) ||
    typeof value.owner.name !== 'string' ||
    value.owner.name.length === 0 ||
    !Array.isArray(value.plugins)
  ) {
    throw new MarketplaceFormatError()
  }

  return { plugins: value.plugins.filter(isPlugin) }
}
