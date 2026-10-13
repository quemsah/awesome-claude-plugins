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

function isPluginEntry(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.length === 0) return false

  return (
    (typeof value.source === 'string' && value.source.length > 0) ||
    (isRecord(value.source) && typeof value.source.source === 'string' && value.source.source.length > 0)
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

  return { plugins: value.plugins.filter(isPluginEntry) }
}
