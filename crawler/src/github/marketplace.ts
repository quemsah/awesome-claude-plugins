export const MARKETPLACE_PARSER_VERSION = 2
export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 3

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

  // ponytail: shallow check; share the UI schema if malformed non-empty entries must be rejected too.
  return { plugins: value.plugins.filter((plugin) => isRecord(plugin) && Object.keys(plugin).length > 0) }
}
