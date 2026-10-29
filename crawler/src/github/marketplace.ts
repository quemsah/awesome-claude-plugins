import { parseMarketplace as parseSharedMarketplace } from '@awesome-claude-plugins/catalog-contract'

export { MarketplaceFormatError } from '@awesome-claude-plugins/catalog-contract'
export type Marketplace = { plugins: unknown[] }

export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 7
export const MARKETPLACE_PARSER_VERSION = 3

export function parseMarketplace(value: unknown): Marketplace {
  return parseSharedMarketplace(value)
}
