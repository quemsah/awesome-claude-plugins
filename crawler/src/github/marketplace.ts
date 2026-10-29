export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 5

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

function isPluginEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim().length === 0) return false

  const source = value.source
  if (typeof source === 'string') return source.trim().length > 0
  if (!isRecord(source) || typeof source.source !== 'string' || !source.source.trim()) return false
  if (source.source === 'github') return typeof source.repo === 'string' && source.repo.trim().length > 0
  if (source.source === 'url') return typeof source.url === 'string' && source.url.trim().length > 0
  return true
}

export function parseMarketplace(value: unknown): Marketplace {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    !isRecord(value.owner) ||
    typeof value.owner.name !== 'string' ||
    value.owner.name.length === 0 ||
    !Array.isArray(value.plugins)
  ) {
    throw new MarketplaceFormatError()
  }

  return { plugins: value.plugins.filter(isPluginEntry) }
}
