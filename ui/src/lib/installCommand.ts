/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  marketplaceName?: string
}

const PLUGIN_COMMAND_TOKEN_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Normalizes a plugin name for CLI usage.
 * Trims whitespace, lowercases, and collapses all whitespace sequences into hyphens.
 *
 * Examples:
 *   "  My   Plugin  " → "my-plugin"
 */
export function normalizePluginName(pluginName?: string): string {
  const normalized = typeof pluginName === 'string' ? pluginName.trim().toLowerCase().replace(/\s+/g, '-') : ''
  return PLUGIN_COMMAND_TOKEN_PATTERN.test(normalized) ? normalized : ''
}

/**
 * Determines whether a plugin install command is verified.
 *
 * A marketplace-backed command is verified only when both names are valid.
 */
export function isPluginInstallCommandVerified(pluginName?: string, marketplaceName?: string): boolean {
  const normalizedPluginName = normalizePluginName(pluginName)
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : ''

  return Boolean(normalizedPluginName && normalizedMarketplaceName && PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName))
}

/**
 * Generates a `/plugin install` command from verified manifest semantics.
 *
 * Uses the marketplace manifest entry name and marketplace name when available.
 * A plugin name without a marketplace name is displayed but remains unverified.
 *
 * Returns `null` when the plugin name is invalid or the supplied marketplace name is unsafe.
 */
export function getPluginInstallCommand({ pluginName, marketplaceName }: PluginInstallCommandInput): string | null {
  const normalizedName = normalizePluginName(pluginName)
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : undefined

  if (normalizedMarketplaceName && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName)) {
    return null
  }

  if (normalizedName && normalizedMarketplaceName) {
    return `/plugin install ${normalizedName}@${normalizedMarketplaceName}`
  }

  if (normalizedName) {
    return `/plugin install ${normalizedName}`
  }

  return null
}

/**
 * Generates a `/plugin marketplace add` command from repository metadata.
 *
 * Verified when both `owner` and `repoName` are present.
 * Returns `null` when required data is missing.
 */
export function getMarketplaceAddCommand(owner?: string | null, repoName?: string | null): string | null {
  const trimmedOwner = typeof owner === 'string' ? owner.trim() || null : null
  const trimmedRepoName = typeof repoName === 'string' ? repoName.trim() || null : null

  if (
    !(
      trimmedOwner &&
      trimmedRepoName &&
      PLUGIN_COMMAND_TOKEN_PATTERN.test(trimmedOwner) &&
      PLUGIN_COMMAND_TOKEN_PATTERN.test(trimmedRepoName)
    )
  ) {
    return null
  }

  return `/plugin marketplace add ${trimmedOwner}/${trimmedRepoName}`
}
