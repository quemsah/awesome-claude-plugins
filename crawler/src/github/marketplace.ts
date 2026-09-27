export type Marketplace = { plugins: unknown[] }

export class MarketplaceFormatError extends Error {
  constructor() {
    super('Marketplace must have name, owner.name, and a plugins array')
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
    !isRecord(value.owner) ||
    typeof value.owner.name !== 'string' ||
    !Array.isArray(value.plugins)
  ) {
    throw new MarketplaceFormatError()
  }

  return { plugins: value.plugins }
}
