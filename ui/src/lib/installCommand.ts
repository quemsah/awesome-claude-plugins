/**
 * Install command types for Claude Code plugins.
 */
export type InstallCommandType = 'marketplace-add' | 'plugin-install'

export type PluginInstallCommandInput = {
  pluginName?: string
  pluginId?: string
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
 * A non-empty plugin identifier takes precedence. When it is absent, a validated
 * marketplace name can verify the generated install target.
 */
export function isPluginInstallCommandVerified(pluginId?: string, marketplaceName?: string): boolean {
  const normalizedPluginId = typeof pluginId === 'string' ? pluginId.trim() : ''
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : ''

  return Boolean(
    normalizedPluginId
      ? PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedPluginId)
      : normalizedMarketplaceName && PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName)
  )
}

/**
 * Generates a `/plugin install` command from verified manifest semantics.
 *
 * Priority:
 * 1. `pluginName` + `pluginId` → `/plugin install {name}@{id}`
 * 2. `pluginName` + `marketplaceName` → `/plugin install {name}@{marketplaceName}`
 * 3. `pluginId` only → `/plugin install {id}`
 * 4. `pluginName` only → `/plugin install {name}` (unverified)
 *
 * Returns `null` when no identifier is provided or a supplied identifier is unsafe.
 */
export function getPluginInstallCommand({ pluginName, pluginId, marketplaceName }: PluginInstallCommandInput): string | null {
  const normalizedName = normalizePluginName(pluginName)
  const normalizedPluginId = typeof pluginId === 'string' ? pluginId.trim() : undefined
  const normalizedMarketplaceName = typeof marketplaceName === 'string' ? marketplaceName.trim() : undefined

  if (normalizedPluginId && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedPluginId)) {
    return null
  }
  if (normalizedMarketplaceName && !PLUGIN_COMMAND_TOKEN_PATTERN.test(normalizedMarketplaceName)) {
    return null
  }

  if (normalizedName && normalizedPluginId) {
    return `/plugin install ${normalizedName}@${normalizedPluginId}`
  }

  if (normalizedName && normalizedMarketplaceName) {
    return `/plugin install ${normalizedName}@${normalizedMarketplaceName}`
  }

  if (normalizedPluginId) {
    return `/plugin install ${normalizedPluginId}`
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
