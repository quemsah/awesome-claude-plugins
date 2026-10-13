export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 5
export const MARKETPLACE_PARSER_VERSION = 3

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

const GITHUB_REPO_PATH_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

function isSafePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('..') && !/[\r\n]/.test(value)
}

function isSafeSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false
  if (GITHUB_REPO_PATH_PATTERN.test(value)) return true

  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

function isValidSource(value: unknown): boolean {
  if (isSafePath(value)) return true
  if (!isRecord(value) || !isSafePath(value.source)) return false

  return (
    (value.repo === undefined || (typeof value.repo === 'string' && GITHUB_REPO_PATH_PATTERN.test(value.repo))) &&
    (value.url === undefined || isSafeSourceUrl(value.url)) &&
    (value.path === undefined || isSafePath(value.path)) &&
    (value.branch === undefined || isSafePath(value.branch)) &&
    (value.ref === undefined || isSafePath(value.ref)) &&
    (value.commit === undefined || (typeof value.commit === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.commit))) &&
    (value.sha === undefined || (typeof value.sha === 'string' && /^[A-Fa-f0-9]{7,64}$/.test(value.sha)))
  )
}

function isPluginEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 160 && isValidSource(value.source)
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

  return { plugins: value.plugins.filter(isPluginEntry) }
}
