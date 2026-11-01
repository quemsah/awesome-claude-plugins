import { parseMarketplace as parseSharedMarketplace } from '@awesome-claude-plugins/catalog-contract'

export {
  getMarketplacePluginIssue,
  getMarketplacePluginRejection,
  isMarketplacePlugin,
  isSafePluginId,
  MarketplaceFormatError,
  PLUGIN_ID_PATTERN,
  resolveMarketplacePluginDisplayName,
} from '@awesome-claude-plugins/catalog-contract'
export type Marketplace = { plugins: unknown[] }

export const MARKETPLACE_INVALID_CONTENT_CACHE_VERSION = 9
export const MARKETPLACE_PARSER_VERSION = 5

export function parseMarketplace(value: unknown): Marketplace {
  return parseSharedMarketplace(value)
}
