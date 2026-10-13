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
 * Validates a plugin entry name without changing its spelling.
 */
export function normalizePluginName(pluginName?: string): string {
  const name = typeof pluginName === 'string' ? pluginName : ''
  return PLUGIN_COMMAND_TOKEN_PATTERN.test(name) ? name : ''
}

/**
 * Determines whether a plugin install command is verified.
 *
 * A validated marketplace name verifies the generated install target.
 */
export function isPluginInstallCommandVerified(marketplaceName?: string): boolean {
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : ''

  return Boolean(normalizedMarketplaceName && PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName))
}

/**
 * Generates a `/plugin install` command from verified manifest semantics.
 *
 * Uses the exact valid entry name and appends the marketplace name when available.
 * A command without a marketplace name is unverified.
 *
 * Returns `null` when the entry name or a supplied marketplace name is unsafe.
 */
export function getPluginInstallCommand({ pluginName, marketplaceName }: PluginInstallCommandInput): string | null {
  const name = normalizePluginName(pluginName)
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : undefined

  if (normalizedMarketplaceName && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName)) {
    return null
  }

  return name ? `/plugin install ${name}${normalizedMarketplaceName ? `@${normalizedMarketplaceName}` : ''}` : null
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
